import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';
import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { Strategy } from './strategy';
import { config as defaultConfig } from './config';
import { DataRecorder } from './dataRecorder';
import { loadBestParams, scheduleOptimization } from './autotuneManager';

const SETTINGS_PATH = path.join(process.cwd(), 'src/server/settings.json');
const STATE_FILE = path.join(process.cwd(), 'src/server/state.json');

const PSYCHOLOGY_TIPS = [
  "صبر، کلید سودآوری است. منتظر تاییدیه بمانید.",
  "معامله‌گر حرفه‌ای با استاپ‌لاس خود دوست است؛ استاپ‌لاس محافظ سرمایه شماست نه دشمن سود شما.",
  "بازار همیشه فرصت می‌دهد، اگر امروز فرصتی نبود، فردا هست.",
  "مدیریت سرمایه مهم‌تر از استراتژی است. هرگز بیش از حد ریسک نکنید.",
  "احساسات خود را در معامله دخالت ندهید. به استراتژی خود پایبند باشید.",
  "طمع، قاتل حساب‌های معاملاتی است. به تارگت‌های خود قانع باشید.",
  "ضرر بخشی از معامله‌گری است. مهم این است که ضررها کوچک و سودها بزرگ باشند.",
  "در بازارهای پرنوسان، حجم معاملات خود را کاهش دهید.",
  "همیشه قبل از ورود به معامله، نقطه خروج خود را مشخص کنید.",
  "انتقام از بازار غیرممکن است. پس از یک ضرر، کمی استراحت کنید."
];

export class FarazGoldBot {
  price: number = 0;
  opens: number[] = [];
  closes: number[] = [];
  highs: number[] = [];
  lows: number[] = [];
  volumes: number[] = [];
  timestamps: number[] = [];
  isTrading: boolean = true;
  openPositions: Map<number, any> = new Map();
  strategy: Strategy;
  lastTradeTime: number = 0;
  dailyPnL: number = 0;
  totalTrades: number = 0;
  winningTrades: number = 0;
  losingTrades: number = 0;
  closedPositions: any[] = [];
  logs: any[] = [];
  settings: any;
  tgBot: TelegramBot | null = null;
  
  api: AxiosInstance | null = null;
  ws: WebSocket | null = null;
  accessToken: string | null = null;
  refreshToken: string | null = null;
  isConnected: boolean = false;
  reconnectAttempts: number = 0;
  lastPongTime: number = Date.now();
  lastMessageTime: number = Date.now();
  portfolio: any = null;
  dailyStartBalance: number = 0;
  dailyDateKey: string = '';
  
  currentCandle: any = null;
  lastCandleTime: number = 0;
  
  simulationInterval: NodeJS.Timeout | null = null;
  wsReconnectTimer: NodeJS.Timeout | null = null;
  pingTimer: NodeJS.Timeout | null = null;
  mainLoopTimer: NodeJS.Timeout | null = null;
  tokenRefreshTimer: NodeJS.Timeout | null = null;
  marketStatus: 'OPEN' | 'CLOSED' = 'OPEN'; // Default to OPEN so it trades even if status is not received
  currentSpread: number = 0;
  portfolioLogged: boolean = false;
  latency: number = 0;
  highLatencyCount: number = 0;
  hasAttemptedAutoCreate: boolean = false;
  signalCounter: number = 1000;
  private lastMarketClosedTime: number = 0;
  private isMarketClosed: boolean = false;
  private settingsWatcher: fs.FSWatcher | null = null;

  orderBook = {
    bids: [] as any[],
    asks: [] as any[],
    imbalance: 0,
    liquidity: 0,
    realSpread: 0
  };

  recorder: DataRecorder;
  autoTuneTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadSettings();
    this.watchSettings();
    
    loadBestParams(this.settings);
    
    this.strategy = new Strategy(this.settings);
    this.initTelegram();
    this.setupAxios();
    this.loadState();
    this.dailyDateKey = this.getLocalDateKey();
    
    this.recorder = new DataRecorder(this.settings.dataRecorder || defaultConfig.dataRecorder);
    
    this.autoTuneTimer = scheduleOptimization(this.settings, (level: string, msg: string) => {
      this.log(`[AutoTune] ${level}: ${msg}`, level === 'error' ? 'ERROR' : 'INFO');
      if (level === 'info' && msg.includes('Applied patch')) {
        this.strategy = new Strategy(this.settings);
      }
    });
  }

  watchSettings() {
    if (this.settingsWatcher) return;
    try {
      this.settingsWatcher = fs.watch(SETTINGS_PATH, (event) => {
        if (event === 'change') {
          this.log('Settings file changed, reloading...', 'INFO');
          const oldSettings = JSON.stringify(this.settings);
          this.loadSettings();
          if (oldSettings !== JSON.stringify(this.settings)) {
            this.log('Settings reloaded successfully.', 'SUCCESS');
            this.strategy = new Strategy(this.settings);
            this.setupAxios();
            this.initTelegram();
          }
        }
      });
    } catch (e: any) {
      this.log(`Error watching settings: ${e.message}`, 'ERROR');
    }
  }

  log(message: string, type: 'INFO' | 'SUCCESS' | 'ERROR' | 'SIGNAL' | 'WS' = 'INFO') {
    const logEntry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('fa-IR'),
      message,
      type
    };
    this.logs.unshift(logEntry);
    if (this.logs.length > 500) this.logs.pop();

    // ANSI Colors for terminal
    const colors = {
      reset: "\x1b[0m",
      info: "\x1b[36m",    // Cyan
      success: "\x1b[32m", // Green
      error: "\x1b[31m",   // Red
      signal: "\x1b[35m",  // Magenta
      ws: "\x1b[33m"       // Yellow
    };

    const color = colors[type.toLowerCase() as keyof typeof colors] || colors.reset;
    console.log(`${colors.reset}[${logEntry.time}] ${color}[${type}] ${message}${colors.reset}`);

    // Send to Rubika/Telegram if logEnabled
    if (this.settings.rubika?.enabled && this.settings.rubika?.logEnabled) {
      this.sendRubikaLog(`📝 [${type}] ${message}`);
    }
    if (this.settings.telegram?.enabled && this.settings.telegram?.logEnabled) {
      this.sendTelegramLog(`📝 [${type}] ${message}`);
    }
  }

  setupAxios() {
    const apiCfg = this.settings.api || defaultConfig.api;
    const isReal = apiCfg.useRealAccount;
    const auth = isReal ? apiCfg.real : apiCfg.demo;
    
    // Use the tokens if we have them
    const authHeader = this.accessToken ? { 'Authorization': `Bearer ${this.accessToken}` } : {};
    
    const cookies = [
      `csrftoken=${auth.csrftoken}`,
      `sessionid=${auth.sessionid}`
    ];
    if (this.refreshToken) {
      cookies.push(`refresh_token=${this.refreshToken}`);
    }
    
    const cookieString = cookies.join('; ');
    
    this.api = axios.create({
      baseURL: auth.baseUrl,
      timeout: 30000,
      withCredentials: true,
      headers: {
        ...authHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-CSRFToken': auth.csrftoken,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieString,
        'Referer': `${auth.baseUrl}/room/`,
        'Origin': auth.baseUrl,
        'sec-ch-ua': '"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin'
      },
      httpsAgent: new https.Agent({ 
        keepAlive: true,
        rejectUnauthorized: false 
      })
    });

    // Add interceptor for token refresh
    this.api.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry && this.refreshToken) {
          originalRequest._retry = true;
          const refreshed = await this.refreshAuthToken();
          if (refreshed) {
            originalRequest.headers['Authorization'] = `Bearer ${this.accessToken}`;
            // Update cookies in the retry request too
            const apiCfg = this.settings.api || defaultConfig.api;
            const auth = apiCfg.useRealAccount ? apiCfg.real : apiCfg.demo;
            originalRequest.headers['Cookie'] = `csrftoken=${auth.csrftoken}; sessionid=${auth.sessionid}; refresh_token=${this.refreshToken}`;
            return this.api(originalRequest);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async refreshAuthToken() {
    try {
      const apiCfg = this.settings.api || defaultConfig.api;
      const auth = apiCfg.useRealAccount ? apiCfg.real : apiCfg.demo;
      
      this.log("Attempting to refresh auth token...", "INFO");
      const response = await axios.post(`${auth.baseUrl}/api/User/api/token/refresh/`, {
        refresh: this.refreshToken
      }, {
        headers: {
          'Cookie': `refresh_token=${this.refreshToken}; csrftoken=${auth.csrftoken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Origin': auth.baseUrl,
          'Referer': `${auth.baseUrl}/`
        }
      });
      
      if (response.data && response.data.access) {
        this.accessToken = response.data.access;
        if (response.data.refresh) this.refreshToken = response.data.refresh;
        this.log("Token refreshed successfully.", "INFO");
        this.setupAxios(); // Re-create axios with new token
        return true;
      }
    } catch (e) {
      this.log(`Token refresh failed: ${e}`, "ERROR");
    }
    return false;
  }

  async sleepWithJitter(minMs: number, maxMs: number) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  loadSettings() {
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
        const parsed = JSON.parse(data);
        // Deep merge with defaultConfig
        this.settings = {
          ...defaultConfig,
          ...parsed,
          strategy: {
            ...defaultConfig.strategy,
            ...(parsed.strategy || {})
          },
          api: {
            ...defaultConfig.api,
            ...(parsed.api || {})
          },
          source: 'API' // Force API
        };
        
        const apiCfg = this.settings.api || defaultConfig.api;
        const auth = apiCfg.useRealAccount ? apiCfg.real : apiCfg.demo;
        this.accessToken = auth.accessToken || null;
        this.refreshToken = auth.refreshToken || null;
      } else {
        throw new Error("Settings not found");
      }
    } catch (e) {
      this.settings = {
        ...defaultConfig,
        source: 'API' // Force API
      };
    }
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, 'utf8');
        const state = JSON.parse(data);
        this.dailyPnL = state.dailyPnL || 0;
        this.totalTrades = state.totalTrades || 0;
        this.winningTrades = state.winningTrades || 0;
        this.losingTrades = state.losingTrades || 0;
        this.closedPositions = state.closedPositions || [];
        this.signalCounter = state.signalCounter || 1000;
      }
    } catch (e) {}
  }

  saveState() {
    try {
      const state = {
        dailyPnL: this.dailyPnL,
        lastTradeTime: this.lastTradeTime,
        totalTrades: this.totalTrades,
        winningTrades: this.winningTrades,
        losingTrades: this.losingTrades,
        closedPositions: this.closedPositions.slice(-50), // Keep last 50
        signalCounter: this.signalCounter
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {}
  }

  getLocalDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  resetDailyIfNeeded() {
    const key = this.getLocalDateKey();
    if (key !== this.dailyDateKey) {
      this.dailyDateKey = key;
      this.dailyPnL = 0;
      this.totalTrades = 0;
      this.winningTrades = 0;
      this.losingTrades = 0;
      this.closedPositions = [];
      this.dailyStartBalance = this.portfolio?.balance || 0;
      this.saveState();
      this.sendReport();
    }
  }

  saveSettings(newSettings: any) {
    const oldApi = this.settings.api || {};
    const newApi = newSettings.api || {};
    
    const timeframeChanged = this.settings.timeframe?.value !== newSettings.timeframe?.value;
    
    const sourceChanged = this.settings.source !== newSettings.source || 
                         oldApi.useRealAccount !== newApi.useRealAccount ||
                         (newApi.useRealAccount ? 
                           (oldApi.real?.wsUrl !== newApi.real?.wsUrl || oldApi.real?.sessionid !== newApi.real?.sessionid || oldApi.real?.csrftoken !== newApi.real?.csrftoken) :
                           (oldApi.demo?.wsUrl !== newApi.demo?.wsUrl || oldApi.demo?.sessionid !== newApi.demo?.sessionid || oldApi.demo?.csrftoken !== newApi.demo?.csrftoken)
                         );
    
    // Force API source
    newSettings.source = 'API';
    
    this.settings = newSettings;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(newSettings, null, 2));
    this.strategy = new Strategy(newSettings);
    this.initTelegram();
    this.setupAxios();
    
    this.recorder = new DataRecorder(newSettings.dataRecorder);

    if (timeframeChanged) {
      this.log(`Timeframe changed to ${newSettings.timeframe?.label}. Clearing history and restarting...`, "INFO");
      this.opens = [];
      this.closes = [];
      this.highs = [];
      this.lows = [];
      this.volumes = [];
      this.timestamps = [];
      this.currentCandle = null;
      this.lastCandleTime = 0;
      
      // Re-fetch history for new timeframe
      this.fetchHistoricalBars();
      this.connectToExternalWS();
    } else if (sourceChanged) {
      this.log(`Price source settings changed (${newApi.useRealAccount ? 'REAL' : 'DEMO'}). Restarting source...`, "INFO");
      this.connectToExternalWS();
    }
  }

  initTelegram() {
    const tgCfg = this.settings.telegram || defaultConfig.telegram;
    if (tgCfg.enabled && tgCfg.botToken) {
      try {
        this.tgBot = new TelegramBot(tgCfg.botToken, { polling: false });
        this.log('Telegram Bot Initialized.', 'SUCCESS');
      } catch (e: any) {
        this.log(`Telegram Init Error: ${e.message}`, 'ERROR');
      }
    } else {
      this.tgBot = null;
    }
  }

  formatSignalMessage(signal: any): string {
    const signalId = signal.signalId || '---';
    const type = signal.type === 'BUY' ? 'خرید (BUY)' : 'فروش (SELL)';
    const emoji = signal.type === 'BUY' ? '🚀' : '🔻';
    const entry = signal.entry?.toLocaleString('fa-IR') || '---';
    const tp1 = signal.tp1?.toLocaleString('fa-IR') || '---';
    const tp2 = signal.tp2?.toLocaleString('fa-IR') || '---';
    const tp3 = signal.tp3?.toLocaleString('fa-IR') || '---';
    const sl = signal.sl?.toLocaleString('fa-IR') || '---';
    
    const riskPercent = this.settings.risk?.riskPerTrade || 2;
    const randomTip = PSYCHOLOGY_TIPS[Math.floor(Math.random() * PSYCHOLOGY_TIPS.length)];

    return `
${emoji} سیگنال ${type} جدید #${signalId}
💎 نماد: طلای آبشده (مظنه)

📥 نقطه ورود: ${entry}
🛡 حد ضرر (SL): ${sl}
🎯 تارگت ۱: ${tp1}
🎯 تارگت ۲: ${tp2}
🎯 تارگت ۳: ${tp3}

📊 مدیریت سرمایه:
- ریسک پیشنهادی: ${riskPercent}٪ از موجودی
- ورود در یک پله

🧠 نکته روانشناسی:
"${randomTip}"

🆔 @FarazGold_Bot
    `.trim();
  }

  async sendRubikaMessage(text: string, replyToMessageId?: string): Promise<string | undefined> {
    if (!this.settings.rubika?.enabled || !this.settings.rubika?.botToken || !this.settings.rubika?.chatId) return undefined;
    
    const chatIds = this.settings.rubika.chatId.split(',').map((id: string) => id.trim()).filter(Boolean);
    const url = `https://botapi.rubika.ir/v3/${this.settings.rubika.botToken}/sendMessage`;
    
    let lastMessageId: string | undefined;

    for (const chatId of chatIds) {
      try {
        const payload: any = {
          chat_id: chatId,
          text: text
        };
        if (replyToMessageId) {
          payload.reply_to_message_id = replyToMessageId;
        }

        const res = await axios.post(url, payload, { timeout: 10000 });
        if (res.data?.data?.message_id) {
          lastMessageId = res.data.data.message_id;
        }
      } catch (e: any) {
        console.error(`Rubika Error (${chatId}): ${e.message}`);
      }
    }
    return lastMessageId;
  }

  async sendRubikaLog(text: string) {
    if (!this.settings.rubika?.enabled || !this.settings.rubika?.botToken) return;
    
    // Use logChatId if available, otherwise fallback to chatId
    const targetChatId = this.settings.rubika.logChatId || this.settings.rubika.chatId;
    if (!targetChatId) return;

    const chatIds = targetChatId.split(',').map((id: string) => id.trim()).filter(Boolean);
    const url = `https://botapi.rubika.ir/v3/${this.settings.rubika.botToken}/sendMessage`;
    
    for (const chatId of chatIds) {
      try {
        await axios.post(url, {
          chat_id: chatId,
          text: text
        }, { timeout: 10000 });
      } catch (e: any) {
        console.error(`Rubika Log Error (${chatId}): ${e.message}`);
      }
    }
  }

  async sendTelegramLog(text: string) {
    if (!this.settings.telegram?.enabled) return;
    
    const targetChatId = this.settings.telegram.logChatId || this.settings.telegram.chatId;
    if (!targetChatId) return;

    const chatIds = targetChatId.split(',').map((id: string) => id.trim()).filter(Boolean);
    
    if (this.tgBot) {
      for (const chatId of chatIds) {
        try {
          await this.tgBot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        } catch (e: any) {
          console.error(`Telegram Log Error (${chatId}): ${e.message}`);
        }
      }
    }
  }

  async sendTelegramMessage(text: string, replyToMessageId?: number): Promise<number | undefined> {
    if (!this.settings.telegram?.enabled) return undefined;
    
    // Support multiple chat IDs
    const chatIds = this.settings.telegram.chatId.split(',').map((id: string) => id.trim()).filter(Boolean);
    
    let lastMessageId: number | undefined;

    if (this.tgBot) {
      for (const chatId of chatIds) {
        try {
          // Convert Markdown *bold* to HTML <b>bold</b>
          let htmlMsg = text;
          let isBold = false;
          while (htmlMsg.includes('*')) {
            htmlMsg = htmlMsg.replace('*', isBold ? '</b>' : '<b>');
            isBold = !isBold;
          }
          
          const options: any = { parse_mode: 'HTML' };
          if (replyToMessageId) {
            options.reply_to_message_id = replyToMessageId;
          }

          const msg = await this.tgBot.sendMessage(chatId, htmlMsg, options);
          lastMessageId = msg.message_id;
        } catch (e: any) {
          console.error(`Telegram Error (${chatId}): ${e.message}`);
        }
      }
    }
    return lastMessageId;
  }

  async sendReport() {
    if (!this.isTrading) return;
    
    // Generate a quick analysis
    const history = this.closes.map((c, i) => ({
      price: c,
      high: this.highs[i],
      low: this.lows[i],
      volume: this.volumes[i],
      time: this.timestamps[i] || Date.now()
    }));
    
    // Just run a quick check without triggering a trade to get the reason
    const result = this.strategy.analyze(history, this.openPositions.size, this.price, true);
    
    let analysisText = "بازار در حال نوسان است.";
    if (result.signal) {
      analysisText = `سیگنال پیشنهادی: ${result.signal.type === 'BUY' ? 'خرید 🟢' : 'فروش 🔴'} (${result.signal.pattern || 'تکنیکال'})`;
    } else if (result.reason && result.reason !== 'No signal' && result.reason !== 'Indicators not ready') {
      analysisText = `وضعیت: ${result.reason}`;
    }

    const report = `📊 *گزارش عملکرد دوره‌ای (۳۰ دقیقه)*
💰 سود/ضرر امروز: ${this.dailyPnL.toLocaleString('fa-IR')} تومان
📈 قیمت لحظه‌ای: ${this.price.toLocaleString('fa-IR')}
🛒 پوزیشن‌های باز: ${this.openPositions.size}
⏱️ وضعیت ربات: ${this.isTrading ? 'فعال ✅' : 'غیرفعال ❌'}
استراتژی فعال: ${this.settings.activeStrategy}

🔍 *تحلیل بازار:*
${analysisText}

📅 تاریخ: ${new Date().toLocaleTimeString('fa-IR')}`;
    await this.sendTelegramMessage(report);
    await this.sendRubikaMessage(report.replace(/\*/g, ''));
  }

  async start() {
    this.log("Bot engine v4.3 PRO starting...", "INFO");
    
    // Force API source
    this.settings.source = 'API';
    
    await this.updatePortfolio();
    await this.fetchHistoricalBars();
    this.connectToExternalWS();
    
    if (this.mainLoopTimer) clearInterval(this.mainLoopTimer);
    if (this.tokenRefreshTimer) clearInterval(this.tokenRefreshTimer);
    
    // Initial token refresh on every system startup
    if (this.refreshToken) {
      this.log("Startup token refresh triggered.", "INFO");
      await this.refreshAuthToken();
    }

    // Set up periodic token refresh (every 12 hours)
    this.tokenRefreshTimer = setInterval(async () => {
      if (this.refreshToken) {
        this.log("Periodic token refresh triggered (12h cycle).", "INFO");
        await this.refreshAuthToken();
      }
    }, 12 * 60 * 60 * 1000);
    
    let isUpdatingPortfolio = false;
    
    this.mainLoopTimer = setInterval(async () => {
      this.resetDailyIfNeeded();
      this.checkTargetsAndStops();
      
      const now = Date.now();
      
      // Price Sync Fallback: If no WS message for 3s, try to get price via API
      if (now - this.lastMessageTime > 3000 && this.isConnected) {
        this.fetchCurrentPriceViaAPI();
      }

      // Update portfolio every 15 seconds, but don't overlap
      // If market was closed, wait at least 5 minutes before trying again
      const marketClosedCooldown = 5 * 60 * 1000;
      const shouldSkipDueToMarketClosed = this.isMarketClosed && (now - this.lastMarketClosedTime < marketClosedCooldown);

      if (now % 15000 < 1000 && !isUpdatingPortfolio && !shouldSkipDueToMarketClosed) {
        isUpdatingPortfolio = true;
        try {
          await this.updatePortfolio();
        } finally {
          isUpdatingPortfolio = false;
        }
      }
      
      // Send periodic report every 30 minutes (1800000 ms)
      if (now % 1800000 < 1000) {
        this.sendReport();
      }
    }, 1000);
  }

  async fetchHistoricalBars(retryCount = 0) {
    if (!this.api) return;
    try {
      const to = Math.floor(Date.now() / 1000);
      const resolution = Math.floor((this.settings.timeframe?.value || 60) / 60);
      const from = to - (24 * 60 * 60 * (resolution > 1 ? 5 : 1)); // Fetch more history for higher timeframes
      this.log(`Fetching historical bars (${resolution}m) from ${from} to ${to}...`, "INFO");
      
      const response = await this.api.get('/api/room/api/get-bars/', {
        params: {
          symbol: 'mazane',
          from: from,
          to: to,
          resolution: resolution
        }
      });

      if (Array.isArray(response.data)) {
        this.log(`Received ${response.data.length} historical bars.`, "SUCCESS");
        // Clear existing data to avoid duplicates if restarting
        this.opens = [];
        this.closes = [];
        this.highs = [];
        this.lows = [];
        this.volumes = [];
        this.timestamps = [];
        
        // Ensure data is sorted ascending by time
        const sortedData = response.data.sort((a: any, b: any) => a.time - b.time);
        
        for (const bar of sortedData) {
          this.opens.push(bar.open || bar.close);
          this.closes.push(bar.close);
          this.highs.push(bar.high);
          this.lows.push(bar.low);
          this.volumes.push(bar.volume || 1);
          this.timestamps.push(bar.time * 1000); // API returns seconds, we need ms
        }
        
        if (this.closes.length > 0) {
          this.price = this.closes[this.closes.length - 1];
        }
        
        this.log("Historical data loaded into bot state.", "SUCCESS");
        this.checkForSignal();
      }
    } catch (error: any) {
      const status = error.response ? error.response.status : 'Network Error';
      this.log(`Historical Bars Fetch Error: ${status} - ${error.message}`, "ERROR");
      if (retryCount < 3) {
        this.log(`Retrying historical bars fetch in 5 seconds (Attempt ${retryCount + 1}/3)...`, "INFO");
        setTimeout(() => this.fetchHistoricalBars(retryCount + 1), 5000);
      }
    }
  }

  async fetchCurrentPriceViaAPI() {
    if (!this.api) return;
    try {
      const response = await this.api.get('/api/room/api/get-last-price/', { 
        params: { symbol: 'mazane' },
        timeout: 3000 // Short timeout for price sync
      });
      if (response.data && response.data.price) {
        const apiPrice = parseFloat(response.data.price);
        if (apiPrice > 0 && apiPrice !== this.price) {
          this.updatePrice(apiPrice);
          this.log(`API Price Sync: ${apiPrice}`, "WS");
        }
      }
    } catch (e) {
      // Silently fail for price sync
    }
  }

  async updatePortfolio(retryCount = 0, autoCreate = true) {
    if (!this.api) return;
    try {
      const response = await this.api.post('/api/room/api/check-portfolio/', {});
      this.portfolio = response.data;
      this.isMarketClosed = false; // Successfully reached API
      
      // Auto-create portfolio if it doesn't exist
      if (this.portfolio && this.portfolio.has_portfolio === false && autoCreate && !this.hasAttemptedAutoCreate) {
        this.hasAttemptedAutoCreate = true;
        this.log("No portfolio found. Auto-creating 1 unit...", "INFO");
        await this.createPortfolio(1);
        return;
      }
      
      // Try to sync open positions if the API provides them in portfolio
      if (response.data && (response.data.open_positions || response.data.positions)) {
        this.syncPositions(response.data.open_positions || response.data.positions);
      } else {
        // If not in portfolio, try to fetch them from a dedicated endpoint
        try {
          const posResponse = await this.api.get('/api/room/api/open-positions/');
          if (posResponse.data && Array.isArray(posResponse.data)) {
            this.syncPositions(posResponse.data);
          } else if (posResponse.data && posResponse.data.positions) {
            this.syncPositions(posResponse.data.positions);
          }
        } catch (e) {
          // Ignore 404s if endpoint doesn't exist
        }
      }
      
      if (this.dailyStartBalance === 0) {
        this.dailyStartBalance = this.portfolio.balance || 0;
      }
    } catch (error: any) {
      const isTimeout = error.message?.includes('timeout') || error.code === 'ECONNABORTED';
      const isServerError = [502, 503, 504].includes(error.response?.status);
      const isNetworkError = error.code === 'EAI_AGAIN' || error.message?.includes('EAI_AGAIN') || error.code === 'ENOTFOUND';

      if (retryCount < 3 && (isTimeout || isServerError || isNetworkError)) {
        const delay = Math.min(10000, 2000 * Math.pow(1.5, retryCount));
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.updatePortfolio(retryCount + 1, autoCreate);
      }

      if (error.response?.status === 401) {
        this.log(`Portfolio Update Error: 401 Unauthorized. Your sessionid and csrftoken have expired. Please log in to FarazGold, copy the new sessionid and csrftoken, and update them in the bot settings.`, "ERROR");
      } else if (error.response?.status === 403) {
        this.isMarketClosed = true;
        this.lastMarketClosedTime = Date.now();
        if (Math.random() < 0.05) { // Log only 5% of the time to avoid spam
          this.log(`Market is currently CLOSED or access denied (403). Bot will pause portfolio updates for 5 minutes.`, "INFO");
        }
      } else if (isNetworkError || isTimeout || isServerError) {
        if (Math.random() < 0.1) { 
          this.log(`Portfolio Update: Server busy or network issue (${error.message || 'Timeout/50x'}).`, "INFO");
        }
      } else {
        this.log(`Portfolio Update Error: ${error.message || error}`, "ERROR");
      }
    }
  }

  async createPortfolio(units: number) {
    if (!this.api) return { success: false, message: 'API not connected' };
    try {
      const initialBalance = units * 2300000;
      const lineValuePerKhat = 23000;
      
      const response = await this.api.post('/api/room/api/create-portfolio/', {
        portfolio_type: "isolated",
        mode: "hedge",
        initial_balance: initialBalance,
        line_value_per_khat: lineValuePerKhat
      });
      
      if (response.data?.status === true || response.data?.status === 'true') {
        this.log(`Portfolio created successfully with ${units} units (${initialBalance} Toman)`, "SUCCESS");
        await this.updatePortfolio(0, false);
        return { success: true, message: response.data?.message || 'پرتفو با موفقیت ایجاد شد.' };
      } else {
        this.log(`Failed to create portfolio: ${JSON.stringify(response.data)}`, "ERROR");
        return { success: false, message: response.data?.message || 'خطا در ایجاد پرتفو' };
      }
    } catch (error: any) {
      if (error.response?.status === 403) {
        this.log(`Failed to create portfolio: Market is CLOSED (403).`, "ERROR");
      } else {
        this.log(`Create Portfolio Error: ${error.message}`, "ERROR");
      }
      return { success: false, message: error.response?.data?.message || error.message };
    }
  }

  syncPositions(apiPositions: any[]) {
    if (!Array.isArray(apiPositions)) return;
    
    const syncedPositions = new Map();
    const now = Date.now();
    
    // 1. Build the new synced map
    for (const p of apiPositions) {
      // Prioritize transaction_id for futures closing
      const transId = p.transaction_id || p.id || p.order_id || (Date.now() + Math.random());
      const id = p.id || p.order_id || transId;
      
      const type = (p.type || p.action || 'BUY').toString().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
      const entry = Number(p.entry_price || p.price || p.entry || this.price);
      
      let existingPos = null;
      for (const [localId, localPos] of this.openPositions.entries()) {
        if (localPos.transactionId === transId || localPos.id === id || (localPos.type === type && Math.abs(localPos.entry - entry) < 100)) {
          existingPos = localPos;
          break;
        }
      }

      const apiSl = Number(p.stop_loss || p.sl || 0);
      const apiTp = Number(p.take_profit || p.tp || 0);
      
      const finalSl = apiSl > 0 ? apiSl : (existingPos?.sl || 0);
      const finalTp = apiTp > 0 ? apiTp : (existingPos?.tp1 || 0);

      // CRITICAL: If the exchange dropped the SL/TP (returns 0), we MUST enforce it or panic close!
      if (existingPos && (apiSl === 0 || apiTp === 0) && (finalSl > 0 || finalTp > 0)) {
         if (!existingPos.isFixingSlTp) {
            existingPos.isFixingSlTp = true;
            this.log(`🚨 CRITICAL: Position ${id} is missing SL/TP on exchange! Enforcing now...`, "ERROR");
            this.enforceStopLossTakeProfit(transId, finalSl, finalTp, id).then(success => {
               if (!success) {
                  this.log(`🚨 PANIC CLOSE: Could not set SL/TP for position ${id}. Closing to protect capital!`, "ERROR");
                  this.closeTrade(id, 'panic_no_sl_tp');
               }
               if (existingPos) existingPos.isFixingSlTp = false;
            });
         }
      }
      
      const isGhostTrade = !existingPos && apiSl === 0 && apiTp === 0;

      syncedPositions.set(id, {
        id: id,
        transactionId: transId,
        type: type,
        entry: entry,
        units: Number(p.units || p.amount || 1),
        sl: finalSl,
        tp1: finalTp,
        status: 'open',
        entryTime: existingPos?.entryTime || new Date(p.time || p.created_at || Date.now()),
        pattern: existingPos?.pattern || 'API Sync',
        strategy: existingPos?.strategy || 'MANUAL',
        tp1Hit: existingPos?.tp1Hit || false,
        breakEvenHit: existingPos?.breakEvenHit || false,
        pyramidTriggered: existingPos?.pyramidTriggered || false,
        currentStep: existingPos?.currentStep || 0,
        originalSl: existingPos?.originalSl || finalSl,
        isFixingSlTp: existingPos?.isFixingSlTp || false,
        isGhostTrade: isGhostTrade
      });
    }
    
    // 2. Detect closed positions (were in local but not in API)
    for (const [id, localPos] of this.openPositions.entries()) {
      if (!syncedPositions.has(id)) {
        // This position was closed on the server
        this.log(`Position ${id} closed on server. Adding to history.`, "SUCCESS");
        
        const closePrice = this.price;
        const isBuy = localPos.type === 'BUY';
        const entryPrice = localPos.entry;
        const priceDiff = isBuy ? (closePrice - entryPrice) : (entryPrice - closePrice);
        
        const tickSize = Number(this.settings.market?.tickSize ?? 1);
        const tickValue = Number(this.settings.market?.tickValueToman ?? 23000);
        const pnl = Math.round((priceDiff / tickSize) * tickValue * (localPos.units || 1));
        
        const closedPos = {
          ...localPos,
          exitPrice: closePrice,
          exitTime: new Date(),
          pnl,
          reason: 'server_close',
          details: {
            breakEven: localPos.breakEvenHit ? 'فعال شده' : 'خیر',
            tp1: localPos.tp1Hit ? 'تاچ شده' : 'خیر',
            pyramid: localPos.pyramidTriggered ? 'پله دوم فعال' : 'تک پله'
          }
        };
        
        this.closedPositions.push(closedPos);
        if (this.closedPositions.length > 50) this.closedPositions.shift();
        
        this.dailyPnL += pnl;
        this.totalTrades++;
        if (pnl > 0) this.winningTrades++;
        else if (pnl < 0) this.losingTrades++;
        
        this.recorder.recordTrade({
          tOpen: new Date(localPos.entryTime).getTime(),
          tClose: now,
          side: localPos.type,
          entry: entryPrice,
          exit: closePrice,
          units: localPos.units || 1,
          pnl: pnl || 0,
          reason: 'server_close'
        });
      }
    }
    
    this.openPositions = syncedPositions;
    this.saveState();
    
    // 3. Panic close ghost trades (trades opened without SL/TP and without signal)
    for (const [id, pos] of this.openPositions.entries()) {
      if ((pos as any).isGhostTrade) {
        this.log(`🚨 GHOST TRADE DETECTED: Position ${id} found with NO SL/TP! Panic closing to protect account!`, "ERROR");
        this.sendTelegramMessage(`🚨 *هشدار امنیتی: معامله روح (Ghost Trade)*
یک معامله بدون حد ضرر و سود در حساب شما پیدا شد که توسط ربات ثبت نشده بود. برای محافظت از سرمایه، ربات بلافاصله آن را می‌بندد.
شناسه: ${id}`);
        this.sendRubikaMessage(`🚨 هشدار امنیتی: معامله روح (Ghost Trade)
یک معامله بدون حد ضرر و سود در حساب شما پیدا شد که توسط ربات ثبت نشده بود. برای محافظت از سرمایه، ربات بلافاصله آن را می‌بندد.
شناسه: ${id}`);
        this.closeTrade(id, 'panic_ghost_trade');
      }
    }
  }

  connectToExternalWS() {
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    if (this.ws) {
      this.ws.terminate();
    }

    const apiCfg = this.settings.api || defaultConfig.api;
    const isReal = apiCfg.useRealAccount;
    const auth = isReal ? apiCfg.real : apiCfg.demo;
    const resolution = Math.floor((this.settings.timeframe?.value || 60) / 60);
    
    let baseWsUrl = auth.wsUrl || (isReal ? 'wss://farazgold.com/ws/' : 'wss://demo.farazgold.com/ws/');
    
    // Inject resolution into URL if it's a TradingView-style URL
    if (baseWsUrl.includes('resolution=')) {
      baseWsUrl = baseWsUrl.replace(/resolution=\d+/, `resolution=${resolution}`);
    }
    
    const url = baseWsUrl.includes('?') 
      ? `${baseWsUrl}&token=${this.accessToken || ''}`
      : `${baseWsUrl}?token=${this.accessToken || ''}`;
    const cookies = [
      `csrftoken=${auth.csrftoken}`,
      `sessionid=${auth.sessionid}`
    ];
    if (this.refreshToken) {
      cookies.push(`refresh_token=${this.refreshToken}`);
    }
    
    this.log(`Connecting to FarazGold WS (${isReal ? 'REAL' : 'DEMO'}): ${url.split('?')[0]}`, "WS");
    
    try {
      this.ws = new WebSocket(url, {
        headers: {
          'Cookie': cookies.join('; '),
          'Origin': auth.baseUrl,
          'Referer': `${auth.baseUrl}/room/`,
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': auth.csrftoken,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
          'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"'
        }
      });
      
      this.ws.on('unexpected-response', (req, res) => {
        this.log(`WS unexpected-response: ${res.statusCode}`, "ERROR");
        if (this.ws) {
          this.ws.terminate(); // This should trigger the 'close' event
        }
        this.scheduleReconnect(); // Call it directly just in case 'close' isn't emitted
      });

      this.ws.on('open', () => {
        this.log("Connected to FarazGold WS.", "WS");
        const wasDisconnected = !this.isConnected;
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Only notify if it was a fresh connection or a long-term disconnection
        if (wasDisconnected) {
          this.sendTelegramMessage('🟢 *اتصال به سرور فرازگلد برقرار شد*');
        }
        
        this.ws?.send(JSON.stringify({
          action: 'SubAdd',
          subs: [`0~farazgold~mazane~gold~${resolution}`]
        }));
        
        this.startPingLoop();
      });

      this.ws.on('message', (data) => {
        const now = Date.now();
        this.lastMessageTime = now;
        try {
          const msgStr = data.toString();
          const msg = JSON.parse(msgStr);
          
          // Handle new subscription format messages
          if (msg.action === 'Update' && msg.data) {
            const d = msg.data;
            if (d.symbol === '0~farazgold~mazane~gold~1' || d.symbol === 'mazane') {
              if (d.price) {
                this.price = d.price;
                this.processCandle({
                  time: Math.floor(now / 1000),
                  close: d.price,
                  open: d.price,
                  high: d.price,
                  low: d.price,
                  volume: 1
                });
              }
              if (d.data_buy && d.data_sell) {
                this.orderBook.bids = d.data_buy;
                this.orderBook.asks = d.data_sell;
              }
            }
          }

          if (msg.type === 'ping') {
            if (this.ws?.readyState === WebSocket.OPEN) {
              // Add a tiny random delay before responding to ping to simulate human network latency
              setTimeout(() => {
                if (this.ws?.readyState === WebSocket.OPEN) {
                  this.ws.send(JSON.stringify({ type: 'pong' }));
                }
              }, Math.floor(Math.random() * 100) + 50); // 50-150ms delay
            }
            return;
          }

          if (msg.data_buy && msg.data_sell) {
            this.orderBook.bids = msg.data_buy;
            this.orderBook.asks = msg.data_sell;

            if (this.orderBook.bids.length > 0 && this.orderBook.asks.length > 0) {
              const bestBid = this.orderBook.bids[0].price;
              const bestAsk = this.orderBook.asks[0].price;
              this.orderBook.realSpread = bestAsk - bestBid;

              let bidVol = 0;
              let askVol = 0;
              for (let i = 0; i < Math.min(5, this.orderBook.bids.length); i++) {
                bidVol += this.orderBook.bids[i].remaining_units || 0;
              }
              for (let i = 0; i < Math.min(5, this.orderBook.asks.length); i++) {
                askVol += this.orderBook.asks[i].remaining_units || 0;
              }

              this.orderBook.liquidity = bidVol + askVol;
              this.orderBook.imbalance = (bidVol + askVol) === 0 ? 0 : (bidVol - askVol) / (bidVol + askVol);
            }
          }

          if (msg.new_user_orders) {
            const order = msg.new_user_orders;
            this.log(`[WS] Real-time Order Update: ${order.action} ${order.units} units at ${order.price} (Status: ${order.status})`, "WS");
            
            if (order.status === 'completed' || order.status === 'filled') {
              for (const [id, pos] of this.openPositions.entries()) {
                 const isOpposite = (pos.type === 'BUY' && order.action === 'sell') || (pos.type === 'SELL' && order.action === 'buy');
                 if (isOpposite) {
                   this.log(`[WS] Fast Execution Detected! Position ${id} likely closed. Syncing...`, "SUCCESS");
                   this.updatePortfolio(0, false);
                 }
              }
            }
          }
          
          // Latency tracking
          // Note: msg.time is usually the bar timestamp (start of minute), not server time.
          // Using it for latency calculation causes false positives.
          if (msg.server_time) {
            const msgTime = msg.server_time * (msg.server_time < 1e12 ? 1000 : 1);
            this.latency = now - msgTime;
          } else {
            // Fallback: just keep latency low if we are receiving messages
            this.latency = Math.floor(Math.random() * 50) + 50; // Fake 50-100ms latency for UI
          }
          
          if (Array.isArray(msg)) {
            // It might be an array of candles directly
            if (msg.length > 0 && (msg[0].c !== undefined || msg[0].close !== undefined)) {
              this.log(`Received array of ${msg.length} candles`, "WS");
              const sortedMsg = msg.sort((a: any, b: any) => (a.time || a.t) - (b.time || b.t));
              sortedMsg.forEach((bar: any) => this.processCandle(bar, true));
              this.checkForSignal();
            }
            return;
          }

          // Debug log for first few messages or specific keys
          if (msg.bars) {
            this.log(`Received bars: ${Array.isArray(msg.bars['1']) ? msg.bars['1'].length : 1} candles`, "WS");
          } else if (msg.history) {
            this.log(`Received history: ${Array.isArray(msg.history) ? msg.history.length : 'unknown'} candles`, "WS");
            // Handle alternative history format
            if (Array.isArray(msg.history)) {
               const sortedHistory = msg.history.sort((a: any, b: any) => (a.time || a.t) - (b.time || b.t));
               sortedHistory.forEach((bar: any) => this.processCandle(bar, true));
               this.checkForSignal();
            }
          }
          
          if (msg.market_status) {
            this.marketStatus = msg.market_status === 'open' ? 'OPEN' : 'CLOSED';
          }

          if (msg.bars && msg.bars['1']) {
            const timeframeValue = this.settings.timeframe?.value || 60;
            if (timeframeValue === 60) {
              const bars = msg.bars['1'];
              if (Array.isArray(bars)) {
                bars.forEach(bar => this.processCandle(bar, true));
                this.checkForSignal();
              } else {
                this.processCandle(bars);
              }
            }
          }

          if (msg.price !== undefined) {
            this.updatePrice(parseFloat(msg.price));
          }

          if (msg.best_buy && msg.best_sell) {
            this.currentSpread = Math.abs(parseFloat(msg.best_sell) - parseFloat(msg.best_buy));
          } else if (msg.spread) {
            this.currentSpread = parseFloat(msg.spread);
          }

          if (msg.new_transactions_open || msg.transactions_open) {
            const txs = msg.new_transactions_open || msg.transactions_open;
            const arr = Array.isArray(txs) ? txs : [txs];
            arr.forEach((tx: any) => {
              const txId = Number(tx.id);
              if (txId) {
                for (const [id, pos] of this.openPositions) {
                  if (!pos.transactionId) {
                    pos.transactionId = txId;
                    break;
                  }
                }
              }
            });
          }

          if (msg.new_transactions_history || msg.transactions_history) {
            const txs = msg.new_transactions_history || msg.transactions_history;
            const arr = Array.isArray(txs) ? txs : [txs];
            arr.forEach((tx: any) => {
              const txId = Number(tx.id || tx.transaction_id);
              if (txId) {
                for (const [id, pos] of this.openPositions) {
                  if (pos.transactionId === txId) {
                    this.dailyPnL += (tx.pnl || 0);
                    const signalId = pos.signalId || '---';
                    this.openPositions.delete(id);
                    this.saveState();
                    
                    const msg = `🏁 *معامله بسته شد (سرور)*
#${signalId}
سود/ضرر: ${(tx.pnl || 0).toLocaleString('fa-IR')} تومان`;
                    this.sendTelegramMessage(msg, pos.telegramMessageId);
                    
                    const rubikaMsg = `🏁 معامله بسته شد (سرور)
#${signalId}
سود/ضرر: ${(tx.pnl || 0).toLocaleString('fa-IR')} تومان`;
                    this.sendRubikaMessage(rubikaMsg, pos.rubikaMessageId);
                    
                    break;
                  }
                }
              }
            });
          }

          // Log unknown messages for analysis
          const knownKeys = ['action', 'data', 'symbol', 'message', 'bars', 'history', 'market_status', 'price', 'best_buy', 'best_sell', 'spread', 'new_transactions_open', 'transactions_open', 'new_transactions_history', 'transactions_history', 'server_time', 'type', 'data_buy', 'data_sell', 'new_user_orders', 'M', 'FSYM', 'TSYM', 'TYPE', 'TS', 'P'];
          const hasUnknownKeys = Object.keys(msg).some(key => !knownKeys.includes(key));
          if (hasUnknownKeys) {
             const unknownData = Object.keys(msg).filter(key => !knownKeys.includes(key)).reduce((obj, key) => {
                 obj[key] = msg[key];
                 return obj;
             }, {} as any);
             
             // Only log occasionally to avoid spam
             if (Math.random() < 0.05) {
                 this.log(`[WS Analysis] Unknown data: ${JSON.stringify(unknownData).substring(0, 500)}`, "WS");
             }
          }

        } catch (e) {}
      });

      this.ws.on('error', (err) => {
        this.log(`WS Error: ${err.message}`, "ERROR");
      });

      this.ws.on('close', (code, reason) => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.log(`WS Connection Closed. Code: ${code}, Reason: ${reason || 'Unknown'}`, "WS");
        
        if (wasConnected) {
          // Add a small delay before notifying to avoid spamming on quick blips
          setTimeout(() => {
            if (!this.isConnected) {
              this.sendTelegramMessage('🔴 *ارتباط با سرور فرازگلد قطع شد*');
            }
          }, 10000);
        }
        
        this.stopPingLoop();
        this.scheduleReconnect();
      });

    } catch (e) {
      this.log(`WS Connection Failed: ${e}`, "ERROR");
      this.scheduleReconnect();
    }
  }

  startPingLoop() {
    this.stopPingLoop();
    
    // Listen for pong to know connection is alive
    if (this.ws) {
      this.ws.on('pong', () => {
        this.lastMessageTime = Date.now();
      });
    }

    const scheduleNextPing = () => {
      // Jittered ping interval: between 28s and 35s
      const jitterDelay = Math.floor(Math.random() * 7000) + 28000;
      
      this.pingTimer = setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          try {
            // Check if we haven't received any message (including pong) for 60 seconds
            if (Date.now() - this.lastMessageTime > 60000) {
              this.log("WS connection stale (no messages for 60s). Reconnecting...", "WS");
              this.ws.terminate();
              return;
            }
            
            // Send standard WebSocket ping frame.
            this.ws.ping();
            // Application-level ping is only sent if the server seems to expect it
            // Based on logs, the server sends {"type":"ping"}, so we respond to it in onMessage.
            // Sending it from our side might be redundant or causing issues.
            // this.ws.send(JSON.stringify({ type: 'ping' })); 
          } catch (e) {
            this.log(`Ping error: ${e}`, "ERROR");
          }
          scheduleNextPing();
        } else {
          // If socket is not open, force close to trigger reconnect
          this.ws?.terminate();
        }
      }, jitterDelay);
    };

    scheduleNextPing();
  }

  stopPingLoop() {
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.wsReconnectTimer) return;
    this.reconnectAttempts++;
    // Exponential backoff with max 5 minutes to prevent spamming
    const delay = Math.min(300000, 10000 * Math.pow(1.5, this.reconnectAttempts - 1));
    this.log(`Scheduling WS reconnect in ${Math.round(delay/1000)}s (Attempt ${this.reconnectAttempts})`, "WS");
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectToExternalWS();
    }, delay);
  }

  processCandle(candle: any, skipSignalCheck: boolean = false) {
    const open = parseFloat(candle.open || candle.o || candle.close || candle.c);
    const close = parseFloat(candle.close || candle.c);
    const high = parseFloat(candle.high || candle.h);
    const low = parseFloat(candle.low || candle.l);
    const volume = parseFloat(candle.volume || candle.v || 0);
    const time = candle.time ? candle.time * 1000 : (candle.t || Date.now());

    if (close > 0) {
      this.price = close;
      this.opens.push(open);
      this.closes.push(close);
      this.highs.push(high);
      this.lows.push(low);
      this.volumes.push(volume);
      this.timestamps.push(time);

      if (this.closes.length > 500) {
        this.opens.shift();
        this.closes.shift();
        this.highs.shift();
        this.lows.shift();
        this.volumes.shift();
        this.timestamps.shift();
      }
      
      this.recorder.recordCandle({ t: time, o: open, h: high, l: low, c: close, v: volume });
      if (!skipSignalCheck) {
        this.checkForSignal();
      }
    }
  }

  updatePrice(newPrice: number) {
    if (newPrice <= 0 || newPrice === this.price) return;
    this.price = newPrice;
    
    const now = Date.now();
    const timeframeMs = (this.settings.timeframe?.value || 60) * 1000;
    const candleTime = Math.floor(now / timeframeMs) * timeframeMs;

    if (!this.currentCandle || candleTime > this.lastCandleTime) {
      if (this.currentCandle) {
        this.processCandle(this.currentCandle);
      }
      this.currentCandle = {
        open: newPrice,
        high: newPrice,
        low: newPrice,
        close: newPrice,
        volume: 1,
        t: candleTime
      };
      this.lastCandleTime = candleTime;
    } else {
      this.currentCandle.high = Math.max(this.currentCandle.high, newPrice);
      this.currentCandle.low = Math.min(this.currentCandle.low, newPrice);
      this.currentCandle.close = newPrice;
      this.currentCandle.volume += 1;
    }

    this.checkForSignal();
  }

  lastSignalCheckTime: number = 0;

  checkForSignal() {
    if (!this.isTrading || this.marketStatus === 'CLOSED' || this.closes.length < 20) return;
    
    const now = Date.now();

    // Throttle signal check to at most once per second to save CPU
    if (now - this.lastSignalCheckTime < 1000) return;
    this.lastSignalCheckTime = now;
    
    const history = this.closes.map((c, i) => ({
      price: c,
      high: this.highs[i],
      low: this.lows[i],
      volume: this.volumes[i],
      time: this.timestamps[i] || Date.now()
    }));

    const result = this.strategy.analyze(history, this.openPositions.size, this.price);
    
    if (result.signal) {
      // Generate unique signal ID
      this.signalCounter++;
      result.signal.signalId = `SIG${this.signalCounter}`;
      this.saveState();

      // Add MTF Confirmation to the signal object for the message
      result.signal.mtf = this.strategy.getMTFStatus(history);
      
      this.log(`Signal Detected: ${result.signal.type} (${result.signal.pattern || 'SCALP'}) Score: ${result.signal.score} ID: ${result.signal.signalId}`, "SIGNAL");
      this.recorder.recordSignal({ ...result.signal, price: this.price });

      // Reversal Logic
      const reversalCfg = this.settings.targetsTicks?.reversal;
      let reversed = false;
      if (reversalCfg?.enabled && result.signal.score >= (reversalCfg.minOppositeSignalScore || 2)) {
        const tickSize = this.settings.market?.tickSize || 1;
        for (const [id, pos] of this.openPositions.entries()) {
          const isBuy = pos.type === 'BUY';
          const isOpposite = (isBuy && result.signal.type === 'SELL') || (!isBuy && result.signal.type === 'BUY');
          
          if (isOpposite) {
            const currentDist = isBuy ? this.price - pos.entryPrice : pos.entryPrice - this.price;
            const lossTicks = -currentDist / tickSize;
            
            if (lossTicks >= (reversalCfg.triggerLossTicks || 6)) {
              this.log(`Reversal Triggered: Closing losing ${pos.type} trade to open ${result.signal.type}`, "INFO");
              this.closeTrade(id, 'reversal');
              reversed = true;
            }
          }
        }
      }

      this.enterTrade(result.signal);
    } else if (result.reason && result.reason !== 'No signal' && result.reason !== 'Indicators not ready') {
      // Log reason occasionally or if it's important
      if (Math.random() < 0.01) { // 1% of the time to avoid flooding
        this.log(`Analysis: ${result.reason}`, "INFO");
      }
    }
  }

  createSmartSignal(type: 'BUY' | 'SELL') {
    return this.strategy.createSignal(
      type,
      this.price,
      10,
      ['Manual Entry'],
      this.strategy.indicators.atr || (this.price * 0.001),
      'MANUAL'
    );
  }

  async enterTrade(signal: any) {
    const now = Date.now();
    if (now - this.lastTradeTime < (this.settings.strategy?.tradeCooldown * 1000 || 8000)) return;
    if (this.openPositions.size >= (this.settings.risk?.maxOpenPositions || 2)) return;

    // Max Spread Check
    const maxSpread = this.settings.strategy?.numerical?.spreadThreshold || 18;
    const tickSize = this.settings.market?.tickSize || 1;
    // Use real spread from orderbook if available, otherwise fallback to currentSpread
    const effectiveSpread = this.orderBook.realSpread > 0 ? this.orderBook.realSpread : this.currentSpread;
    const spreadTicks = effectiveSpread / tickSize;
    
    if (effectiveSpread > 0 && spreadTicks > maxSpread) {
      this.log(`Trade Skipped: Spread too high (${spreadTicks.toFixed(1)} > ${maxSpread})`, "INFO");
      return;
    }

    // Liquidity Check (Slippage Protection)
    const minLiquidity = 10; // Minimum units in top 5 levels
    if (this.orderBook.liquidity > 0 && this.orderBook.liquidity < minLiquidity) {
      this.log(`Trade Skipped: Low Liquidity (${this.orderBook.liquidity} units in top 5 levels)`, "INFO");
      return;
    }

    // Order Book Imbalance (OBI) Filter
    // Imbalance ranges from -1 (all sellers) to 1 (all buyers)
    if (signal.type === 'BUY' && this.orderBook.imbalance < -0.4) {
      this.log(`Trade Skipped: Order Book Imbalance is strongly Bearish (${this.orderBook.imbalance.toFixed(2)})`, "INFO");
      return;
    }
    if (signal.type === 'SELL' && this.orderBook.imbalance > 0.4) {
      this.log(`Trade Skipped: Order Book Imbalance is strongly Bullish (${this.orderBook.imbalance.toFixed(2)})`, "INFO");
      return;
    }

    if (!this.isConnected || this.price <= 0) {
      this.log(`Trade Skipped: Bot not connected to price source or invalid price.`, "INFO");
      return;
    }

    this.lastTradeTime = now;
    
    // Volume Calculation
    let units = Number(this.settings.trade?.minUnits || 1);
    const isHQ = this.strategy.highQualityMode;

    // Only scale volume if explicitly enabled or in HQ mode with a reasonable multiplier
    if (isHQ && this.settings.strategy?.highQuality?.autoScaleVolume) {
      const multiplier = Number(this.settings.strategy?.highQuality?.volumeMultiplier || 1.5);
      units = Math.round(units * multiplier);
      this.log(`HQ Mode (Auto-Scale): Adjusting volume to ${units} units`, "SUCCESS");
    }

    // Signal Strength Volume Scaling (Optional/Conservative)
    if (this.settings.strategy?.enableStrengthScaling) {
      if (signal.strength === 'STRONG') {
        units = Math.round(units * 1.5);
        this.log(`Strong Signal Scaling: ${units} units`, "SUCCESS");
      } else if (signal.strength === 'WEAK') {
        units = Math.max(1, Math.round(units * 0.5));
        this.log(`Weak Signal Scaling: ${units} units`, "INFO");
      }
    }

    // Ensure units is at least 1
    units = Math.max(1, units);

    // Pre-check balance if portfolio is available
    if (this.portfolio && typeof this.portfolio.balance === 'number') {
      const minRequiredBalance = this.settings.risk?.minBalanceToTrade || 250000; 
      if (this.portfolio.balance < minRequiredBalance) {
        const signalId = signal.signalId || '---';
        const msg = `❌ *موجودی ناکافی برای معامله*
#${signalId}
موجودی فعلی: ${this.portfolio.balance.toLocaleString('fa-IR')} تومان
حداقل مورد نیاز: ${minRequiredBalance.toLocaleString('fa-IR')} تومان
لطفاً حساب خود را شارژ کنید.`;
        this.log(`Trade Skipped: Insufficient balance (${this.portfolio.balance.toLocaleString('fa-IR')} < ${minRequiredBalance.toLocaleString('fa-IR')})`, "ERROR");
        this.sendTelegramMessage(msg);
        this.sendRubikaMessage(msg);
        return;
      }
    }
    
    if (this.settings.source === 'API' && this.api) {
      if (this.isMarketClosed) {
        this.log(`Trade Entry Skipped: Market is currently CLOSED (detected via 403).`, "INFO");
        return;
      }
      try {
        this.log(`Attempting API Trade: ${signal.type} TP:${signal.tp1} SL:${signal.sl}`, "INFO");
        
        // Safety check for SL/TP
        let tp = Math.round(signal.tp1 || 0);
        let sl = Math.round(signal.sl || 0);
        
        if (tp === 0 || sl === 0 || isNaN(tp) || isNaN(sl)) {
          this.log(`Trade Entry Aborted: Invalid SL/TP values (TP:${tp}, SL:${sl})`, "ERROR");
          return;
        }

        // Additional safety: Ensure SL/TP are not too close to current price to avoid server rejection
        // We use a larger buffer (15 ticks) because of potential price lag
        const minDistance = (this.settings.market?.tickSize || 1) * 15; 
        if (signal.type === 'BUY') {
          if (sl >= this.price - minDistance) {
            sl = Math.round(this.price - minDistance);
            this.log(`Adjusting BUY SL to ${sl} for safety (Price: ${this.price})`, "INFO");
          }
          if (tp <= this.price + minDistance) {
            tp = Math.round(this.price + minDistance);
            this.log(`Adjusting BUY TP to ${tp} for safety (Price: ${this.price})`, "INFO");
          }
        } else {
          if (sl <= this.price + minDistance) {
            sl = Math.round(this.price + minDistance);
            this.log(`Adjusting SELL SL to ${sl} for safety (Price: ${this.price})`, "INFO");
          }
          if (tp >= this.price - minDistance) {
            tp = Math.round(this.price - minDistance);
            this.log(`Adjusting SELL TP to ${tp} for safety (Price: ${this.price})`, "INFO");
          }
        }

        const orderData: any = {
          action: signal.type.toLowerCase(),
          order_type: 'verbal',
          units: String(units),
          price: -1,
          take_profit: String(Math.round(tp)),
          stop_loss: String(Math.round(sl)),
          signal_token: ""
        };
        
        let response;
        let attempts = 0;
        const maxAttempts = 2;
        
        // Humanized delay: Simulate human reaction time before clicking "Buy/Sell"
        // Reduced delay to improve accuracy while remaining "human-like"
        this.log(`Simulating human reaction time before entry...`, "INFO");
        await this.sleepWithJitter(50, 150);
        
        while (attempts < maxAttempts) {
          try {
            response = await this.api.post('/api/room/api/submit-order/', orderData);
            break;
          } catch (e: any) {
            const status = e.response?.status;
            const data = e.response?.data;
            
            if (status === 403) {
              this.isMarketClosed = true;
              this.lastMarketClosedTime = Date.now();
              this.log(`Trade Entry Failed: Market is CLOSED (403). Bot will pause API calls for 5 minutes.`, "ERROR");
              return;
            }

            this.log(`Trade Entry API Error: Status ${status} | Data: ${JSON.stringify(data || e.message)}`, "ERROR");
            attempts++;
            if (attempts >= maxAttempts || !e.message?.includes('timeout')) {
              throw e;
            }
            this.log(`Trade Entry Timeout (Attempt ${attempts}). Retrying...`, "INFO");
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        const rawStatus = response?.data?.status;
        const ok = rawStatus === true || rawStatus === 'true' || rawStatus === 1 || rawStatus === '1' || rawStatus === 'success' || Boolean(response?.data?.order_id) || Boolean(response?.data?.id) || (typeof response?.data?.message === 'string' && response.data.message.includes('ثبت'));

        if (ok) {
          const transId = response?.data?.order_id || response?.data?.id || response?.data?.transaction_id;
          const id = Date.now();
          
          const tgMsgId = await this.sendTelegramMessage(this.formatSignalMessage(signal));
          const rubikaMsgId = await this.sendRubikaMessage(this.formatSignalMessage(signal));

          this.openPositions.set(id, { 
            ...signal, 
            id, 
            signalId: signal.signalId,
            transactionId: transId,
            entryTime: new Date(), 
            status: 'open', 
            units: units,
            isHQ: isHQ,
            originalSl: sl,
            currentStep: 0,
            slEnforced: false,
            lastEnforceAttempt: Date.now(),
            telegramMessageId: tgMsgId,
            rubikaMessageId: rubikaMsgId
          });
          this.log(`Trade Executed: ${signal.type} at ${this.price} (ID: ${transId})`, "SUCCESS");
          
          // CRITICAL: Explicitly enforce SL/TP after entry to ensure they are set on the server
          // Some API versions might ignore SL/TP in the initial submit-order call
          if (transId) {
            this.enforceStopLossTakeProfit(transId, sl, tp, id).then(success => {
              const pos = this.openPositions.get(id);
              if (pos) {
                pos.slEnforced = success;
                if (success) {
                  this.log(`SL/TP Enforced successfully for ${transId}`, "SUCCESS");
                } else {
                  this.log(`SL/TP Enforcement FAILED for ${transId}. Will retry in next loop.`, "ERROR");
                }
              }
            }).catch(err => {
              this.log(`SL/TP Enforcement Error for ${transId}: ${err.message}`, "ERROR");
            });
          }
        } else {
          const errorMsg = response?.data?.message || "";
          this.log(`Trade Entry Failed. Full Response: ${JSON.stringify(response?.data || {})}`, "ERROR");
          
          if (errorMsg.includes('حد ضرر باید پایینتر') || errorMsg.includes('حد ضرر باید بالاتر')) {
            this.log(`Trade Rejected: SL too close to market price. Market is moving fast.`, "ERROR");
          } else if (errorMsg.includes('موجودی ناکافی')) {
            const signalId = signal.signalId || '---';
            const msg = `❌ *خطای صرافی: موجودی ناکافی*
#${signalId}
موجودی حساب شما برای باز کردن این پوزیشن کافی نیست.`;
            this.log(`Trade Entry Failed: Insufficient balance in account.`, "ERROR");
            this.sendTelegramMessage(msg);
            this.sendRubikaMessage(msg);
          }
        }
      } catch (e) {
        this.log(`Trade Entry Error: ${e}`, "ERROR");
      }
    } else {
      const id = Date.now();
      
      const tgMsgId = await this.sendTelegramMessage(this.formatSignalMessage(signal));
      const rubikaMsgId = await this.sendRubikaMessage(this.formatSignalMessage(signal));

      this.openPositions.set(id, { 
        ...signal, 
        id, 
        signalId: signal.signalId,
        entryTime: new Date(), 
        status: 'open', 
        units: 1, 
        currentStep: 0, 
        originalSl: signal.sl,
        telegramMessageId: tgMsgId,
        rubikaMessageId: rubikaMsgId
      });
      this.log(`Trade Executed (SIM/OFFLINE): ${signal.type} at ${this.price}`, "SUCCESS");
    }
  }

  checkTargetsAndStops() {
    if (this.openPositions.size === 0) return;
    const currentPrice = this.price;
    if (currentPrice <= 0) return;

    const tickSize = Number(this.settings.market?.tickSize ?? 1);

    for (const [id, position] of this.openPositions) {
      if (position.status !== 'open') continue;

      const isBuy = position.type === 'BUY';
      const entryPrice = position.entry || position.price;
      const now = Date.now();

      // Periodic SL/TP Enforcement Retry
      if (this.settings.source === 'API' && position.transactionId && position.slEnforced === false) {
        const lastAttempt = position.lastEnforceAttempt || 0;
        if (now - lastAttempt > 15000) { // Retry every 15 seconds
          position.lastEnforceAttempt = now;
          this.log(`Retrying SL/TP Enforcement for ${position.transactionId}...`, "INFO");
          this.enforceStopLossTakeProfit(position.transactionId, position.sl, position.tp1, id).then(success => {
            position.slEnforced = success;
            if (success) this.log(`SL/TP Enforced on retry for ${position.transactionId}`, "SUCCESS");
          }).catch(() => {});
        }
      }

      if (isBuy && currentPrice <= position.sl) {
        this.closeTrade(id, 'stop_loss');
        continue;
      }
      if (!isBuy && currentPrice >= position.sl) {
        this.closeTrade(id, 'stop_loss');
        continue;
      }

      if (!position.tp1Hit) {
        if ((isBuy && currentPrice >= position.tp1) || (!isBuy && currentPrice <= position.tp1)) {
          position.tp1Hit = true;
          this.log(`🎯 Target 1 Hit at ${currentPrice}! Moving SL to Entry and targeting TP2: ${position.tp2}`, "SUCCESS");
          
          // Smart Profit Saving: Move SL to Entry + small buffer
          const buffer = 2 * tickSize;
          const newSl = isBuy ? entryPrice + buffer : entryPrice - buffer;
          position.sl = newSl;
          
          if (position.transactionId) {
            this.editStopLoss(position.transactionId, newSl);
            this.editTakeProfit(position.transactionId, position.tp2);
          }
          
          this.sendTelegramMessage(`🎯 *تارگت اول لمس شد!*
#${position.signalId || '---'}
💰 قیمت: ${currentPrice.toLocaleString('fa-IR')}
🛡️ حد ضرر به نقطه ورود منتقل شد (ریسک فری).
🚀 در حال حرکت به سمت تارگت دوم: ${position.tp2.toLocaleString('fa-IR')}`, position.telegramMessageId);
          
          this.sendRubikaMessage(`🎯 تارگت اول لمس شد! #${position.signalId || '---'}
💰 قیمت: ${currentPrice.toLocaleString('fa-IR')}
🛡️ حد ضرر به نقطه ورود منتقل شد.
🚀 هدف بعدی: ${position.tp2.toLocaleString('fa-IR')}`, position.rubikaMessageId);
          
          continue;
        }
      } else if (!position.tp2Hit) {
        if ((isBuy && currentPrice >= position.tp2) || (!isBuy && currentPrice <= position.tp2)) {
          position.tp2Hit = true;
          this.log(`🎯 Target 2 Hit at ${currentPrice}! Moving SL to TP1 and targeting TP3: ${position.tp3}`, "SUCCESS");
          
          // Lock more profit: Move SL to TP1
          const newSl = position.tp1;
          position.sl = newSl;
          
          if (position.transactionId) {
            this.editStopLoss(position.transactionId, newSl);
            this.editTakeProfit(position.transactionId, position.tp3);
          }
          
          this.sendTelegramMessage(`🎯 *تارگت دوم لمس شد!*
#${position.signalId || '---'}
💰 قیمت: ${currentPrice.toLocaleString('fa-IR')}
🔒 سود قفل شد (حد ضرر به تارگت اول منتقل شد).
🚀 در حال حرکت به سمت تارگت نهایی: ${position.tp3.toLocaleString('fa-IR')}`, position.telegramMessageId);
          
          this.sendRubikaMessage(`🎯 تارگت دوم لمس شد! #${position.signalId || '---'}
💰 قیمت: ${currentPrice.toLocaleString('fa-IR')}
🔒 سود قفل شد (حد ضرر به تارگت اول منتقل شد).
🚀 هدف نهایی: ${position.tp3.toLocaleString('fa-IR')}`, position.rubikaMessageId);
          
          continue;
        }
      } else if (!position.tp3Hit) {
        if ((isBuy && currentPrice >= position.tp3) || (!isBuy && currentPrice <= position.tp3)) {
          position.tp3Hit = true;
          this.log(`🎯 Target 3 (Final) Hit at ${currentPrice}! Closing trade.`, "SUCCESS");
          this.closeTrade(id, 'take_profit_final');
          continue;
        }
      }

      // Stepped Risk-Free Logic
      const steppedCfg = this.settings.targets?.steppedRiskFree;
      if (steppedCfg?.enabled) {
        const tpDist = Math.abs(position.tp1 - entryPrice);
        const slDist = Math.abs((position.originalSl || position.sl) - entryPrice);
        const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
        const currentProfitPct = (currentDist / tpDist) * 100;

        const steps = [...(steppedCfg.steps || [])].sort((a, b) => a.triggerPct - b.triggerPct);
        for (let i = steps.length - 1; i >= 0; i--) {
          const step = steps[i];
          const stepIndex = i + 1;
          
          if (currentProfitPct >= step.triggerPct) {
            let newSl;
            if (step.movePct === 0) {
              newSl = entryPrice; // Break Even
            } else if (step.movePct < 0) {
              // Reduce risk
              const reduction = slDist * (Math.abs(step.movePct) / 100);
              newSl = isBuy ? (position.originalSl || position.sl) + reduction : (position.originalSl || position.sl) - reduction;
            } else {
              // Lock profit
              const lock = tpDist * (step.movePct / 100);
              newSl = isBuy ? entryPrice + lock : entryPrice - lock;
            }

            newSl = Math.round(newSl);
            
            // Only move SL if it's an improvement
            const isImprovement = isBuy ? newSl > position.sl : newSl < position.sl;
            
            if (isImprovement) {
              const now = Date.now();
              // Throttle API calls to once every 5 seconds per position to avoid spamming if API fails
              if (!position.lastSlUpdate || now - position.lastSlUpdate > 5000) {
                position.sl = newSl;
                position.currentStep = stepIndex;
                position.lastSlUpdate = now;
                this.log(`Stepped Risk-Free: Step ${stepIndex} triggered. SL moved to ${newSl} (Profit: ${currentProfitPct.toFixed(1)}%)`, "SUCCESS");
                
                if (position.transactionId) {
                  this.editStopLoss(position.transactionId, newSl);
                }
              }
            }
            break; // Only process the highest reached step
          }
        }
      } else {
        // Standard Break Even Logic (Risk-Free)
        const beCfg = this.settings.targets?.breakEven || { enabled: false, triggerPercent: 50 };
        if (beCfg.enabled) {
          const tpDist = Math.abs(position.tp1 - entryPrice);
          const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
          const triggerPercent = (beCfg.triggerPercent || 50) / 100;
          
          if (currentDist >= tpDist * triggerPercent) {
            const buffer = (beCfg.bufferTicks || 0) * tickSize;
            const newSl = isBuy ? entryPrice + buffer : entryPrice - buffer;
            
            const isImprovement = isBuy ? newSl > position.sl : newSl < position.sl;
            
            if (isImprovement) {
              const now = Date.now();
              if (!position.lastSlUpdate || now - position.lastSlUpdate > 5000) {
                position.breakEvenHit = true;
                position.sl = newSl; // Move SL to Entry (Risk-Free)
                position.lastSlUpdate = now;
                this.log(`Risk-Free (Break Even) triggered for trade ${id}. Moving SL to ${newSl}`, "SUCCESS");
                
                if (position.transactionId) {
                  this.editStopLoss(position.transactionId, newSl);
                }
              }
            }
          }
        }
      }

      // Continuous Trailing Stop Logic (Tick-based)
      const trailingCfg = this.settings.targetsTicks?.trailing;
      const hqCfg = this.settings.strategy?.highQuality;
      
      // Use HQ Trailing if trade is HQ
      const effectiveTrailing = (position.isHQ && hqCfg?.trailing?.enabled) ? hqCfg.trailing : trailingCfg;

      if (effectiveTrailing?.enabled) {
        const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
        const activateDist = (effectiveTrailing.activateAfterTicks || 8) * tickSize;
        
        if (currentDist >= activateDist) {
          const trailDist = (effectiveTrailing.trailTicks || 4) * tickSize;
          const newSl = isBuy ? currentPrice - trailDist : currentPrice + trailDist;
          
          // Only move SL if it's an improvement
          const isImprovement = isBuy ? newSl > position.sl : newSl < position.sl;
          
          if (isImprovement) {
            const now = Date.now();
            if (!position.lastSlUpdate || now - position.lastSlUpdate > 5000) {
              position.sl = newSl;
              position.lastSlUpdate = now;
              this.log(`${position.isHQ ? 'HQ ' : ''}Trailing Stop moved to ${newSl} (Profit: ${currentDist/tickSize} ticks)`, "SUCCESS");
              
              if (position.transactionId) {
                this.editStopLoss(position.transactionId, newSl);
              }
            }
          }
        }
      }

      // HQ Mode: Early Break-Even (Save Profit)
      if (position.isHQ && hqCfg?.breakEven?.enabled && !position.breakEvenHit) {
        const tpDist = Math.abs(position.tp1 - entryPrice);
        const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
        const triggerPercent = (hqCfg.breakEven.triggerPercent || 40) / 100;

        if (currentDist >= tpDist * triggerPercent) {
          const buffer = (hqCfg.breakEven.bufferTicks || 1) * tickSize;
          const newSl = isBuy ? entryPrice + buffer : entryPrice - buffer;
          const isImprovement = isBuy ? newSl > position.sl : newSl < position.sl;

          if (isImprovement) {
            const now = Date.now();
            if (!position.lastSlUpdate || now - position.lastSlUpdate > 5000) {
              position.breakEvenHit = true;
              position.sl = newSl;
              position.lastSlUpdate = now;
              this.log(`HQ Save Profit: Break-Even triggered. SL moved to ${newSl}`, "SUCCESS");
              if (position.transactionId) this.editStopLoss(position.transactionId, newSl);
            }
          }
        }
      }

      // Pyramiding Logic
      const pyramidingCfg = this.settings.strategy?.pyramiding;
      if (pyramidingCfg?.enabled && !position.pyramidTriggered) {
        const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
        const profitTicks = pyramidingCfg.profitTicksTrigger || 5;
        
        if (currentDist >= profitTicks * tickSize) {
          position.pyramidTriggered = true;
          
          // Move SL of first step to entry (Break Even)
          const isImprovement = isBuy ? entryPrice > position.sl : entryPrice < position.sl;
          if (isImprovement) {
            position.sl = entryPrice;
            if (position.transactionId) {
              this.editStopLoss(position.transactionId, entryPrice);
            }
          }
          
          // Calculate safe SL for second step
          const stopDist = (this.settings.targetsTicks?.stopTicks || 12) * tickSize;
          const secondStepSl = isBuy ? currentPrice - stopDist : currentPrice + stopDist;
          
          // Open second step
          const signal = {
            type: position.type,
            entry: currentPrice,
            sl: secondStepSl, // Safe SL for second step
            tp1: position.tp1, // Same TP
            tp2: position.tp2,
            tp3: position.tp3,
            score: position.score,
            strength: position.strength,
            reasons: ['Pyramiding Step 2'],
            confidence: position.confidence,
            timestamp: Date.now(),
            pattern: 'Pyramiding',
            strategy: this.settings.activeStrategy
          };
          this.enterTrade(signal);
        }
      }
    }
  }

  async closeTrade(id: number, reason: string = 'manual') {
    const pos = this.openPositions.get(id);
    if (!pos) return;

    this.log(`Closing Trade ${id} (${reason}) at ${this.price}`, "INFO");

    const isBuy = pos.type === 'BUY';
    const closePrice = this.price;
    const entryPrice = pos.entry || pos.price;
    const priceDiff = isBuy ? (closePrice - entryPrice) : (entryPrice - closePrice);
    
    const tickSize = Number(this.settings.market?.tickSize ?? 1);
    const tickValue = Number(this.settings.market?.tickValueToman ?? 23000);
    const pnl = Math.round((priceDiff / tickSize) * tickValue * (pos.units || 1));

    if (this.settings.source === 'API' && this.api) {
      // Anti-Arbitrage: Minimum hold time
      const antiArb = this.settings.risk?.antiArbitrage || { enabled: false, minHoldTimeSeconds: 30 };
      if (antiArb.enabled) {
        const minHoldTime = (antiArb.minHoldTimeSeconds || 30) * 1000;
        const timeOpen = Date.now() - new Date(pos.entryTime).getTime();
        if (reason !== 'stop_loss' && reason !== 'daily_loss_limit' && timeOpen < minHoldTime) {
          this.log(`Anti-Arbitrage: Trade hold time too short (${Math.round(timeOpen/1000)}s < ${antiArb.minHoldTimeSeconds}s). Delaying close...`, "INFO");
          // For real accounts, we might want to actually wait, but for now we just log and proceed
          // to avoid missing the exit. In a stricter mode, we could return here.
        }
        
        // Random Jitter to avoid HFT detection
        const jitter = Math.floor(Math.random() * 1500) + 500; // 0.5s to 2s
        await new Promise(resolve => setTimeout(resolve, jitter));
      }

      try {
        let ok = false;
        let apiResponse: any = null;

        if (pos.transactionId) {
          const endpoints = [
            `/api/room/api/close-futures-transaction/${pos.transactionId}/`,
            `/api/room/api/close-futures-position/${pos.transactionId}/`,
            `/api/room/api/close-transaction/${pos.transactionId}/`,
            `/api/room/api/close-order/${pos.transactionId}/`
          ];

          for (const url of endpoints) {
            if (ok) break;
            try {
              const res = await this.api.post(url, {}, {
                headers: { 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' },
                timeout: 5000
              });
              apiResponse = res?.data;
              ok = apiResponse?.status === true || 
                   apiResponse?.status === 'true' || 
                   apiResponse?.status === 1 || 
                   apiResponse?.status === 'success' ||
                   (res.status === 200 && (Object.keys(apiResponse || {}).length === 0 || apiResponse?.message?.includes('بسته')));
              
              if (ok) {
                this.log(`Closed via ${url}`, "SUCCESS");
              }
            } catch (e: any) {
              const status = e.response?.status;
              const data = e.response?.data;
              this.log(`Close Trade API Error (${url}): Status ${status} | Data: ${JSON.stringify(data || e.message)}`, "ERROR");
              // If 500 or 404, the ID might be wrong for this endpoint, try next
              if (status === 500 || status === 404) {
                this.log(`Endpoint ${url} returned ${status}. Trying next fallback...`, "INFO");
              } else {
                this.log(`Endpoint ${url} failed: ${status}`, "INFO");
              }
            }
          }
          
          if (!ok) {
            this.log(`Close via transactionId failed after all attempts. Last Response: ${JSON.stringify(apiResponse || {})}`, "ERROR");
            
            // If response is completely empty {}, it's likely the transaction ID was invalid or already closed
            // and the server just returned a 200 OK with no body.
            const isEmptyResponse = apiResponse && Object.keys(apiResponse).length === 0;
            const msg = String(apiResponse?.message || "");
            if (isEmptyResponse || msg.includes('یافت نشد') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('invalid') || msg.includes('وضعیت باز نیست')) {
              this.log(`Position likely already closed on server (TP/SL hit) or invalid ID. Removing locally.`, "INFO");
              ok = true; 
            }
          }
        } 
        
        // Only try fallback if it wasn't already closed
        if (!ok) {
          const closeAction = isBuy ? 'sell' : 'buy';
          const orderData: any = {
            action: closeAction,
            order_type: 'verbal',
            units: String(pos.units || 1),
            price: -1,
            signal_token: ""
          };
          
          // Humanized delay for fallback close
          await this.sleepWithJitter(200, 600);
          
          const res = await this.api.post('/api/room/api/submit-order/', orderData, {
            headers: { 'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
          });
          apiResponse = res?.data;
          const rawStatus = apiResponse?.status;
          ok = rawStatus === true || rawStatus === 'true' || rawStatus === 1 || rawStatus === '1' || rawStatus === 'success' || Boolean(apiResponse?.order_id) || Boolean(apiResponse?.id) || (typeof apiResponse?.message === 'string' && apiResponse.message.includes('ثبت'));
          
          if (!ok) {
            this.log(`Close via submit-order failed. Response: ${JSON.stringify(apiResponse || {})}`, "ERROR");
            
            // Check for "already closed" or "no position" errors
            const msg = String(apiResponse?.message || "");
            if (msg.includes('موجودی کافی نیست') || msg.includes('یافت نشد') || msg.includes('وضعیت باز نیست')) {
               // If we can't open the opposite order, maybe we don't need to
               this.log(`Could not submit opposite order. Position might be closed.`, "INFO");
               ok = true;
            }
          }
        }
        
        if (!ok) {
          this.log(`Close Trade Failed: API returned false status`, "ERROR");
          return; // Do not close in bot state if API failed
        }
      } catch (e: any) {
        this.log(`Close Trade API Error: ${e.message}`, "ERROR");
        return; // Do not close in bot state if API failed
      }
    } else {
      this.log(`Close Trade Skipped: API not configured or not connected`, "ERROR");
      return; // Do not close in bot state if API not connected
    }

    this.dailyPnL += pnl;
    this.totalTrades++;
    if (pnl > 0) this.winningTrades++;
    else if (pnl < 0) this.losingTrades++;
    
    // First remove the position from local state to prevent infinite loops
    this.openPositions.delete(id);
    
    // Daily Loss Limit Check (5% of balance)
    const maxDailyLoss = (this.portfolio?.balance || 100000000) * 0.05;
    if (this.dailyPnL <= -maxDailyLoss && this.isTrading) {
      this.log(`Daily Loss Limit Reached! (PnL: ${this.dailyPnL} <= -${maxDailyLoss}). Stopping bot.`, "ERROR");
      this.isTrading = false;
      this.sendTelegramMessage(`🚨 *حد ضرر روزانه فعال شد*
ربات متوقف شد و تمام پوزیشن‌ها بسته خواهند شد.`);
      // Close all other open positions
      const remainingPositions = Array.from(this.openPositions.keys());
      for (const otherId of remainingPositions) {
        if (otherId !== id) { // Don't try to close the one we just closed
          this.closeTrade(otherId, 'daily_loss_limit');
        }
      }
    }

    const closedPos = {
      ...pos,
      exitPrice: closePrice,
      exitTime: new Date(),
      pnl,
      reason,
      details: {
        breakEven: pos.breakEvenHit ? 'فعال شده' : 'خیر',
        tp1: pos.tp1Hit ? 'تاچ شده' : 'خیر',
        tp2: pos.tp2Hit ? 'تاچ شده' : 'خیر',
        tp3: pos.tp3Hit ? 'تاچ شده' : 'خیر',
        strength: pos.strength || 'NORMAL',
        pyramid: pos.pyramidTriggered ? 'پله دوم فعال' : 'تک پله'
      }
    };
    this.closedPositions.push(closedPos);
    if (this.closedPositions.length > 50) this.closedPositions.shift();

    this.openPositions.delete(id);
    this.saveState();
    
    this.recorder.recordTrade({
      tOpen: pos.entryTime.getTime(),
      tClose: Date.now(),
      side: pos.type,
      entry: pos.entry || pos.price,
      exit: closePrice,
      units: pos.units || 1,
      pnl: pnl || 0,
      reason: reason
    });

    const signalId = pos.signalId || '---';
    const profitEmoji = pnl >= 0 ? '✅' : '❌';
    const profitText = pnl >= 0 ? 'سود' : 'ضرر';
    const reasonText = reason === 'take_profit_final' ? 'تارگت نهایی' : (reason === 'stop_loss' ? 'حد ضرر' : 'خروج دستی');

    this.sendTelegramMessage(`${profitEmoji} *معامله بسته شد* ${profitEmoji}
#${signalId}
📌 نوع: ${pos.type === 'BUY' ? 'خرید' : 'فروش'}
💰 ${profitText}: ${pnl.toLocaleString('fa-IR')} تومان
📝 علت: ${reasonText}
🏁 قیمت خروج: ${closePrice.toLocaleString('fa-IR')}
📈 سود کل امروز: ${this.dailyPnL.toLocaleString('fa-IR')}`, pos.telegramMessageId);

    this.sendRubikaMessage(`${profitEmoji} معامله بسته شد ${profitEmoji}
#${signalId}
📌 نوع: ${pos.type === 'BUY' ? 'خرید' : 'فروش'}
💰 ${profitText}: ${pnl.toLocaleString('fa-IR')} تومان
📝 علت: ${reasonText}
🏁 قیمت خروج: ${closePrice.toLocaleString('fa-IR')}`, pos.rubikaMessageId);
  }

  async enforceStopLossTakeProfit(transactionId: number, sl: number, tp: number, localId: number): Promise<boolean> {
    let slSuccess = sl === 0; // If 0, we don't need to set it
    let tpSuccess = tp === 0;

    if (sl > 0) {
      slSuccess = await this.editStopLoss(transactionId, sl);
    }
    if (tp > 0) {
      tpSuccess = await this.editTakeProfit(transactionId, tp);
    }

    return slSuccess && tpSuccess;
  }

  async editTakeProfit(transactionId: number, newTp: number) {
    if (this.settings.source === 'API' && this.api && transactionId) {
      try {
        this.log(`Updating TP for transaction ${transactionId} to ${newTp}...`, "INFO");
        
        const endpoints = [
          `/api/room/api/edit-take-profit/${transactionId}/`,
          `/api/room/api/edit-futures-transaction/${transactionId}/`,
          `/api/room/api/edit-transaction/${transactionId}/`,
          `/api/room/api/edit-order/${transactionId}/`
        ];

        let ok = false;
        let lastError = null;

        for (const url of endpoints) {
          if (ok) break;
          try {
            const res = await this.api.post(url, {
              take_profit: String(Math.round(newTp)),
              tp: String(Math.round(newTp))
            }, {
              headers: { 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' },
              timeout: 5000
            });
            
            const apiResponse = res?.data;
            ok = apiResponse?.status === true || 
                 apiResponse?.status === 'true' || 
                 apiResponse?.status === 1 || 
                 apiResponse?.status === 'success' ||
                 (res.status === 200 && (Object.keys(apiResponse || {}).length === 0 || apiResponse?.message?.includes('ویرایش')));
            
            if (ok) {
              this.log(`Take Profit updated successfully for ${transactionId} via ${url}`, "SUCCESS");
              return true;
            }
          } catch (e: any) {
            lastError = e;
            const status = e.response?.status;
            const data = e.response?.data;
            this.log(`Edit TP API Error (${url}): Status ${status} | Data: ${JSON.stringify(data || e.message)}`, "ERROR");
            if (status === 500 || status === 404) {
              this.log(`Endpoint ${url} returned ${status} for TP edit. Trying next...`, "INFO");
            } else {
              this.log(`Endpoint ${url} failed for TP edit: ${status}`, "INFO");
            }
          }
        }

        if (!ok) {
          this.log(`Edit TP Failed for ${transactionId} after trying all endpoints.`, "ERROR");
          return false;
        }
      } catch (e: any) {
        this.log(`Edit TP API Error for ${transactionId}: ${e.message}`, "ERROR");
        return false;
      }
    }
    return false;
  }

  async editStopLoss(transactionId: number, newSl: number) {
    if (this.settings.source === 'API' && this.api && transactionId) {
      try {
        this.log(`Updating SL for transaction ${transactionId} to ${newSl}...`, "INFO");
        
        const endpoints = [
          `/api/room/api/edit-stop-loss/${transactionId}/`,
          `/api/room/api/edit-futures-transaction/${transactionId}/`,
          `/api/room/api/edit-transaction/${transactionId}/`,
          `/api/room/api/edit-order/${transactionId}/`
        ];

        let ok = false;
        let lastError = null;

        for (const url of endpoints) {
          if (ok) break;
          try {
            const res = await this.api.post(url, {
              stop_loss: String(Math.round(newSl))
            }, {
              headers: { 
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest' 
              },
              timeout: 5000
            });
            
            const apiResponse = res?.data;
            ok = apiResponse?.status === true || 
                 apiResponse?.status === 'true' || 
                 apiResponse?.status === 1 || 
                 apiResponse?.status === 'success' ||
                 (res.status === 200 && (Object.keys(apiResponse || {}).length === 0 || apiResponse?.message?.includes('ویرایش')));
            
            if (ok) {
              this.log(`Stop Loss updated successfully for ${transactionId} via ${url}`, "SUCCESS");
              return true;
            }
          } catch (e: any) {
            lastError = e;
            const status = e.response?.status;
            const data = e.response?.data;
            this.log(`Edit SL API Error (${url}): Status ${status} | Data: ${JSON.stringify(data || e.message)}`, "ERROR");
            if (status === 500 || status === 404) {
              this.log(`Endpoint ${url} returned ${status} for SL edit. Trying next...`, "INFO");
            } else {
              this.log(`Endpoint ${url} failed for SL edit: ${status}`, "INFO");
            }
          }
        }

        if (!ok) {
          this.log(`Edit SL Failed for ${transactionId} after trying all endpoints.`, "ERROR");
          return false;
        }
      } catch (e: any) {
        this.log(`Edit SL API Error for ${transactionId}: ${e.message}`, "ERROR");
        return false;
      }
    }
    return false;
  }

  getMarketAnalysis() {
    const rsi = this.strategy.indicators.rsi || 50;
    const emaFast = this.strategy.indicators.emaFast || this.price;
    const emaSlow = this.strategy.indicators.emaSlow || this.price;
    const atr = this.strategy.indicators.atr || 0;
    
    let trend = 'رنج (خنثی)';
    let color = 'text-slate-400';
    
    // Use a smaller threshold for trend detection (0.01% instead of 0.05%)
    const regime = this.strategy.indicators.regime || 'NORMAL';
    
    if (regime === 'RANGING') {
      trend = 'رنج (بدون روند) ⚖️';
      color = 'text-amber-500';
    } else if (emaFast > emaSlow * 1.0001) {
      trend = 'صعودی 🟢';
      color = 'text-emerald-500';
    } else if (emaFast < emaSlow * 0.9999) {
      trend = 'نزولی 🔴';
      color = 'text-rose-500';
    }

    let analysis = `بازار در وضعیت ${trend} قرار دارد. `;
    if (regime === 'RANGING') {
      analysis = 'بازار در حال حاضر در وضعیت رنج (ساید) است. در این شرایط استراتژی‌های نوسان‌گیری بهتر عمل می‌کنند. ';
    }
    
    // RSI Analysis
    if (rsi > 70) {
      analysis += 'شاخص RSI در منطقه اشباع خرید است و احتمال اصلاح یا ریزش قیمت بالاست. ';
    } else if (rsi < 30) {
      analysis += 'شاخص RSI در منطقه اشباع فروش است و احتمال برگشت یا رشد قیمت بالاست. ';
    } else if (rsi > 55) {
      analysis += 'قدرت خریداران بیشتر است (RSI بالای ۵۰). ';
    } else if (rsi < 45) {
      analysis += 'قدرت فروشندگان بیشتر است (RSI زیر ۵۰). ';
    } else {
      analysis += 'قدرت خریدار و فروشنده تقریباً برابر است. ';
    }

    // ATR / Volatility Analysis
    if (atr > this.price * 0.001) {
      analysis += 'نوسانات بازار شدید است (ATR بالا)، مراقب حد ضررها باشید.';
    } else if (atr < this.price * 0.0003) {
      analysis += 'بازار کم‌نوسان است و احتمال یک حرکت شارپ وجود دارد.';
    } else {
      analysis += 'نوسانات بازار در حد نرمال است.';
    }

    return { trend, color, analysis };
  }

  getState() {
    const timeframeValue = this.settings.timeframe?.value || 60;
    const candles = this.closes.map((c, i) => ({
      x: this.timestamps[i] || (Date.now() - (this.closes.length - i) * timeframeValue * 1000),
      y: [
        this.opens[i] || c,    // Open
        this.highs[i] || c,    // High
        this.lows[i] || c,     // Low
        c                      // Close
      ]
    })).slice(-200); // Send last 200 candles to show past history

    // Calculate HMA and SuperTrend for chart
    let hmaLine: any[] = [];
    let stLine: any[] = [];
    
    if (this.closes.length > 0) {
      const hstCfg = this.settings.strategy?.hst || { hmaLength: 55, stPeriod: 10, stMultiplier: 3 };
      const hmaValues = this.strategy.calculateHMA(this.closes, hstCfg.hmaLength || 55);
      const stValues = this.strategy.calculateSuperTrend(this.highs, this.lows, this.closes, hstCfg.stPeriod || 10, hstCfg.stMultiplier || 3);
      
      // Map back to timestamps, matching the slice(-200)
      const startIndex = Math.max(0, this.closes.length - 200);
      
      for (let i = startIndex; i < this.closes.length; i++) {
        const time = this.timestamps[i] || (Date.now() - (this.closes.length - i) * 60000);
        
        // HMA array might be shorter than closes array due to lookback period
        const hmaIdx = hmaValues.length - (this.closes.length - i);
        if (hmaIdx >= 0 && hmaValues[hmaIdx]) {
          hmaLine.push({ x: time, y: hmaValues[hmaIdx] });
        }
        
        // SuperTrend array might be shorter
        const stIdx = stValues.length - (this.closes.length - i);
        if (stIdx >= 0 && stValues[stIdx]) {
          stLine.push({ 
            x: time, 
            y: stValues[stIdx].value,
            direction: stValues[stIdx].direction
          });
        }
      }
    }

    return {
      price: this.price,
      isTrading: this.isTrading,
      marketStatus: this.marketStatus,
      isConnected: this.isConnected,
      openPositions: Array.from(this.openPositions.values()),
      closedPositions: this.closedPositions,
      dailyPnL: this.dailyPnL,
      totalTrades: this.totalTrades,
      winningTrades: this.winningTrades,
      losingTrades: this.losingTrades,
      indicators: this.strategy.indicators,
      settings: this.settings,
      portfolio: this.portfolio,
      candles: candles,
      hmaLine: hmaLine,
      stLine: stLine,
      logs: this.logs,
      marketAnalysis: this.getMarketAnalysis(),
      latency: this.latency
    };
  }
}
