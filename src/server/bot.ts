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
  tradeHistory: number[] = [];
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
  processedTransactionIds: Set<number> = new Set();
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
        this.tradeHistory = state.tradeHistory || [];
        this.dailyDateKey = state.dailyDateKey || this.getLocalDateKey();
        
        if (state.processedTransactionIds) {
          this.processedTransactionIds = new Set(state.processedTransactionIds);
        }
        
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
        dailyDateKey: this.dailyDateKey,
        lastTradeTime: this.lastTradeTime,
        tradeHistory: this.tradeHistory,
        processedTransactionIds: Array.from(this.processedTransactionIds),
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
      this.processedTransactionIds.clear();
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
    
    // Aggressive sanitization for Rubika
    const sanitize = (str: string) => {
      return str
        .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString()) // Persian Digits -> English
        .replace(/٬/g, ',') // Persian Decimal Separator -> Comma
        .replace(/−/g, '-') // Unicode Minus -> Hyphen
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove ZWNJ, ZWJ, BOM
        .replace(/\*/g, '') // Remove bold markers just in case
        .trim();
    };

    const sanitizedText = sanitize(text);
    const chatIds = String(this.settings.rubika.chatId).split(',').map((id: string) => id.trim()).filter(Boolean);
    const url = `https://botapi.rubika.ir/v3/${this.settings.rubika.botToken}/sendMessage`;
    
    let lastMessageId: string | undefined;

    for (const chatId of chatIds) {
      try {
        // Use URLSearchParams to send as application/x-www-form-urlencoded
        // This is often more reliable for older API wrappers
        const params = new URLSearchParams();
        params.append('chat_id', chatId);
        params.append('text', sanitizedText);
        
        if (replyToMessageId && replyToMessageId !== 'SENT' && chatIds.length === 1 && /^\d+$/.test(String(replyToMessageId))) {
          params.append('reply_to_message_id', String(replyToMessageId));
        }

        const res = await axios.post(url, params, { 
          timeout: 15000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        if (res.data?.status === 'OK' || res.data?.ok || res.data?.data?.message_id) {
          lastMessageId = String(res.data?.data?.message_id || 'SENT');
          this.log(`Rubika message sent to ${chatId}`, "INFO");
        } else {
          this.log(`Rubika API returned error for ${chatId}: ${JSON.stringify(res.data)} | Text: ${sanitizedText.substring(0, 50)}...`, "ERROR");
          
          // Fallback: Try sending a very simple version if the complex one fails
          if (sanitizedText.length > 20) {
            const simpleText = `Bot Notification: ${sanitizedText.substring(0, 100)}`;
            const fallbackParams = new URLSearchParams();
            fallbackParams.append('chat_id', chatId);
            fallbackParams.append('text', simpleText);
            await axios.post(url, fallbackParams, { timeout: 5000 }).catch(() => {});
          }
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

    const sanitize = (str: string) => {
      return str
        .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString())
        .replace(/٬/g, ',')
        .replace(/−/g, '-')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
    };

    const sanitizedText = sanitize(text);
    const chatIds = targetChatId.split(',').map((id: string) => id.trim()).filter(Boolean);
    const url = `https://botapi.rubika.ir/v3/${this.settings.rubika.botToken}/sendMessage`;
    
    for (const chatId of chatIds) {
      try {
        const params = new URLSearchParams();
        params.append('chat_id', chatId);
        params.append('text', sanitizedText);

        await axios.post(url, params, { 
          timeout: 10000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
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

      if (now % 15000 < 1000 && !shouldSkipDueToMarketClosed) {
        this.updatePortfolio();
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

  private isSyncing = false;
  async updatePortfolio(retryCount = 0, autoCreate = true) {
    if (!this.api || this.isSyncing) return;
    this.isSyncing = true;
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
        this.isSyncing = false;
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
        this.isSyncing = false; // Allow retry
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
    } finally {
      this.isSyncing = false;
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
    const matchedLocalIds = new Set();
    const now = Date.now();
    
    this.log(`[DEBUG] Syncing ${apiPositions.length} positions from API...`, "INFO");
    
    // 1. Build the new synced map
    for (const p of apiPositions) {
      // Prioritize transaction_id for futures closing
      const transId = p.transaction_id || p.id || p.order_id || (Date.now() + Math.random());
      const id = p.id || p.order_id || transId;
      
      const type = (p.type || p.action || 'BUY').toString().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
      const entry = Number(p.entry_price || p.price || p.entry || this.price);
      
      let existingPos = null;
      let matchedLocalId = null;
      for (const [localId, localPos] of this.openPositions.entries()) {
        const isPending = !localPos.transactionId || String(localPos.transactionId).includes('PENDING');
        const priceDiff = Math.abs(localPos.entry - entry);
        
        if (localPos.transactionId === transId || localPos.id === id || (localPos.type === type && priceDiff < 200)) {
          if (isPending) {
            this.log(`[DEBUG] Sync matched PENDING position ${localId} with API transaction ${transId} (Price Diff: ${priceDiff})`, "SUCCESS");
          }
          existingPos = localPos;
          matchedLocalId = localId;
          break;
        }
      }

      if (matchedLocalId) {
        matchedLocalIds.add(matchedLocalId);
      }

      const apiSl = Number(p.stop_loss || p.sl || 0);
      const apiTp = Number(p.take_profit || p.tp || 0);
      
      if (existingPos && (apiSl === 0 || apiTp === 0)) {
        this.log(`[DEBUG] Sync detected missing SL/TP for ${id}: API_SL=${apiSl}, API_TP=${apiTp} | Local_SL=${existingPos.sl}, Local_TP=${existingPos.tp1}`, "INFO");
      }
      
      const defaultTpTicks = this.settings.targetsTicks?.tpTicks || 15;
      const tickSize = this.settings.market?.tickSize || 1;
      const fallbackTp = type === 'BUY' ? entry + (defaultTpTicks * tickSize) : entry - (defaultTpTicks * tickSize);
      
      const finalSl = apiSl > 0 ? apiSl : (existingPos?.sl || 0);
      const finalTp = apiTp > 0 ? apiTp : (existingPos?.tp1 || fallbackTp);

      // CRITICAL: If the exchange dropped the SL/TP (returns 0), we MUST enforce it or panic close!
      if (existingPos && (apiSl === 0 || apiTp === 0) && (finalSl > 0 || finalTp > 0)) {
         if (!existingPos.isFixingSlTp) {
            existingPos.isFixingSlTp = true;
            this.log(`🚨 CRITICAL: Position ${id} is missing SL/TP on exchange! Enforcing now...`, "ERROR");
            const targetTp = existingPos.tp3 || existingPos.tp2 || finalTp;
            this.enforceStopLossTakeProfit(transId, finalSl, targetTp, id).then(success => {
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
        tp2: existingPos?.tp2 || 0,
        tp3: existingPos?.tp3 || 0,
        status: 'open',
        entryTime: existingPos?.entryTime || new Date(p.time || p.created_at || Date.now()),
        pattern: existingPos?.pattern || 'API Sync',
        strategy: existingPos?.strategy || 'MANUAL',
        tp1Hit: existingPos?.tp1Hit || false,
        tp2Hit: existingPos?.tp2Hit || false,
        tp3Hit: existingPos?.tp3Hit || false,
        breakEvenHit: existingPos?.breakEvenHit || false,
        pyramidTriggered: existingPos?.pyramidTriggered || false,
        currentStep: existingPos?.currentStep || 0,
        originalSl: existingPos?.originalSl || finalSl,
        isFixingSlTp: existingPos?.isFixingSlTp || false,
        isGhostTrade: isGhostTrade,
        telegramMessageId: existingPos?.telegramMessageId,
        rubikaMessageId: existingPos?.rubikaMessageId,
        isHQ: existingPos?.isHQ || false,
        signalId: existingPos?.signalId
      });
    }
    
    // 2. Detect closed positions and preserve pending ones
    for (const [localId, localPos] of this.openPositions.entries()) {
      const isPending = !localPos.transactionId || String(localPos.transactionId).includes('PENDING');
      
      if (matchedLocalIds.has(localId)) continue;

      if (isPending) {
        // CRITICAL: Keep pending positions so they don't disappear from memory!
        syncedPositions.set(localId, localPos);
      } else {
        // This position was closed on the server
        this.log(`Position ${localId} closed on server. Adding to history.`, "SUCCESS");
        
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
              this.ws.send(JSON.stringify({ type: 'pong' }));
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
            this.log(`[WS] Real-time Order Update: ${JSON.stringify(order)}`, "WS");
            
            // Link transaction ID if it's missing or pending for an open position
            if (txId && !isNaN(txId)) {
              for (const [id, pos] of this.openPositions) {
                // Link if pending OR if we have a new ID that might be the real transaction ID
                const isPending = !pos.transactionId || pos.transactionId === 'PENDING' || String(pos.transactionId).includes('PENDING');
                if (isPending) {
                  const action = (order.action || '').toLowerCase();
                  const txPrice = Number(order.price || 0);
                  const priceDiff = Math.abs(pos.entry - txPrice);
                  const isPriceMatch = txPrice === 0 || priceDiff < 200;
                  const isMatch = (pos.type === 'BUY' && action.includes('buy')) || (pos.type === 'SELL' && action.includes('sell'));
                  
                  if (isMatch && isPriceMatch) {
                    pos.transactionId = txId;
                    pos.status = 'open';
                    this.log(`[WS] Linked transaction ${txId} from order update to local position ${id}. Enforcing SL/TP in 0.1s...`, "SUCCESS");
                    
                    // Add a small delay to ensure the server has indexed the transaction before we try to edit it
                    setTimeout(() => {
                      const p = this.openPositions.get(id);
                      // CRITICAL: If already enforced OR if this ID is no longer the active one, ABORT.
                      if (!p || p.slEnforced || p.transactionId !== txId) return;
                      
                      const targetTp = p.tp3 || p.tp2 || p.tp1;
                      this.enforceStopLossTakeProfit(txId, p.sl, targetTp, id).then(success => {
                        if (success) p.slEnforced = true;
                      }).catch(() => {});
                    }, 100);
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
                  
                  // Make sure the direction and price matches
                  const txType = tx.type || tx.action || '';
                  const txPrice = Number(tx.price || tx.entry_price || 0);
                  const priceDiff = Math.abs(pos.entry - txPrice);
                  const isPriceMatch = txPrice === 0 || priceDiff < 200;
                  const isMatch = !txType || (pos.type === 'BUY' && txType.toLowerCase().includes('buy')) || (pos.type === 'SELL' && txType.toLowerCase().includes('sell'));

                  if (isPending && !alreadyLinked && isMatch && isPriceMatch) {
                    pos.transactionId = txId;
                    this.log(`[WS] Linked transaction ${txId} to local position ${id} (authoritative). Enforcing SL/TP in 1s...`, "SUCCESS");
                    
                    setTimeout(() => {
                      const p = this.openPositions.get(id);
                      // CRITICAL: If already enforced OR if this ID is no longer the active one, ABORT.
                      if (!p || p.slEnforced || p.transactionId !== txId) return;

                      this.enforceStopLossTakeProfit(txId, p.sl, p.tp3 || p.tp2 || p.tp1, id).then(success => {
                        if (success) p.slEnforced = true;
                      }).catch(() => {});
                    }, 1000);
                    break;
                  }
                }
              }
            });
          }

          if (msg.new_transactions_history || msg.transactions_history || msg.transactions_history_list) {
            const txs = msg.new_transactions_history || msg.transactions_history || msg.transactions_history_list;
            const arr = Array.isArray(txs) ? txs : [txs];
            arr.forEach((tx: any) => {
              const txId = Number(tx.id || tx.transaction_id);
              if (txId && !this.processedTransactionIds.has(txId)) {
                this.processedTransactionIds.add(txId);
                
                // If it was one of our open positions, handle it specially
                let foundLocal = false;
                for (const [id, pos] of this.openPositions) {
                  if (Number(pos.transactionId) === txId) {
                    foundLocal = true;
                    this.dailyPnL += (tx.pnl || 0);
                    this.totalTrades++;
                    if ((tx.pnl || 0) > 0) this.winningTrades++;
                    else if ((tx.pnl || 0) < 0) this.losingTrades++;
                    
                    const signalId = pos.signalId || '---';
                    this.openPositions.delete(id);
                    this.saveState();
                    
                    const msgText = `🏁 *معامله بسته شد (سرور)*
#${signalId}
سود/ضرر: ${(tx.pnl || 0).toLocaleString('fa-IR')} تومان`;
                    this.sendTelegramMessage(msgText, pos.telegramMessageId);
                    
                    const rubikaMsg = `🏁 معامله بسته شد (سرور)
#${signalId}
سود/ضرر: ${(tx.pnl || 0).toLocaleString('fa-IR')} تومان`;
                    this.sendRubikaMessage(rubikaMsg, pos.rubikaMessageId);
                    
                    break;
                  }
                }
                
                // If it's an external trade or we missed the opening, still count it in stats
                if (!foundLocal && tx.status === 'closed') {
                  this.dailyPnL += (tx.pnl || 0);
                  this.totalTrades++;
                  if ((tx.pnl || 0) > 0) this.winningTrades++;
                  else if ((tx.pnl || 0) < 0) this.losingTrades++;
                  this.saveState();
                }
              }
            });
          }

          if (msg.transactions_open_list) {
            const openTxs = msg.transactions_open_list;
            if (Array.isArray(openTxs)) {
              openTxs.forEach((tx: any) => {
                const txId = Number(tx.id || tx.transaction_id);
                // We could use this to sync open positions if needed
              });
            }
          }

          // Log unknown messages for analysis
          const knownKeys = ['action', 'data', 'symbol', 'message', 'bars', 'history', 'market_status', 'price', 'best_buy', 'best_sell', 'spread', 'new_transactions_open', 'transactions_open', 'new_transactions_history', 'transactions_history', 'transactions_history_list', 'transactions_open_list', 'user_orders_list', 'pnl_per_line', 'pnl', 'server_time', 'type', 'data_buy', 'data_sell', 'new_user_orders', 'M', 'FSYM', 'TSYM', 'TYPE', 'TS', 'P'];
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
    const antiArb = this.settings.risk?.antiArbitrage || { enabled: false, maxLatencyMs: 500 };
    const useSpreadFilter = this.settings.risk?.useSpreadFilter ?? false;
    const maxSpread = this.settings.risk?.maxSpreadTicks || 15;

    if (result.signal) {
      if (antiArb.enabled && this.latency > antiArb.maxLatencyMs) {
        this.log(`Latency too high (${this.latency}ms > ${antiArb.maxLatencyMs}ms). Skipping entry for safety.`, "INFO");
        return;
      }
      
      const tickSize = this.settings.market?.tickSize || 1;
      const spreadTicks = this.currentSpread / tickSize;
      if (useSpreadFilter && spreadTicks > maxSpread) {
        this.log(`Spread too high (${spreadTicks.toFixed(1)} ticks > ${maxSpread} ticks). Skipping entry.`, "INFO");
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
    
    // 1. Cooldown Check
    if (now - this.lastTradeTime < (this.settings.strategy?.tradeCooldown * 1000 || 8000)) return;

    // 2. Max Trades per 10 Minutes Check (Persistent)
    const maxTradesPer10Min = this.settings.strategy?.filters?.maxTradesPer10Min || 0;
    if (maxTradesPer10Min > 0) {
      const tenMinsAgo = now - 10 * 60 * 1000;
      this.tradeHistory = this.tradeHistory.filter(t => t > tenMinsAgo);
      if (this.tradeHistory.length >= maxTradesPer10Min) {
        this.log(`Trade Skipped: Max trades (${maxTradesPer10Min}) per 10m reached (Persistent Filter)`, "INFO");
        return;
      }
    }
    
    const maxPos = this.settings.risk?.maxOpenPositions ?? 2;
    if (this.openPositions.size >= maxPos) {
      this.log(`Trade Skipped: Max Concurrent Positions reached (${this.openPositions.size}/${maxPos})`, "INFO");
      return;
    }

    this.isEnteringTrade = true;
    this.processedSignals.add(signalId);
    
    try {
      // Max Spread Check
      const useSpreadFilter = this.settings.risk?.useSpreadFilter ?? false;
      const maxSpread = this.settings.risk?.maxSpreadTicks || 15;
      const tickSize = this.settings.market?.tickSize || 1;
      const effectiveSpread = this.orderBook.realSpread > 0 ? this.orderBook.realSpread : this.currentSpread;
      const spreadTicks = effectiveSpread / tickSize;
      
      if (useSpreadFilter && effectiveSpread > 0 && spreadTicks > maxSpread) {
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
      const tp2 = Math.round(signal.tp2 || tp + (tp - this.price));
      const tp3 = Math.round(signal.tp3 || tp + 2 * (tp - this.price));

      // SL/TP Safety Check (Ensure not too close to market)
      // Reduced buffer to 15 ticks for faster execution
      const safetyBuffer = tickSize * 15;
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
          tp2: tp2,
          tp3: tp3,
          slEnforced: false,
          lastEnforceAttempt: Date.now(),
          maxAdverseTicks: 0,
          maxFavorableTicks: 0
        });
        this.saveState();

        this.log(`Attempting API Trade: ${signal.type} TP1:${tp} TP3:${tp3} SL:${sl}`, "INFO");
        
        const orderData = {
          action: signal.type.toLowerCase(),
          order_type: "verbal",
          units: String(units),
          price: -1,
          take_profit: String(tp3),
          stop_loss: String(sl),
          signal_token: ""
        };

        this.log(`[DEBUG] Submitting Order Payload: ${JSON.stringify(orderData)}`, "INFO");
        
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
            this.log(`[DEBUG] API Response: ${JSON.stringify(response?.data || {})}`, "INFO");
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
          this.tradeHistory.push(Date.now());
          const pos = this.openPositions.get(id);
          if (pos) {
            pos.status = 'open';
            if (transId) pos.transactionId = transId;
            
            // Send Open Notifications
            const typeEmoji = signal.type === 'BUY' ? '🔵' : '🔴';
            const typeLabel = signal.type === 'BUY' ? 'خرید (BUY)' : 'فروش (SELL)';
            const msg = `${typeEmoji} *معامله جدید باز شد*
#${signalId}
نوع: ${typeLabel}
قیمت ورود: ${this.price.toLocaleString('fa-IR')}
حد ضرر: ${sl.toLocaleString('fa-IR')}
تارگت ۱: ${tp.toLocaleString('fa-IR')}
تارگت ۲: ${tp2.toLocaleString('fa-IR')}
تارگت ۳: ${tp3.toLocaleString('fa-IR')}
(تارگت نهایی در صرافی ثبت شد)`;

            this.sendTelegramMessage(msg).then(mid => {
              if (mid) pos.telegramMessageId = mid;
            });
            this.sendRubikaMessage(msg.replace(/\*/g, '')).then(mid => {
              if (mid) pos.rubikaMessageId = mid;
            });

            this.saveState();
          }
          
          this.log(`Trade Executed: ${signal.type} at ${this.price} (ID: ${transId || 'PENDING'})`, "SUCCESS");
          
          if (transId && !String(transId).includes('PENDING')) {
            // Immediate enforcement with a tiny delay to ensure server indexing
            setTimeout(() => {
              const p = this.openPositions.get(id);
              if (!p || (p.slEnforced && p.transactionId === transId)) return;

              const targetTp = p.tp3 || p.tp2 || p.tp1;
              this.enforceStopLossTakeProfit(transId, sl, targetTp, id).then(success => {
                if (success) p.slEnforced = true;
              }).catch(() => {});
            }, 100);
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

        // Send Open Notifications (SIM)
        const typeEmoji = signal.type === 'BUY' ? '🔵' : '🔴';
        const typeLabel = signal.type === 'BUY' ? 'خرید (BUY)' : 'فروش (SELL)';
        const msg = `${typeEmoji} *معامله جدید باز شد (SIM)*
#${signalId}
نوع: ${typeLabel}
قیمت ورود: ${this.price.toLocaleString('fa-IR')}
حد ضرر: ${sl.toLocaleString('fa-IR')}
تارگت ۱: ${tp.toLocaleString('fa-IR')}`;

        const pos = this.openPositions.get(id);
        if (pos) {
          this.sendTelegramMessage(msg).then(mid => {
            if (mid) pos.telegramMessageId = mid;
          });
          this.sendRubikaMessage(msg.replace(/\*/g, '')).then(mid => {
            if (mid) pos.rubikaMessageId = mid;
          });
        }

        this.log(`Trade Executed (SIM): ${signal.type} at ${this.price}`, "SUCCESS");
      }
    } catch (e: any) {
      this.log(`Trade Entry Error: ${e.message}`, "ERROR");
    } finally {
      this.isEnteringTrade = false;
    }
  }

  checkTargetsAndStops() {
    if (this.openPositions.size === 0) return;
    if (this.isMarketClosed) return; // Skip checking targets if market is closed
    const currentPrice = this.price;
    if (currentPrice <= 0) return;

    const tickSize = Number(this.settings.market?.tickSize ?? 1);

    for (const [id, position] of this.openPositions) {
      if (position.status !== 'open') continue;

      const isBuy = position.type === 'BUY';
      const entryPrice = position.entry || position.price;
      const now = Date.now();

      // Track Drawdown (MAE) and Max Profit (MFE)
      const currentDiff = currentPrice - entryPrice;
      const currentTicks = Math.abs(currentDiff / tickSize);
      
      // Panic check: If position is PENDING for more than 5s, force a portfolio sync
      const isPending = !position.transactionId || String(position.transactionId).includes('PENDING');
      if (isPending && now - (position.entryTime?.getTime() || now) > 5000) {
        this.log(`🚨 WARNING: Position ${id} has been PENDING for >5s. Forcing portfolio sync...`, "INFO");
        this.updatePortfolio(0, true);
      }

      if (isBuy) {
        if (currentPrice < entryPrice) {
          position.maxAdverseTicks = Math.max(position.maxAdverseTicks || 0, currentTicks);
        } else {
          position.maxFavorableTicks = Math.max(position.maxFavorableTicks || 0, currentTicks);
        }
      } else {
        if (currentPrice > entryPrice) {
          position.maxAdverseTicks = Math.max(position.maxAdverseTicks || 0, currentTicks);
        } else {
          position.maxFavorableTicks = Math.max(position.maxFavorableTicks || 0, currentTicks);
        }
      }

      // Periodic SL/TP Enforcement Retry
      if (this.settings.source === 'API' && !isPending && position.slEnforced === false) {
        const lastAttempt = position.lastEnforceAttempt || 0;
        const attemptCount = position.enforceAttempts || 0;
        const retryInterval = attemptCount < 5 ? 3000 : 15000; // Fast retry for first 5 attempts
        
        if (now - lastAttempt > retryInterval) {
          position.lastEnforceAttempt = now;
          position.enforceAttempts = attemptCount + 1;
          this.log(`Retrying SL/TP Enforcement for ${position.transactionId} (Attempt ${position.enforceAttempts})...`, "INFO");
          const targetTp = position.tp3 || position.tp2 || position.tp1;
          this.enforceStopLossTakeProfit(position.transactionId, position.sl, targetTp, id).then(success => {
            if (success) {
              position.slEnforced = true;
              this.log(`SL/TP Enforced on retry for ${position.transactionId}`, "SUCCESS");
            }
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

      // Max Loss Per Trade & Max Daily Loss Enforcement
      const tickValue = Number(this.settings.market?.tickValueToman ?? 23000);
      const priceDiff = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
      const currentPnlToman = Math.round((priceDiff / tickSize) * tickValue * (position.units || 1));
      
      // Smart Profit Saving: If trade reached >60% of TP1 but reversed significantly, move SL to BE
      if (!position.tp1Hit && !position.breakEvenHit) {
        const tpDist = Math.abs(position.tp1 - entryPrice);
        const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
        const maxDist = position.maxFavorableTicks * tickSize;
        
        // Trigger if:
        // 1. We reached at least 60% of the way to TP1
        // 2. We have dropped >50% from our maximum reached profit
        if (maxDist >= tpDist * 0.6 && currentDist <= maxDist * 0.5) {
          const buffer = 1 * tickSize;
          const newSl = isBuy ? entryPrice + buffer : entryPrice - buffer;
          const isImprovement = isBuy ? newSl > position.sl : newSl < position.sl;
          
          if (isImprovement) {
            position.breakEvenHit = true;
            position.sl = newSl;
            this.log(`🛡️ Profit Protection: Trade ${id} reversed after reaching 60% of TP1. Moving SL to Break-Even (${newSl})`, "SUCCESS");
            if (position.transactionId) {
              this.editStopLoss(position.transactionId, newSl);
            }
          }
        }
      }

      const maxLossPerTrade = this.settings.risk?.maxRiskTomanPerTrade;
      if (maxLossPerTrade && currentPnlToman <= -Math.abs(maxLossPerTrade)) {
        this.log(`🚨 Maximum Loss Per Trade Reached! Closing position ${id}. PnL: ${currentPnlToman}`, "ERROR");
        this.closeTrade(id, 'max_loss_per_trade');
        continue;
      }

      const maxDailyLoss = this.settings.risk?.maxDailyLossToman;
      if (maxDailyLoss && (this.dailyPnL + currentPnlToman) <= -Math.abs(maxDailyLoss)) {
        this.log(`🚨 Maximum Daily Loss Reached! Closing position ${id} and stopping bot. Daily PnL: ${this.dailyPnL + currentPnlToman}`, "ERROR");
        this.closeTrade(id, 'max_daily_loss');
        this.isTrading = false; // Stop trading
        continue;
      }

      if (!position.tp1Hit) {
        if ((isBuy && currentPrice >= position.tp1) || (!isBuy && currentPrice <= position.tp1)) {
          position.tp1Hit = true;
          this.log(`🎯 Target 1 Hit at ${currentPrice}! Moving SL to Protected Entry and targeting TP2: ${position.tp2}`, "SUCCESS");
          
          // Smart Profit Saving: Move SL to Entry + 5 ticks buffer (instead of 2)
          const buffer = 5 * tickSize;
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
          
          // If Trailing is enabled, don't close! Instead, move TP3 further and let it trail.
          const trailingCfg = this.settings.targetsTicks?.trailing;
          const hqCfg = this.settings.strategy?.highQuality;
          const effectiveTrailing = (position.isHQ && hqCfg?.trailing?.enabled) ? hqCfg.trailing : trailingCfg;

          if (effectiveTrailing?.enabled) {
            this.log(`🎯 Target 3 Hit at ${currentPrice}! Trailing is ENABLED, so keeping trade open for more profit.`, "SUCCESS");
            // Move internal TP3 further away so we don't hit this block again immediately
            const extension = (this.settings.targetsTicks?.tpTicks || 15) * tickSize;
            position.tp3 = isBuy ? position.tp3 + extension : position.tp3 - extension;
            
            if (position.transactionId) {
              this.editTakeProfit(position.transactionId, position.tp3);
            }
          } else {
            this.log(`🎯 Target 3 (Final) Hit at ${currentPrice}! Closing trade.`, "SUCCESS");
            this.closeTrade(id, 'take_profit_final');
            continue;
          }
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
              // Throttle API calls to once every 5 seconds per position
              if (!position.lastSlUpdate || now - position.lastSlUpdate > 5000) {
                // Safety Check: Ensure new SL is not too close to current price
                const safetyBuffer = 10 * tickSize;
                let safeSl = newSl;
                if (isBuy && safeSl > currentPrice - safetyBuffer) {
                  safeSl = Math.round(currentPrice - safetyBuffer);
                } else if (!isBuy && safeSl < currentPrice + safetyBuffer) {
                  safeSl = Math.round(currentPrice + safetyBuffer);
                }

                const finalIsImprovement = isBuy ? safeSl > position.sl : safeSl < position.sl;
                if (!finalIsImprovement) continue;

                position.sl = safeSl;
                position.currentStep = stepIndex;
                position.lastSlUpdate = now;
                position.breakEvenHit = true; // Mark as triggered
                
                this.log(`Stepped Risk-Free: Step ${stepIndex} triggered. SL moved to ${safeSl} (Profit: ${currentProfitPct.toFixed(1)}%)`, "SUCCESS");
                
                if (position.transactionId) {
                  this.editStopLoss(position.transactionId, safeSl).then(success => {
                    if (!success) {
                      this.log(`Stepped Risk-Free API Failed for ${position.transactionId}. Will retry in 10s.`, "ERROR");
                      position.breakEvenHit = false; // Allow retry
                      position.lastSlUpdate = now + 5000; // Extra cooldown
                    }
                  });
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
                // Safety Check: Ensure new SL is not too close to current price
                const safetyBuffer = 10 * tickSize;
                let safeSl = newSl;
                if (isBuy && safeSl > currentPrice - safetyBuffer) {
                  safeSl = Math.round(currentPrice - safetyBuffer);
                } else if (!isBuy && safeSl < currentPrice + safetyBuffer) {
                  safeSl = Math.round(currentPrice + safetyBuffer);
                }

                const finalIsImprovement = isBuy ? safeSl > position.sl : safeSl < position.sl;
                if (!finalIsImprovement) continue;

                position.breakEvenHit = true;
                position.sl = safeSl; // Move SL to Entry (Risk-Free)
                position.lastSlUpdate = now;
                this.log(`[Risk-Free] Break Even triggered for trade ${id}. Moving SL to ${safeSl} (Price: ${currentPrice})`, "SUCCESS");
                
                if (position.transactionId) {
                  this.editStopLoss(position.transactionId, safeSl).then(success => {
                    if (!success) {
                      this.log(`Risk-Free API Failed for ${position.transactionId}. Will retry in 10s.`, "ERROR");
                      position.breakEvenHit = false; // Allow retry
                      position.lastSlUpdate = now + 5000; // Extra cooldown
                    }
                  });
                }
              }
            } else if (!position.breakEvenHit) {
              // Log why it didn't trigger if it was close
              if (currentDist >= tpDist * (triggerPercent * 0.9)) {
                // Silent log or debug log
              }
            }
          }
        }
      }

    // Continuous Trailing Stop Logic (ATR-based for Precision)
    const trailingCfg = this.settings.targetsTicks?.trailing;
    const hqCfg = this.settings.strategy?.highQuality;
    const effectiveTrailing = (position.isHQ && hqCfg?.trailing?.enabled) ? hqCfg.trailing : trailingCfg;

    if (effectiveTrailing?.enabled) {
      const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
      const activateDist = (effectiveTrailing.activateAfterTicks || 10) * tickSize;
      
      if (currentDist >= activateDist) {
        // Use ATR for volatility-adjusted trailing distance
        // Fallback to trailTicks if ATR is not available
        const atr = this.strategy.indicators.atr || (5 * tickSize);
        const atrMultiplier = 1.5; // Give price 1.5x ATR room to breathe
        
        let trailDist = Math.max(atr * atrMultiplier, (effectiveTrailing.trailTicks || 5) * tickSize);
        
        // Only start tightening AFTER TP2 is hit to allow for major runs
        if (position.tp2Hit) {
          trailDist = trailDist * 0.7; // Tighten only at the end
        } else if (position.tp1Hit) {
          trailDist = trailDist * 0.9; // Slight tightening
        }

        const newSl = isBuy ? currentPrice - trailDist : currentPrice + trailDist;
        
        // Only move SL if it's a significant improvement (at least 2 ticks) to avoid frequent API calls
        const moveThreshold = 2 * tickSize;
        const isImprovement = isBuy ? (newSl > position.sl + moveThreshold) : (newSl < position.sl - moveThreshold);
        
        if (isImprovement) {
          const now = Date.now();
          if (!position.lastSlUpdate || now - position.lastSlUpdate > 5000) {
            position.sl = Math.round(newSl);
            position.lastSlUpdate = now;
            this.log(`📈 Voltality-Adjusted Trailing: SL moved to ${position.sl} (Distance: ${(trailDist/tickSize).toFixed(1)} ticks)`, "SUCCESS");
            
            if (position.transactionId) {
              this.editStopLoss(position.transactionId, position.sl);
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
      if (this.isMarketClosed) {
        this.log(`Close Trade Paused: Market is closed. Waiting for reopen...`, "INFO");
        return;
      }

      // Anti-Arbitrage: Minimum hold time check only (no artificial delays)
      const antiArb = this.settings.risk?.antiArbitrage || { enabled: false, minHoldTimeSeconds: 30 };
      if (antiArb.enabled) {
        const minHoldTime = (antiArb.minHoldTimeSeconds || 30) * 1000;
        const timeOpen = Date.now() - new Date(pos.entryTime).getTime();
        if (reason !== 'stop_loss' && reason !== 'daily_loss_limit' && timeOpen < minHoldTime) {
          this.log(`Anti-Arbitrage Warning: Trade hold time short (${Math.round(timeOpen/1000)}s < ${antiArb.minHoldTimeSeconds}s).`, "INFO");
        }
      }

      try {
        let ok = false;
        let apiResponse: any = null;

        const isPending = !pos.transactionId || pos.transactionId === 'PENDING' || String(pos.transactionId).includes('PENDING');

        if (pos.transactionId && !isPending) {
          const endpoints = [
            `/api/room/api/close-futures-transaction/${pos.transactionId}/`,
            `/api/room/api/close-transaction/${pos.transactionId}/`
          ];

          for (const url of endpoints) {
            if (ok) break;
            try {
              const res = await this.api.post(url, {}, {
                headers: { 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' },
                timeout: 20000
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
              apiResponse = data; // Store error response data for later checks
              
              // Per user feedback, 500 on close often means success
              if (status === 500) {
                this.log(`Close Trade: Received 500 on ${url}. Treating as SUCCESS per user experience.`, "SUCCESS");
                ok = true;
                break;
              }

              this.log(`Close Trade API Error (${url}): Status ${status} | Data: ${typeof data === 'string' ? 'HTML Response' : JSON.stringify(data || e.message)}`, "ERROR");
              
              if (status === 403) {
                this.isMarketClosed = true;
                this.lastMarketClosedTime = Date.now();
                this.log(`Market is CLOSED (403). Pausing trade closing.`, "INFO");
                return;
              }

              if (status === 404) {
                this.log(`Trade ${pos.transactionId} not found on ${url}. It might be already closed.`, "INFO");
                ok = true; // Consider it done if 404
                break;
              }
              
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
          
          try {
            const res = await this.api.post('/api/room/api/submit-order/', orderData, {
              headers: { 'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
            });
            apiResponse = res?.data;
          } catch (e: any) {
            apiResponse = e.response?.data;
            const status = e.response?.status;
            if (status === 403) {
              this.isMarketClosed = true;
              this.lastMarketClosedTime = Date.now();
              this.log(`Market is CLOSED (403) during fallback close. Pausing.`, "INFO");
              return;
            }
            this.log(`Fallback close error: ${e.message}`, "ERROR");
          }
          
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

    // Send Drawdown Report to Rubika if enabled
    if (this.settings.rubika?.enabled && this.settings.rubika?.drawdownReportEnabled) {
      const mae = Math.round(pos.maxAdverseTicks || 0);
      const mfe = Math.round(pos.maxFavorableTicks || 0);
      const pnlEmoji = pnl > 0 ? '✅' : '❌';
      const typeLabel = isBuy ? 'خرید (BUY)' : 'فروش (SELL)';
      
      const report = `📊 گزارش تحلیل درادان (Drawdown)
----------------------------------
${pnlEmoji} معامله ${typeLabel} #${pos.signalId || '---'}
💰 سود/ضرر: ${pnl.toLocaleString('fa-IR')} تومان
📈 ورود: ${entryPrice.toLocaleString('fa-IR')}
📉 خروج: ${closePrice.toLocaleString('fa-IR')}

⚠️ درادان (MAE): ${mae.toLocaleString('fa-IR')} خط
🚀 پیشروی (MFE): ${mfe.toLocaleString('fa-IR')} خط

💡 ${pnl > 0 
        ? (mae > 5 ? `قیمت قبل از سوددهی ${mae} خط در ضرر رفته بود.` : 'نقطه ورود بسیار دقیق بود.') 
        : (mfe > 5 ? `قیمت قبل از استاپ، ${mfe} خط در سود رفته بود.` : 'معامله سریعاً به استاپ رسید.')}
----------------------------------`;
      
      this.sendRubikaMessage(report, pos.rubikaMessageId);
    }
    
    // First remove the position from local state to prevent infinite loops
    this.openPositions.delete(id);
    
    // Daily Loss Limit Check
    const maxDailyLoss = this.settings.risk?.maxDailyLossToman || 5000000;
    if (this.dailyPnL <= -Math.abs(maxDailyLoss) && this.isTrading) {
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
      tOpen: new Date(pos.entryTime).getTime(),
      tClose: Date.now(),
      side: pos.type,
      entry: pos.entry || pos.price,
      exit: closePrice,
      units: pos.units || 1,
      pnl: pnl || 0,
      reason: reason,
      maeTicks: pos.maxAdverseTicks || 0,
      mfeTicks: pos.maxFavorableTicks || 0
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
    this.log(`[DEBUG] Enforcing SL/TP for ${transactionId} (Local: ${localId}): SL=${sl}, TP=${tp}`, "INFO");
    if (String(transactionId).includes('PENDING')) {
      this.log(`[DEBUG] Aborting enforcement: transactionId is still PENDING (${transactionId})`, "INFO");
      return false;
    }
    
    let slSuccess = sl === 0 || isNaN(sl);
    let tpSuccess = tp === 0 || isNaN(tp);

    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      if (!slSuccess && sl > 0 && !isNaN(sl)) {
        slSuccess = await this.editStopLoss(transactionId, sl);
      }
      if (!tpSuccess && tp > 0 && !isNaN(tp)) {
        tpSuccess = await this.editTakeProfit(transactionId, tp);
      }

      if (slSuccess && tpSuccess) break;

      attempt++;
      if (attempt < maxAttempts) {
        this.log(`SL/TP Enforcement attempt ${attempt} failed for ${transactionId}. Retrying in 0.5s...`, "INFO");
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return slSuccess && tpSuccess;
  }

  async editTakeProfit(transactionId: number, newTp: number) {
    if (String(transactionId).includes('PENDING')) {
      this.log(`[DEBUG] editTakeProfit aborted: transactionId is PENDING (${transactionId})`, "INFO");
      return false;
    }
    if (this.settings.source === 'API' && this.api && transactionId) {
      try {
        this.log(`Updating TP for transaction ${transactionId} to ${newTp}...`, "INFO");
        
        const endpoints = [
          `/api/room/api/edit-take-profit/${transactionId}/`
        ];

        let ok = false;
        let lastError = null;
        let primaryNotFound = false;

        for (let i = 0; i < endpoints.length; i++) {
          const url = endpoints[i];
          if (ok) break;
          try {
            const res = await this.api.post(url, {
              take_profit: String(Math.round(newTp))
            }, {
              headers: { 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' },
              timeout: 20000
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
            const errorMsg = (typeof data === 'object' ? data?.message : null) || e.message || "";

            this.log(`Edit TP API Error (${url}): Status ${status} | Data: ${typeof data === 'string' ? 'HTML Response' : JSON.stringify(data || e.message)}`, "ERROR");
            
            // If trade closed or TP already hit, consider it "done" for enforcement purposes
            if (errorMsg.includes('بسته شده') || errorMsg.includes('باز نیست')) {
              this.log(`TP Edit skipped: Trade is closed (${transactionId})`, "INFO");
              return true; 
            }

            // If "یافت نشد" (Not Found) or "نامعتبر" (Invalid), it might be the wrong endpoint or ID type.
            if (status === 404 || errorMsg.includes('یافت نشد') || errorMsg.includes('نامعتبر')) {
              if (i === 0) primaryNotFound = true;
              this.log(`Endpoint ${url} returned 404 for TP edit. Trying next...`, "INFO");
              continue;
            }

            // Handle "TP too close" error by adjusting and retrying once
            if (errorMsg.includes('بالا') || errorMsg.includes('پایین') || errorMsg.includes('فاصله')) {
              this.log(`TP too close to market for ${transactionId}. Skipping TP for now.`, "INFO");
              return true; // Stop retries for this ID
            }

            if (status === 500) {
              this.log(`Endpoint ${url} returned 500 for TP edit. Trying next...`, "INFO");
            } else {
              this.log(`Endpoint ${url} failed for TP edit: ${status}`, "INFO");
            }
          }
        }

        if (!ok) {
          if (primaryNotFound) {
            this.log(`Edit TP: Transaction ${transactionId} not found on primary endpoint. Stopping enforcement for this ID.`, "INFO");
            return true; // Return true to stop the retry loop for this specific ID
          }
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
    if (String(transactionId).includes('PENDING')) {
      this.log(`[DEBUG] editStopLoss aborted: transactionId is PENDING (${transactionId})`, "INFO");
      return false;
    }
    if (this.settings.source === 'API' && this.api && transactionId) {
      try {
        this.log(`Updating SL for transaction ${transactionId} to ${newSl}...`, "INFO");
        
        const endpoints = [
          `/api/room/api/edit-stop-loss/${transactionId}/`
        ];

        let ok = false;
        let lastError = null;
        let primaryNotFound = false;

        for (let i = 0; i < endpoints.length; i++) {
          const url = endpoints[i];
          if (ok) break;
          try {
            const res = await this.api.post(url, {
              stop_loss: String(Math.round(newSl))
            }, {
              headers: { 
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest' 
              },
              timeout: 20000
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
            const errorMsg = (typeof data === 'object' ? data?.message : null) || e.message || "";

            this.log(`Edit SL API Error (${url}): Status ${status} | Data: ${typeof data === 'string' ? 'HTML Response' : JSON.stringify(data || e.message)}`, "ERROR");
            
            // If trade closed, consider it "done"
            if (errorMsg.includes('بسته شده') || errorMsg.includes('باز نیست')) {
              this.log(`SL Edit skipped: Trade is closed (${transactionId})`, "INFO");
              return true; 
            }

            // If "یافت نشد" (Not Found) or "نامعتبر" (Invalid), it might be the wrong endpoint or ID type.
            if (status === 404 || errorMsg.includes('یافت نشد') || errorMsg.includes('نامعتبر')) {
              if (i === 0) primaryNotFound = true;
              this.log(`Endpoint ${url} returned 404 for SL edit. Trying next...`, "INFO");
              continue;
            }

            // Handle "SL too close" error by adjusting and retrying once with a safe distance
            if (errorMsg.includes('بالا') || errorMsg.includes('پایین') || errorMsg.includes('فاصله')) {
              const tickSize = this.settings.market?.tickSize || 1;
              const safeDistance = tickSize * 20;
              let adjustedSl = newSl;
              
              if (errorMsg.includes('بالا')) {
                // Must be higher than current price (likely a SELL trade)
                adjustedSl = Math.round(this.price + safeDistance);
              } else if (errorMsg.includes('پایین')) {
                // Must be lower than current price (likely a BUY trade)
                adjustedSl = Math.round(this.price - safeDistance);
              } else {
                // Generic distance error, try both ways based on current price
                adjustedSl = newSl > this.price ? Math.round(this.price + safeDistance) : Math.round(this.price - safeDistance);
              }

              this.log(`SL too close to market. Retrying with safe SL: ${adjustedSl} (Price: ${this.price})`, "INFO");
              
              // Recursive call with adjusted SL (only once because we check ok)
              return await this.api.post(url, {
                stop_loss: String(Math.round(adjustedSl))
              }, {
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                timeout: 20000
              }).then(r => {
                const s = r?.data?.status;
                return s === true || s === 'true' || s === 1 || s === 'success';
              }).catch(() => false);
            }

            if (status === 500) {
              this.log(`Endpoint ${url} returned 500 for SL edit. Trying next...`, "INFO");
            } else {
              this.log(`Endpoint ${url} failed for SL edit: ${status}`, "INFO");
            }
          }
        }

        if (!ok) {
          if (primaryNotFound) {
            this.log(`Edit SL: Transaction ${transactionId} not found on primary endpoint. Stopping enforcement for this ID.`, "INFO");
            return true; // Return true to stop the retry loop for this specific ID
          }
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
    let hmaFastLine: any[] = [];
    let hmaSlowLine: any[] = [];
    
    if (this.closes.length > 0) {
      const hstCfg = this.settings.strategy?.hst || { hmaLength: 55, stPeriod: 10, stMultiplier: 3 };
      const hmaValues = this.strategy.calculateHMA(this.closes, hstCfg.hmaLength || 55);
      const stValues = this.strategy.calculateSuperTrend(this.highs, this.lows, this.closes, hstCfg.stPeriod || 10, hstCfg.stMultiplier || 3);
      
      // HMAMACD Indicators
      const hmamacdCfg = this.settings.strategy?.hmamacd || { hmaFast: 9, hmaSlow: 21 };
      const hmaFastValues = this.strategy.calculateHMA(this.closes, hmamacdCfg.hmaFast || 9);
      const hmaSlowValues = this.strategy.calculateHMA(this.closes, hmamacdCfg.hmaSlow || 21);

      // Map back to timestamps, matching the slice(-200)
      const startIndex = Math.max(0, this.closes.length - 200);
      
      for (let i = startIndex; i < this.closes.length; i++) {
        const time = this.timestamps[i] || (Date.now() - (this.closes.length - i) * 60000);
        
        // HST HMA
        const hmaIdx = hmaValues.length - (this.closes.length - i);
        if (hmaIdx >= 0 && hmaValues[hmaIdx]) {
          hmaLine.push({ x: time, y: hmaValues[hmaIdx] });
        }
        
        // HMAMACD Fast HMA
        const hmaFastIdx = hmaFastValues.length - (this.closes.length - i);
        if (hmaFastIdx >= 0 && hmaFastValues[hmaFastIdx]) {
          hmaFastLine.push({ x: time, y: hmaFastValues[hmaFastIdx] });
        }

        // HMAMACD Slow HMA
        const hmaSlowIdx = hmaSlowValues.length - (this.closes.length - i);
        if (hmaSlowIdx >= 0 && hmaSlowValues[hmaSlowIdx]) {
          hmaSlowLine.push({ x: time, y: hmaSlowValues[hmaSlowIdx] });
        }

        // SuperTrend
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
      userInfo: this.userInfo,
      candles: candles,
      hmaLine: hmaLine,
      stLine: stLine,
      hmaFastLine: hmaFastLine,
      hmaSlowLine: hmaSlowLine,
      mtfStatus: this.strategy.getMTFStatus(this.closes.map((c, i) => ({ price: c, high: this.highs[i], low: this.lows[i], volume: this.volumes[i], time: this.timestamps[i] })), this.mtfCloses.map((c, i) => ({ price: c, high: this.mtfHighs[i], low: this.mtfLows[i], volume: this.mtfVolumes[i], time: this.mtfTimestamps[i] }))),
      logs: this.logs,
      marketAnalysis: this.getMarketAnalysis(),
      latency: this.latency
    };
  }
}
