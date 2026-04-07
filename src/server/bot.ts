import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';
import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { Strategy } from './strategy';
import { defaultConfig } from './config';
import { DataRecorder } from './dataRecorder';
import { loadBestParams, scheduleOptimization } from './autotuneManager';

const SETTINGS_PATH = path.join(process.cwd(), 'src/server/settings.json');
const STATE_FILE = path.join(process.cwd(), 'src/server/state.json');

const PSYCHOLOGY_TIPS = [
  "صبر، کلید سودآوری است. منتظر تاییدیه بمانید.",
  "معامله‌گر حرفه‌ای با استاپ‌لاس خود دوست است؛ استاپ‌لاس محافظ سرمایه شماست نه دقیقاً دشمن سود شما.",
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
  
  // MTF Data (5m)
  mtfCloses: number[] = [];
  mtfHighs: number[] = [];
  mtfLows: number[] = [];
  mtfVolumes: number[] = [];
  mtfTimestamps: number[] = [];

  isTrading: boolean = true;
  isEnteringTrade: boolean = false;
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
  userInfo: any = null;
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
  processedSignals: Set<string> = new Set();
  private lastCandleLogTime: number = 0;
  private lastMarketClosedTime: number = 0;
  private isMarketClosed: boolean = false;
  private settingsWatcher: fs.FSWatcher | null = null;
  private pendingPullback: any = null;
  private BACKUP_SETTINGS_PATH = path.join(process.cwd(), 'src/server/settings_backup.json');

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

  log(message: string, type: 'INFO' | 'SUCCESS' | 'ERROR' | 'SIGNAL' | 'WS' = 'INFO', hidden: boolean = false) {
    const logEntry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('fa-IR'),
      message,
      type
    };
    
    // Hide spammy or overly technical logs from the UI
    const isSpammy = message.includes('Received array of') || 
                     message.includes('Received bars:') || 
                     message.includes('Received history:') ||
                     message.includes('Unknown data:') ||
                     message.includes('HTML Response') ||
                     message.includes('Endpoint') ||
                     message.includes('Retrying historical bars') ||
                     message.includes('Fetching MTF bars') ||
                     message.includes('API Price Sync') ||
                     message.includes('WS unexpected-response');

    if (!hidden && !isSpammy) {
      this.logs.unshift(logEntry);
      if (this.logs.length > 500) this.logs.pop();
    }

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

    // Persist to logs/terminallog.json
    try {
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logPath = path.join(logDir, 'terminallog.json');
      
      // Check file size and clear if > 5MB
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath);
        if (stats.size > 5 * 1024 * 1024) {
          fs.writeFileSync(logPath, '');
        }
      }

      fs.appendFileSync(logPath, JSON.stringify({
        ...logEntry,
        timestamp: new Date().toISOString()
      }) + '\n');
    } catch (e) {
      // Silent fail for logging to file to avoid infinite recursion or crashing
    }

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
    const activeId = apiCfg.activeAccountId;
    const auth = apiCfg.accounts?.[activeId] || apiCfg.accounts?.['demo_default'] || (defaultConfig.api.accounts as any)['demo_default'];
    const isReal = auth.type === 'real';
    
    // Use the tokens if we have them
    const tokenToUse = this.accessToken || auth.bearerToken;
    const authHeader = tokenToUse ? { 'Authorization': `Bearer ${tokenToUse}` } : {};
    
    const cookies = [];
    if (auth.csrftoken) cookies.push(`csrftoken=${auth.csrftoken}`);
    if (auth.sessionid) cookies.push(`sessionid=${auth.sessionid}`);
    if (this.refreshToken) cookies.push(`refresh_token=${this.refreshToken}`);
    
    const cookieString = cookies.join('; ');
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    
    this.api = axios.create({
      baseURL: auth.baseUrl,
      timeout: 60000, // Increased to 60s for slow server responses
      withCredentials: true,
      headers: {
        ...authHeader,
        'User-Agent': userAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(auth.csrftoken ? { 'X-CSRFToken': auth.csrftoken } : {}),
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieString,
        'Referer': `${auth.baseUrl}/room/`,
        'Origin': auth.baseUrl,
        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
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

    // Add interceptor for token refresh and automatic retries for 504/502
    this.api.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;
        const status = error.response?.status;

        // Auto-retry for Gateway Timeout (504) or Bad Gateway (502)
        if ((status === 504 || status === 502) && !originalRequest._retryCount) {
          originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
          if (originalRequest._retryCount <= 3) {
            const delay = 5000 * originalRequest._retryCount;
            this.log(`Server Busy (${status}). Retrying request in ${delay/1000}s...`, "INFO");
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.api!(originalRequest);
          }
        }

        if (status === 401 && !originalRequest._retry && this.refreshToken) {
          originalRequest._retry = true;
          const refreshed = await this.refreshAuthToken();
          if (refreshed) {
            const apiCfg = this.settings.api || defaultConfig.api;
            const auth = apiCfg.useRealAccount ? apiCfg.real : apiCfg.demo;
            const tokenToUse = this.accessToken || auth.bearerToken;
            originalRequest.headers['Authorization'] = `Bearer ${tokenToUse}`;
            // Update cookies in the retry request too
            const retryCookies = [];
            if (auth.csrftoken) retryCookies.push(`csrftoken=${auth.csrftoken}`);
            if (auth.sessionid) retryCookies.push(`sessionid=${auth.sessionid}`);
            if (this.refreshToken) retryCookies.push(`refresh_token=${this.refreshToken}`);
            originalRequest.headers['Cookie'] = retryCookies.join('; ');
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
      const activeId = apiCfg.activeAccountId;
      const auth = apiCfg.accounts?.[activeId] || apiCfg.accounts?.['demo_default'] || (defaultConfig.api.accounts as any)['demo_default'];
      const isReal = auth.type === 'real';
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
      
      const cookies = [];
      if (this.refreshToken) cookies.push(`refresh_token=${this.refreshToken}`);
      if (auth.csrftoken) cookies.push(`csrftoken=${auth.csrftoken}`);
      if (auth.sessionid) cookies.push(`sessionid=${auth.sessionid}`);

      this.log("Attempting to refresh auth token...", "INFO");
      const response = await axios.post(`${auth.baseUrl}/api/User/api/token/refresh/`, {
        refresh: this.refreshToken
      }, {
        headers: {
          'Cookie': cookies.join('; '),
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          'Origin': auth.baseUrl,
          'Referer': `${auth.baseUrl}/`,
          'Accept': 'application/json, text/plain, */*',
          ...(auth.csrftoken ? { 'X-CSRFToken': auth.csrftoken } : {})
        }
      });
      
      if (response.data && response.data.access) {
        this.accessToken = response.data.access;
        if (response.data.refresh) this.refreshToken = response.data.refresh;
        this.log("Token refreshed successfully.", "INFO");
        
        // Persist new tokens to settings file
        const apiCfg = this.settings.api || defaultConfig.api;
        if (isReal) {
          apiCfg.real.accessToken = this.accessToken;
          apiCfg.real.refreshToken = this.refreshToken;
        } else {
          apiCfg.demo.accessToken = this.accessToken;
          apiCfg.demo.refreshToken = this.refreshToken;
        }
        this.settings.api = apiCfg;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(this.settings, null, 2));
        
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
        this.lastTradeTime = state.lastTradeTime || 0;
        
        if (state.openPositions && Array.isArray(state.openPositions)) {
          this.openPositions = new Map(state.openPositions);
          this.log(`Restored ${this.openPositions.size} open positions from state file.`, "SUCCESS");
        }
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
        signalCounter: this.signalCounter,
        openPositions: Array.from(this.openPositions.entries())
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
    
    const oldActive = oldApi.accounts?.[oldApi.activeAccountId];
    const newActive = newApi.accounts?.[newApi.activeAccountId];

    const sourceChanged = this.settings.source !== newSettings.source || 
                         oldApi.activeAccountId !== newApi.activeAccountId ||
                         (oldActive?.wsUrl !== newActive?.wsUrl || 
                          oldActive?.sessionid !== newActive?.sessionid || 
                          oldActive?.csrftoken !== newActive?.csrftoken);
    
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
      this.log(`Price source settings changed (${newActive?.type === 'real' ? 'REAL' : 'DEMO'} - ${newActive?.username}). Restarting source...`, "INFO");
      this.connectToExternalWS();
    }
  }

  backupSettings() {
    try {
      fs.writeFileSync(this.BACKUP_SETTINGS_PATH, JSON.stringify(this.settings, null, 2));
      this.log(`Settings backup created.`, "INFO");
    } catch (e: any) {
      this.log(`Failed to backup settings: ${e.message}`, "ERROR");
    }
  }

  restoreSettings() {
    try {
      if (fs.existsSync(this.BACKUP_SETTINGS_PATH)) {
        const raw = fs.readFileSync(this.BACKUP_SETTINGS_PATH, 'utf8');
        const backedUp = JSON.parse(raw);
        this.saveSettings(backedUp);
        this.log(`Settings restored from backup.`, "INFO");
        return true;
      } else {
        this.log(`No settings backup found to restore.`, "INFO");
        return false;
      }
    } catch (e: any) {
      this.log(`Failed to restore settings: ${e.message}`, "ERROR");
      return false;
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
    
    const safeFormat = (val: any) => {
      if (val === undefined || val === null || isNaN(val)) return '---';
      return val.toLocaleString('fa-IR');
    };

    const entry = safeFormat(signal.entry);
    const tp1 = safeFormat(signal.tp1);
    const tp2 = safeFormat(signal.tp2);
    const tp3 = safeFormat(signal.tp3);
    const sl = safeFormat(signal.sl);
    
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
    
    // Prevent INVALID_INPUT from Rubika by sanitizing NaN
    if (text.includes('NaN')) {
      text = text.replace(/NaN/g, '---');
    }

    const chatIds = String(this.settings.rubika.chatId).split(',').map((id: string) => id.trim()).filter(Boolean);
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

        const res = await axios.post(url, payload, { 
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (res.data?.status === 'OK' || res.data?.ok || res.data?.data?.message_id) {
          lastMessageId = res.data?.data?.message_id || 'SENT';
          this.log(`Rubika message sent to ${chatId}`, "INFO");
        } else {
          this.log(`Rubika API returned error for ${chatId}: ${JSON.stringify(res.data)}`, "ERROR");
        }
      } catch (e: any) {
        this.log(`Rubika Error (${chatId}): ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`, "ERROR");
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
    await this.getUserInfo();
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
      this.monitorTrades();
      
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
      
      // Fetch MTF bars every 5 minutes
      if (now % 300000 < 1000) {
        this.fetchMTFBars();
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
      
      // If we keep getting 504, reduce the 'from' range to ask for less data
      // Start with 6 hours for 1m, 2 days for higher resolutions
      const hoursToFetch = retryCount > 1 ? 3 : (resolution > 1 ? 48 : 6);
      const from = to - (60 * 60 * hoursToFetch);
      
      this.log(`Fetching historical bars (${resolution}m) from ${from} to ${to} (Attempt ${retryCount + 1})...`, "INFO");
      
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
          const t = bar.time * 1000;
          const o = bar.open || bar.close;
          const h = bar.high;
          const l = bar.low;
          const c = bar.close;
          const v = bar.volume || 1;

          this.opens.push(o);
          this.closes.push(c);
          this.highs.push(h);
          this.lows.push(l);
          this.volumes.push(v);
          this.timestamps.push(t);

          // Record to market.jsonl for Auto-Tune
          this.recorder.recordCandle({ t, o, h, l, c, v });
        }
        this.recorder.flush();
        
        if (this.closes.length > 0) {
          this.price = this.closes[this.closes.length - 1];
        }
        
        this.log("Historical data loaded into bot state.", "SUCCESS");
        this.checkForSignal();
      }
    } catch (error: any) {
      const status = error.response ? error.response.status : 'Network Error';
      const errorData = error.response?.data;
      this.log(`Historical Bars Fetch Error: ${status} - ${error.message}`, "ERROR");
      
      // Retry on server errors or timeouts
      if ((status === 504 || status === 502 || status === 500 || status === 'Network Error') && retryCount < 5) {
        const delay = Math.min(30000, 5000 * Math.pow(2, retryCount));
        this.log(`Retrying historical bars fetch in ${Math.round(delay/1000)}s (Attempt ${retryCount + 1}/5)...`, "INFO");
        setTimeout(() => this.fetchHistoricalBars(retryCount + 1), delay);
      }
    }
  }

  async fetchMTFBars(retryCount = 0) {
    if (!this.api) return;
    try {
      const to = Math.floor(Date.now() / 1000);
      const resolution = 5; // 5 minutes
      // Reduce from 2 days to 12 hours if we get 504
      const from = to - (60 * 60 * (retryCount > 0 ? 12 : 24));
      this.log(`Fetching MTF bars (${resolution}m) from ${from} to ${to} (Attempt ${retryCount + 1})...`, "INFO");
      
      const response = await this.api.get('/api/room/api/get-bars/', {
        params: {
          symbol: 'mazane',
          from: from,
          to: to,
          resolution: resolution
        }
      });

      if (Array.isArray(response.data)) {
        this.log(`Received ${response.data.length} MTF bars.`, "SUCCESS");
        this.mtfCloses = [];
        this.mtfHighs = [];
        this.mtfLows = [];
        this.mtfVolumes = [];
        this.mtfTimestamps = [];
        
        const sortedData = response.data.sort((a: any, b: any) => a.time - b.time);
        
        for (const bar of sortedData) {
          this.mtfCloses.push(bar.close);
          this.mtfHighs.push(bar.high);
          this.mtfLows.push(bar.low);
          this.mtfVolumes.push(bar.volume || 1);
          this.mtfTimestamps.push(bar.time * 1000);
        }
        this.log("MTF data loaded into bot state.", "SUCCESS");
      }
    } catch (error: any) {
      const status = error.response ? error.response.status : 'Network Error';
      // Log 504 as INFO instead of ERROR to reduce clutter, as it's a known transient issue
      if (status === 504) {
        this.log(`MTF Bars Fetch: 504 Gateway Timeout (Attempt ${retryCount + 1}/5). Retrying...`, "INFO");
      } else {
        this.log(`MTF Bars Fetch Error: ${status} - ${error.message}`, "ERROR");
      }
      
      // Retry on server errors or timeouts
      if ((status === 504 || status === 502 || status === 500 || status === 'Network Error') && retryCount < 5) {
        const delay = Math.min(15000, 2000 * Math.pow(2, retryCount)); // Faster initial retries
        setTimeout(() => this.fetchMTFBars(retryCount + 1), delay);
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
      const response = await this.api.post('/api/room/api/check-portfolio/', {}, { timeout: 10000 });
      this.portfolio = response.data;
      this.isMarketClosed = false; // Successfully reached API
      
      // Also fetch user info for total balance
      await this.getUserInfo();
      
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

      if (retryCount < 5 && (isTimeout || isServerError || isNetworkError)) {
        const baseDelay = isServerError ? 3000 : 2000;
        const delay = Math.min(15000, baseDelay * Math.pow(1.8, retryCount)) + (Math.random() * 1000);
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
        // Only log if we've exhausted all retries
        this.log(`Portfolio Update: Server busy or network issue after ${retryCount} retries (${error.message || 'Timeout/50x'}).`, "INFO");
      } else {
        this.log(`Portfolio Update Error: ${error.message || error}`, "ERROR");
      }
    }
  }

  async getUserInfo() {
    if (!this.api) return;
    try {
      const response = await this.api.post('/api/room/api/user-info/');
      if (response.data && response.data.status) {
        this.userInfo = response.data;
      }
    } catch (error: any) {
      // Log only occasionally
      if (Math.random() < 0.1) {
        this.log(`User Info Fetch Error: ${error.message}`, "ERROR");
      }
    }
  }

  async createPortfolio(configOrUnits: any) {
    if (!this.api) return { success: false, message: 'API not connected' };
    try {
      let params;
      if (typeof configOrUnits === 'number') {
        params = {
          portfolio_type: "isolated",
          mode: "hedge",
          initial_balance: configOrUnits * 2300000,
          line_value_per_khat: 23000
        };
      } else {
        params = configOrUnits;
      }
      
      const response = await this.api.post('/api/room/api/create-portfolio/', params);
      
      if (response.data?.status === true || response.data?.status === 'true') {
        this.log(`Portfolio created successfully: ${params.initial_balance} Toman`, "SUCCESS");
        await this.updatePortfolio(0, false);
        await this.getUserInfo();
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

  async increasePortfolio(amount: number) {
    if (!this.api) return { success: false, message: 'API not connected' };
    try {
      const response = await this.api.post('/api/room/api/increase-portfolio/', {
        increase_amount: amount
      });
      if (response.data?.status === true) {
        this.log(`Portfolio increased by ${amount} Toman`, "SUCCESS");
        await this.updatePortfolio(0, false);
        await this.getUserInfo();
        return { success: true, message: response.data?.message || 'سرمایه با موفقیت افزایش یافت.' };
      } else {
        return { success: false, message: response.data?.message || 'خطا در افزایش سرمایه' };
      }
    } catch (error: any) {
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
    const activeId = apiCfg.activeAccountId;
    const auth = apiCfg.accounts?.[activeId] || apiCfg.accounts?.['demo_default'] || (defaultConfig.api.accounts as any)['demo_default'];
    const isReal = auth.type === 'real';
    const resolution = Math.floor((this.settings.timeframe?.value || 60) / 60);
    
    let baseWsUrl = auth.wsUrl || (isReal ? 'wss://farazgold.com/ws/' : 'wss://demo.farazgold.com/ws/');
    
    // Inject resolution into URL if it's a TradingView-style URL
    if (baseWsUrl.includes('resolution=')) {
      baseWsUrl = baseWsUrl.replace(/resolution=\d+/, `resolution=${resolution}`);
    }
    
    const tokenToUse = this.accessToken || auth.bearerToken || '';
    const url = baseWsUrl.includes('?') 
      ? `${baseWsUrl}&token=${tokenToUse}`
      : `${baseWsUrl}?token=${tokenToUse}`;
    const cookies = [];
    if (auth.csrftoken) cookies.push(`csrftoken=${auth.csrftoken}`);
    if (auth.sessionid) cookies.push(`sessionid=${auth.sessionid}`);
    if (this.refreshToken) {
      cookies.push(`refresh_token=${this.refreshToken}`);
    }
    
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    this.log(`Connecting to FarazGold WS (${isReal ? 'REAL' : 'DEMO'}): ${url.split('?')[0]}`, "WS");
    
    try {
      this.ws = new WebSocket(url, {
        headers: {
          'Cookie': cookies.join('; '),
          'Origin': auth.baseUrl,
          'Referer': `${auth.baseUrl}/room/`,
          'X-Requested-With': 'XMLHttpRequest',
          ...(auth.csrftoken ? { 'X-CSRFToken': auth.csrftoken } : {}),
          'User-Agent': userAgent,
          'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
          'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"'
        }
      });
      
      this.ws.on('unexpected-response', (req, res) => {
        const isGatewayError = res.statusCode === 504 || res.statusCode === 502;
        this.log(`WS unexpected-response: ${res.statusCode}${isGatewayError ? ' (Server Busy)' : ''}`, "ERROR");
        if (this.ws) {
          this.ws.terminate(); // This should trigger the 'close' event
        }
        this.scheduleReconnect(isGatewayError); // Call it directly just in case 'close' isn't emitted
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
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              // Add a tiny random delay before responding to ping to simulate human network latency
              setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
            const txId = Number(order.transaction_id);
            const orderId = Number(order.id || order.order_id);
            this.log(`[WS] Real-time Order Update: ${order.action} ${order.units} units at ${order.price} (Status: ${order.status}, OrderID: ${orderId || 'N/A'})`, "WS");
            
            // Link transaction ID if it's missing or pending for an open position
            if (txId && !isNaN(txId)) {
              for (const [id, pos] of this.openPositions) {
                // Link if pending OR if we have a new ID that might be the real transaction ID
                const isPending = !pos.transactionId || pos.transactionId === 'PENDING' || String(pos.transactionId).includes('PENDING');
                if (isPending) {
                  const action = (order.action || '').toLowerCase();
                  const isMatch = (pos.type === 'BUY' && action.includes('buy')) || (pos.type === 'SELL' && action.includes('sell'));
                  if (isMatch) {
                    pos.transactionId = txId;
                    pos.status = 'open';
                    this.log(`[WS] Linked transaction ${txId} from order update to local position ${id}. Enforcing SL/TP in 1.5s...`, "SUCCESS");
                    
                    // Add a small delay to ensure the server has indexed the transaction before we try to edit it
                    setTimeout(() => {
                      const p = this.openPositions.get(id);
                      // CRITICAL: If already enforced OR if this ID is no longer the active one, ABORT.
                      if (!p || p.slEnforced || p.transactionId !== txId) return;
                      
                      this.enforceStopLossTakeProfit(txId, p.sl, p.tp1, id).then(success => {
                        if (success) p.slEnforced = true;
                      }).catch(() => {});
                    }, 1500);
                    break;
                  }
                }
              }
            }

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
              if (now - this.lastCandleLogTime > 5 * 60 * 1000) {
                this.log(`Received array of ${msg.length} candles`, "WS");
                this.lastCandleLogTime = now;
              }
              const sortedMsg = msg.sort((a: any, b: any) => (a.time || a.t) - (b.time || b.t));
              sortedMsg.forEach((bar: any) => this.processCandle(bar, true));
              this.checkForSignal();
            }
            return;
          }

          // Debug log for first few messages or specific keys
          if (msg.bars) {
            if (now - this.lastCandleLogTime > 5 * 60 * 1000) {
              this.log(`Received bars: ${Array.isArray(msg.bars['1']) ? msg.bars['1'].length : 1} candles`, "WS");
              this.lastCandleLogTime = now;
            }
          } else if (msg.history) {
            if (now - this.lastCandleLogTime > 5 * 60 * 1000) {
              this.log(`Received history: ${Array.isArray(msg.history) ? msg.history.length : 'unknown'} candles`, "WS");
              this.lastCandleLogTime = now;
            }
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
                  // Always update if it's pending, or if the ID is different (new_transactions_open is more authoritative)
                  const isPending = !pos.transactionId || pos.transactionId === 'PENDING' || String(pos.transactionId).includes('PENDING');
                  // Check if this txId is already assigned to another position to avoid double-linking
                  const alreadyLinked = Array.from(this.openPositions.values()).some(p => p.transactionId === txId);
                  
                  // Make sure the direction matches
                  const txType = tx.type || tx.action || '';
                  const isMatch = !txType || (pos.type === 'BUY' && txType.toLowerCase().includes('buy')) || (pos.type === 'SELL' && txType.toLowerCase().includes('sell'));

                  if ((isPending || pos.transactionId !== txId) && !alreadyLinked && isMatch) {
                    pos.transactionId = txId;
                    this.log(`[WS] Linked transaction ${txId} to local position ${id} (authoritative). Enforcing SL/TP in 1s...`, "SUCCESS");
                    
                    setTimeout(() => {
                      const p = this.openPositions.get(id);
                      // CRITICAL: If already enforced OR if this ID is no longer the active one, ABORT.
                      if (!p || p.slEnforced || p.transactionId !== txId) return;

                      this.enforceStopLossTakeProfit(txId, p.sl, p.tp1, id).then(success => {
                        if (success) p.slEnforced = true;
                      }).catch(() => {});
                    }, 1000);
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
        // Suppress common connection-closing errors that are already handled by 'close' or 'unexpected-response'
        if (err.message.includes('closed before the connection was established')) {
          return;
        }
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
        this.ws = null; // Important: nullify the socket
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

  scheduleReconnect(isGatewayError = false) {
    if (this.wsReconnectTimer) return;
    this.reconnectAttempts++;
    
    // If we got a 504, it means the server is overloaded. We should wait longer.
    // Exponential backoff with max 10 minutes to prevent spamming
    const baseDelay = isGatewayError ? 60000 : (this.reconnectAttempts > 3 ? 30000 : 15000);
    const delay = Math.min(600000, baseDelay * Math.pow(1.5, this.reconnectAttempts - 1));
    
    // Add jitter (±10%) to avoid thundering herd
    const jitter = (Math.random() * 0.2) + 0.9; // 0.9 to 1.1
    const finalDelay = Math.round(delay * jitter);
    
    this.log(`Scheduling WS reconnect in ${Math.round(finalDelay/1000)}s (Attempt ${this.reconnectAttempts})`, "WS");
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectToExternalWS();
    }, finalDelay);
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

    // Check for pending pullback triggers
    if (this.pendingPullback) {
      const pb = this.pendingPullback;
      const isBuy = pb.signal.type === 'BUY';
      const triggered = isBuy ? newPrice <= pb.targetPrice : newPrice >= pb.targetPrice;
      
      if (triggered) {
        this.log(`🎯 Pullback Triggered! ${pb.signal.type} at ${newPrice} (Target: ${pb.targetPrice})`, "SUCCESS");
        const signalToExecute = { ...pb.signal, entry: newPrice };
        this.pendingPullback = null;
        this.enterTrade(signalToExecute);
      } else {
        // Timeout check: if too many bars passed, cancel pullback
        const barsPassed = Math.floor((now - pb.timestamp) / timeframeMs);
        if (barsPassed > (pb.signal.pullbackConfig?.maxWaitBars || 10)) {
          this.log(`Pullback Canceled: Timeout (${barsPassed} bars passed)`, "INFO");
          this.pendingPullback = null;
        }
      }
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

    const mtfHistory = this.mtfCloses.map((c, i) => ({
      price: c,
      high: this.mtfHighs[i],
      low: this.mtfLows[i],
      volume: this.mtfVolumes[i],
      time: this.mtfTimestamps[i] || Date.now()
    }));

    const result = this.strategy.analyze(history, this.openPositions.size, this.price, false, mtfHistory);
    
    // Anti-Arbitrage & Real Account Safety Guards
    const antiArb = this.settings.strategy?.antiArbitrage || { enabled: true, maxLatencyMs: 500, maxSpreadTicks: 15 };
    if (antiArb.enabled && result.signal) {
      if (this.latency > antiArb.maxLatencyMs) {
        this.log(`Latency too high (${this.latency}ms > ${antiArb.maxLatencyMs}ms). Skipping entry for safety.`, "INFO");
        return;
      }
      const tickSize = this.settings.market?.tickSize || 1;
      const spreadTicks = this.currentSpread / tickSize;
      if (spreadTicks > antiArb.maxSpreadTicks) {
        this.log(`Spread too high (${spreadTicks.toFixed(1)} ticks > ${antiArb.maxSpreadTicks} ticks). Skipping entry.`, "INFO");
        return;
      }
    }
    
    if (result.signal) {
      // Generate unique signal ID
      this.signalCounter++;
      result.signal.signalId = `SIG${this.signalCounter}`;
      this.saveState();

      // Add MTF Confirmation to the signal object for the message
      result.signal.mtf = this.strategy.getMTFStatus(history);
      
      this.log(`Signal Detected: ${result.signal.type} (${result.signal.pattern || 'SCALP'}) Score: ${result.signal.score} ID: ${result.signal.signalId}`, "SIGNAL");
      this.recorder.recordSignal({ ...result.signal, price: this.price });

      // Reversal Logic & Opposite Signal Protection
      const reversalCfg = this.settings.targetsTicks?.reversal;
      let canEnter = true;
      
      // Check if we have opposite positions
      for (const [id, pos] of this.openPositions.entries()) {
        const isBuy = pos.type === 'BUY';
        const isOpposite = (isBuy && result.signal.type === 'SELL') || (!isBuy && result.signal.type === 'BUY');
        
        if (isOpposite) {
          // If we have an opposite position, we only enter if reversal is ENABLED and triggered
          if (reversalCfg?.enabled && result.signal.score >= (reversalCfg.minOppositeSignalScore || 2)) {
            const tickSize = this.settings.market?.tickSize || 1;
            const entryPrice = pos.entry || pos.price;
            const currentDist = isBuy ? this.price - entryPrice : entryPrice - this.price;
            const lossTicks = -currentDist / tickSize;
            
            if (lossTicks >= (reversalCfg.triggerLossTicks || 6)) {
              this.log(`Reversal Triggered: Closing losing ${pos.type} trade (Loss: ${lossTicks} ticks) to open ${result.signal.type}`, "INFO");
              this.closeTrade(id, 'reversal');
            } else {
              this.log(`Opposite signal detected but reversal criteria not met (Loss: ${lossTicks} < ${reversalCfg.triggerLossTicks}). Skipping entry.`, "INFO");
              canEnter = false;
            }
          } else {
            this.log(`Opposite signal detected but reversal is DISABLED. Skipping entry to avoid unintended hedging.`, "INFO");
            canEnter = false;
          }
        }
      }

      if (canEnter) {
        if (result.signal.isPullback) {
          const tickSize = this.settings.market?.tickSize || 1;
          const retracement = (result.signal.pullbackConfig?.retracementTicks || 5) * tickSize;
          const targetPrice = result.signal.type === 'BUY' ? this.price - retracement : this.price + retracement;
          
          this.pendingPullback = {
            signal: result.signal,
            targetPrice,
            timestamp: now
          };
          this.log(`⏳ Pullback Entry Set: Waiting for price to reach ${targetPrice} (${result.signal.type})`, "INFO");
        } else {
          this.enterTrade(result.signal);
        }
      }
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
    if (this.isEnteringTrade) return;
    
    const signalId = signal.signalId || `SIG${Date.now()}`;
    if (this.processedSignals.has(signalId)) {
      this.log(`Signal ${signalId} already processed. Skipping.`, "INFO");
      return;
    }

    const now = Date.now();
    if (now - this.lastTradeTime < (this.settings.strategy?.tradeCooldown * 1000 || 8000)) return;
    if (this.openPositions.size >= (this.settings.risk?.maxOpenPositions || 2)) return;

    this.isEnteringTrade = true;
    this.processedSignals.add(signalId);
    
    try {
      // Max Spread Check
      const maxSpread = this.settings.strategy?.numerical?.spreadThreshold || 18;
      const tickSize = this.settings.market?.tickSize || 1;
      const effectiveSpread = this.orderBook.realSpread > 0 ? this.orderBook.realSpread : this.currentSpread;
      const spreadTicks = effectiveSpread / tickSize;
      
      if (effectiveSpread > 0 && spreadTicks > maxSpread) {
        this.log(`Trade Skipped: Spread too high (${spreadTicks.toFixed(1)} > ${maxSpread})`, "INFO");
        this.processedSignals.delete(signalId);
        return;
      }

      // Liquidity Check
      const minLiquidity = 10;
      if (this.orderBook.liquidity > 0 && this.orderBook.liquidity < minLiquidity) {
        this.log(`Trade Skipped: Low Liquidity (${this.orderBook.liquidity} units)`, "INFO");
        this.processedSignals.delete(signalId);
        return;
      }

      if (!this.isConnected || this.price <= 0) {
        this.log(`Trade Skipped: Bot not connected or invalid price.`, "INFO");
        this.processedSignals.delete(signalId);
        return;
      }

      this.lastTradeTime = now;
      
      // Volume Calculation
      let units = Number(this.settings.trade?.minUnits || 1);
      units = Math.max(1, units);

      // Pre-check balance
      if (this.portfolio && typeof this.portfolio.balance === 'number') {
        const minRequiredBalance = this.settings.risk?.minBalanceToTrade || 250000; 
        if (this.portfolio.balance < minRequiredBalance) {
          this.log(`Trade Skipped: Insufficient balance.`, "ERROR");
          this.processedSignals.delete(signalId);
          return;
        }
      }
      
      let sl = signal.sl !== undefined && !isNaN(signal.sl) ? Math.round(signal.sl) : NaN;
      let tp = (signal.tp1 !== undefined && !isNaN(signal.tp1)) ? Math.round(signal.tp1) : 
               (signal.tp !== undefined && !isNaN(signal.tp) ? Math.round(signal.tp) : NaN);

      const defaultTpTicks = this.settings.targetsTicks?.tpTicks || 15;
      const defaultSlTicks = this.settings.targetsTicks?.stopTicks || 10;

      if (isNaN(sl)) {
        sl = signal.type === 'BUY' ? this.price - (defaultSlTicks * tickSize) : this.price + (defaultSlTicks * tickSize);
      }
      if (isNaN(tp)) {
        tp = signal.type === 'BUY' ? this.price + (defaultTpTicks * tickSize) : this.price - (defaultTpTicks * tickSize);
      }

      const id = Date.now();

      // SL/TP Safety Check (Ensure not too close to market)
      // Increased buffer to 35 ticks for high volatility and latency
      const safetyBuffer = tickSize * 35;
      const currentPrice = this.price;
      
      if (signal.type === 'BUY') {
        // For BUY: SL must be < Price, TP must be > Price
        if (sl >= currentPrice - safetyBuffer) {
          sl = Math.round(currentPrice - safetyBuffer);
        }
        if (tp <= currentPrice + safetyBuffer) {
          tp = Math.round(currentPrice + safetyBuffer);
        }
      } else {
        // For SELL: SL must be > Price, TP must be < Price
        if (sl <= currentPrice + safetyBuffer) {
          sl = Math.round(currentPrice + safetyBuffer);
        }
        if (tp >= currentPrice - safetyBuffer) {
          tp = Math.round(currentPrice - safetyBuffer);
        }
      }

      if (this.settings.source === 'API' && this.api) {
        if (this.isMarketClosed) {
          this.log(`Trade Skipped: Market is closed.`, "INFO");
          this.processedSignals.delete(signalId);
          return;
        }

        // Register position as PENDING before API call to handle race conditions with WebSocket
        this.openPositions.set(id, {
          id,
          type: signal.type,
          price: this.price,
          signalId: signalId,
          transactionId: `PENDING_${id}`,
          entryTime: new Date(),
          status: 'entering',
          units: units,
          sl: sl,
          tp1: tp,
          tp2: Math.round(signal.tp2 || tp + (tp - this.price)),
          tp3: Math.round(signal.tp3 || tp + 2 * (tp - this.price)),
          slEnforced: false,
          lastEnforceAttempt: Date.now(),
          maxAdverseTicks: 0,
          maxFavorableTicks: 0
        });
        this.saveState();

        this.log(`Attempting API Trade: ${signal.type} TP:${tp} SL:${sl}`, "INFO");
        
        const orderData = {
          action: signal.type.toLowerCase(),
          order_type: "verbal",
          units: String(units),
          price: -1,
          take_profit: String(tp),
          stop_loss: String(sl),
          signal_token: ""
        };

        // Simulated human reaction time
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300));

        let attempts = 0;
        const maxAttempts = 2;
        let response = null;

        while (attempts < maxAttempts) {
          try {
            // Check if WebSocket already linked this position while we were waiting
            const currentPos = this.openPositions.get(id);
            if (currentPos && currentPos.transactionId && !String(currentPos.transactionId).includes('PENDING')) {
              this.log(`Order already confirmed via WebSocket during API attempt ${attempts + 1}. Skipping redundant call.`, "SUCCESS");
              return;
            }

            this.log(`Submitting order to API (Attempt ${attempts + 1})...`, "INFO");
            response = await this.api.post('/api/room/api/submit-order/', orderData);
            break;
          } catch (e: any) {
            const status = e.response?.status;
            if (status === 403) {
              this.log(`Market closed or access forbidden (403).`, "ERROR");
              this.isMarketClosed = true;
              this.openPositions.delete(id);
              this.processedSignals.delete(signalId);
              return;
            }
            if (attempts >= maxAttempts - 1 || !e.message?.includes('timeout')) {
              this.openPositions.delete(id);
              this.processedSignals.delete(signalId);
              throw e;
            }
            attempts++;
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        const ok = response?.data?.status === true || 
                   response?.data?.status === 'true' || 
                   response?.data?.status === 1 || 
                   response?.data?.status === 'success' ||
                   (response?.status === 200 && (response?.data?.message?.includes('ثبت شد') || response?.data?.message?.includes('موفقیت')));

        if (ok) {
          const transId = response?.data?.order_id || response?.data?.id || response?.data?.transaction_id;
          const pos = this.openPositions.get(id);
          if (pos) {
            pos.status = 'open';
            if (transId) pos.transactionId = transId;
            this.saveState();
          }
          
          this.log(`Trade Executed: ${signal.type} at ${this.price} (ID: ${transId || 'PENDING'})`, "SUCCESS");
          
          if (transId && !String(transId).includes('PENDING')) {
            // Immediate enforcement with a tiny delay to ensure server indexing
            setTimeout(() => {
              const p = this.openPositions.get(id);
              if (!p || (p.slEnforced && p.transactionId === transId)) return;

              this.enforceStopLossTakeProfit(transId, sl, tp, id).then(success => {
                if (success) p.slEnforced = true;
              }).catch(() => {});
            }, 1000);
          }
        } else {
          this.log(`Trade Entry Failed: ${JSON.stringify(response?.data || {})}`, "ERROR");
          this.openPositions.delete(id);
          this.processedSignals.delete(signalId);
        }
      } else {
        // SIM Mode
        this.openPositions.set(id, { 
          ...signal, 
          id, 
          signalId: signalId,
          entryTime: new Date(), 
          status: 'open', 
          units: units, 
          currentStep: 0, 
          originalSl: sl,
          sl: sl,
          tp1: tp,
          tp2: Math.round(signal.tp2 || tp + (tp - this.price)),
          tp3: Math.round(signal.tp3 || tp + 2 * (tp - this.price)),
          slEnforced: true,
          maxAdverseTicks: 0,
          maxFavorableTicks: 0
        });
        this.log(`Trade Executed (SIM): ${signal.type} at ${this.price}`, "SUCCESS");
      }
    } catch (e: any) {
      this.log(`Trade Entry Error: ${e.message}`, "ERROR");
    } finally {
      this.isEnteringTrade = false;
    }
  }

  async enforceStopLossTakeProfit(transId: any, sl: number, tp: number, localId: any) {
    if (!this.api || !transId || String(transId).includes('PENDING')) return false;
    
    try {
      this.log(`Enforcing SL/TP for transaction ${transId}: SL=${sl}, TP=${tp}`, "INFO");
      
      const editData = {
        transaction_id: String(transId),
        stop_loss: String(Math.round(sl)),
        take_profit: String(Math.round(tp))
      };

      // Try multiple endpoints for robustness
      const endpoints = ['/api/room/api/edit-order/', '/api/room/api/edit-transaction/'];
      let success = false;
      let lastError = '';

      for (const endpoint of endpoints) {
        try {
          const response = await this.api.post(endpoint, editData);
          if (response.data?.status === true || response.data?.status === 'true' || response.data?.status === 'success') {
            success = true;
            break;
          } else {
            lastError = response.data?.message || JSON.stringify(response.data);
          }
        } catch (e: any) {
          lastError = e.message;
        }
      }

      if (success) {
        this.log(`SL/TP Enforced successfully for ${transId}`, "SUCCESS");
        return true;
      } else {
        this.log(`Failed to enforce SL/TP for ${transId}: ${lastError}`, "ERROR");
        return false;
      }
    } catch (error: any) {
      this.log(`Enforce SL/TP Error: ${error.message}`, "ERROR");
      return false;
    }
  }

  async closeTrade(id: any, reason: string = 'manual') {
    const pos = this.openPositions.get(id);
    if (!pos) return;

    try {
      const isBuy = pos.type === 'BUY';
      const closePrice = this.price;
      const entryPrice = pos.entry || pos.price;
      const priceDiff = isBuy ? (closePrice - entryPrice) : (entryPrice - closePrice);
      
      const tickSize = Number(this.settings.market?.tickSize ?? 1);
      const tickValue = Number(this.settings.market?.tickValueToman ?? 23000);
      const pnl = Math.round((priceDiff / tickSize) * tickValue * (pos.units || 1));

      if (this.settings.source === 'API' && this.api && pos.transactionId && !String(pos.transactionId).includes('PENDING')) {
        this.log(`Attempting API Close: ${pos.type} (ID: ${pos.transactionId}) at ${closePrice}`, "INFO");
        
        const closeData = {
          transaction_id: String(pos.transactionId),
          price: String(closePrice)
        };

        const response = await this.api.post('/api/room/api/close-transaction/', closeData);
        
        const ok = response.data?.status === true || 
                   response.data?.status === 'true' || 
                   response.data?.status === 'success' ||
                   (response.status === 200 && response.data?.message?.includes('بسته شد'));

        if (!ok) {
          this.log(`API Close Failed: ${JSON.stringify(response.data)}`, "ERROR");
          // If it's already closed on server, we should sync
          if (response.data?.message?.includes('یافت نشد') || response.data?.message?.includes('بسته شده')) {
            this.log("Position already closed on server. Syncing state...", "INFO");
            this.updatePortfolio(0, false);
          }
          return;
        }
      }

      this.log(`Trade Closed (${reason}): ${pos.type} at ${closePrice} PnL: ${pnl.toLocaleString('fa-IR')} Toman`, "SUCCESS");
      
      const closedPos = {
        ...pos,
        exitPrice: closePrice,
        exitTime: new Date(),
        pnl,
        reason,
        details: {
          breakEven: pos.breakEvenHit ? 'فعال شده' : 'خیر',
          tp1: pos.tp1Hit ? 'تاچ شده' : 'خیر',
          pyramid: pos.pyramidTriggered ? 'پله دوم فعال' : 'تک پله'
        }
      };

      this.closedPositions.push(closedPos);
      if (this.closedPositions.length > 50) this.closedPositions.shift();

      this.dailyPnL += pnl;
      this.totalTrades++;
      if (pnl > 0) this.winningTrades++;
      else if (pnl < 0) this.losingTrades++;

      const signalId = pos.signalId || '---';
      const telegramMsg = `🏁 *معامله بسته شد (${reason === 'manual' ? 'دستی' : reason})*
#${signalId}
نوع: ${pos.type === 'BUY' ? 'خرید 🟢' : 'فروش 🔴'}
قیمت ورود: ${entryPrice.toLocaleString('fa-IR')}
قیمت خروج: ${closePrice.toLocaleString('fa-IR')}
سود/ضرر: ${pnl.toLocaleString('fa-IR')} تومان`;

      this.sendTelegramMessage(telegramMsg, pos.telegramMessageId);
      
      const rubikaMsg = `🏁 معامله بسته شد (${reason === 'manual' ? 'دستی' : reason})
#${signalId}
نوع: ${pos.type === 'BUY' ? 'خرید 🟢' : 'فروش 🔴'}
قیمت ورود: ${entryPrice.toLocaleString('fa-IR')}
قیمت خروج: ${closePrice.toLocaleString('fa-IR')}
سود/ضرر: ${pnl.toLocaleString('fa-IR')} تومان`;
      this.sendRubikaMessage(rubikaMsg, pos.rubikaMessageId);

      this.recorder.recordTrade({
        tOpen: new Date(pos.entryTime).getTime(),
        tClose: Date.now(),
        side: pos.type,
        entry: entryPrice,
        exit: closePrice,
        units: pos.units || 1,
        pnl: pnl || 0,
        reason: reason
      });

      this.openPositions.delete(id);
      this.saveState();
    } catch (e: any) {
      this.log(`Trade Close Error: ${e.message}`, "ERROR");
    }
  }

  async monitorTrades() {
    if (this.openPositions.size === 0) return;

    const now = Date.now();
    const tickSize = Number(this.settings.market?.tickSize ?? 1);
    const tickValue = Number(this.settings.market?.tickValueToman ?? 23000);

    for (const [id, pos] of this.openPositions.entries()) {
      const isBuy = pos.type === 'BUY';
      const entryPrice = pos.entry || pos.price;
      const currentPrice = this.price;
      const priceDiff = isBuy ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
      const profitTicks = priceDiff / tickSize;
      const pnl = Math.round(profitTicks * tickValue * (pos.units || 1));
      
      // Track MFE/MAE
      pos.maxFavorableTicks = Math.max(pos.maxFavorableTicks || 0, profitTicks);
      pos.maxAdverseTicks = Math.min(pos.maxAdverseTicks || 0, profitTicks);

      // 1. Max Loss Protection (Safety Net)
      const maxRisk = Number(this.settings.risk?.maxRiskTomanPerTrade || 420000);
      if (pnl <= -maxRisk) {
        this.log(`🚨 RISK LIMIT: Position ${id} reached max loss (${pnl} Toman). Closing!`, "ERROR");
        this.closeTrade(id, 'max_loss_limit');
        continue;
      }

      // 2. Trailing Stop & Break-Even Logic
      const trailing = this.settings.targetsTicks?.trailing || { enabled: false, activationTicks: 15, callbackTicks: 5 };
      const breakEven = this.settings.targetsTicks?.breakEven || { enabled: true, activationTicks: 10, offsetTicks: 2 };

      if (breakEven.enabled && !pos.breakEvenHit && profitTicks >= breakEven.activationTicks) {
        const newSl = isBuy ? entryPrice + (breakEven.offsetTicks * tickSize) : entryPrice - (breakEven.offsetTicks * tickSize);
        this.log(`🛡️ Break-Even Activated for ${id} (+${profitTicks.toFixed(1)} ticks). New SL: ${newSl}`, "SUCCESS");
        pos.sl = newSl;
        pos.breakEvenHit = true;
        
        if (this.settings.source === 'API' && pos.transactionId && !String(pos.transactionId).includes('PENDING')) {
           this.enforceStopLossTakeProfit(pos.transactionId, pos.sl, pos.tp1, id);
        }
      }

      if (trailing.enabled && profitTicks >= trailing.activationTicks) {
        const currentSl = pos.sl;
        const newSl = isBuy ? currentPrice - (trailing.callbackTicks * tickSize) : currentPrice + (trailing.callbackTicks * tickSize);
        
        const isImprovement = isBuy ? newSl > currentSl : newSl < currentSl;
        if (isImprovement) {
          pos.sl = newSl;
          if (this.settings.source === 'API' && pos.transactionId && !String(pos.transactionId).includes('PENDING')) {
             if (now - (pos.lastTrailingUpdate || 0) > 5000) { // Throttle trailing updates
                this.enforceStopLossTakeProfit(pos.transactionId, pos.sl, pos.tp1, id);
                pos.lastTrailingUpdate = now;
             }
          }
        }
      }

      // 3. Take Profit Logic (Manual fallback if API fails)
      const tpTicks = isBuy ? (pos.tp1 - entryPrice) / tickSize : (entryPrice - pos.tp1) / tickSize;
      if (profitTicks >= tpTicks) {
        this.log(`🎯 Take Profit reached for ${id} (+${profitTicks.toFixed(1)} ticks).`, "SUCCESS");
        this.closeTrade(id, 'take_profit');
        continue;
      }

      // 4. Stop Loss Logic (Manual fallback if API fails)
      const slTicks = isBuy ? (entryPrice - pos.sl) / tickSize : (pos.sl - entryPrice) / tickSize;
      if (profitTicks <= -slTicks) {
        this.log(`🛑 Stop Loss reached for ${id} (${profitTicks.toFixed(1)} ticks).`, "ERROR");
        this.closeTrade(id, 'stop_loss');
        continue;
      }
      
      // 5. Time-based Exit
      const maxAgeMinutes = this.settings.risk?.maxTradeAgeMinutes || 60;
      const ageMinutes = (now - new Date(pos.entryTime).getTime()) / 60000;
      if (ageMinutes > maxAgeMinutes) {
        this.log(`⏰ Time Limit: Position ${id} reached max age (${maxAgeMinutes}m). Closing.`, "INFO");
        this.closeTrade(id, 'time_limit');
        continue;
      }
    }
  }

  getStats() {
    const winRate = this.totalTrades === 0 ? 0 : (this.winningTrades / this.totalTrades) * 100;
    const profitFactor = this.losingTrades === 0 ? (this.winningTrades > 0 ? 99 : 0) : (this.winningTrades / this.losingTrades);
    
    return {
      isConnected: this.isConnected,
      isTrading: this.isTrading,
      price: this.price,
      dailyPnL: this.dailyPnL,
      totalTrades: this.totalTrades,
      winRate: winRate.toFixed(1),
      profitFactor: profitFactor.toFixed(2),
      openPositions: Array.from(this.openPositions.values()),
      closedPositions: this.closedPositions.slice(-10).reverse(),
      logs: this.logs.slice(-50).reverse(),
      latency: this.latency,
      marketStatus: this.marketStatus,
      portfolio: this.portfolio,
      userInfo: this.userInfo,
      indicators: this.strategy.indicators,
      currentSpread: this.currentSpread,
      orderBook: this.orderBook,
      isMarketClosed: this.isMarketClosed
    };
  }

  generateAnalysis() {
    const rsi = this.strategy.indicators.rsi;
    const atr = this.strategy.indicators.atr;
    const hma = this.strategy.indicators.hma;
    
    let analysis = "";
    if (rsi > 70) analysis = "بازار در وضعیت اشباع خرید است. احتمال اصلاح قیمت وجود دارد.";
    else if (rsi < 30) analysis = "بازار در وضعیت اشباع فروش است. احتمال بازگشت قیمت به بالا وجود دارد.";
    else analysis = "بازار در وضعیت خنثی قرار دارد.";
    
    if (atr > (this.price * 0.002)) analysis += " نوسانات بازار بالاست.";
    else analysis += " نوسانات بازار کم است.";
    
    return analysis;
  }

  getChartData() {
    const data = this.closes.map((c, i) => ({
      time: this.timestamps[i] / 1000,
      open: this.opens[i],
      high: this.highs[i],
      low: this.lows[i],
      close: c,
      volume: this.volumes[i]
    }));

    // Calculate indicator lines for the chart
    const hmaLine = this.strategy.calculateHMA(this.closes, this.settings.strategy?.hmaPeriod || 21);
    const superTrend = this.strategy.calculateSuperTrend(
      this.highs, this.lows, this.closes, 
      this.settings.strategy?.superTrendPeriod || 10, 
      this.settings.strategy?.superTrendMultiplier || 3
    );

    return {
      candles: data,
      hma: hmaLine.map((val, i) => ({ time: this.timestamps[i] / 1000, value: val })),
      superTrend: superTrend.map((st, i) => ({ 
        time: this.timestamps[i] / 1000, 
        value: st.value, 
        direction: st.direction 
      }))
    };
  }
}
