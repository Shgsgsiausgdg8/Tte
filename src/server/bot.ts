import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { Strategy } from './strategy';
import { config as defaultConfig } from './config';
import { DataRecorder } from './dataRecorder';
import { loadBestParams, scheduleOptimization } from './autotuneManager';

const SETTINGS_PATH = path.join(process.cwd(), 'src/server/settings.json');
const STATE_FILE = path.join(process.cwd(), 'src/server/state.json');

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
  marketStatus: 'OPEN' | 'CLOSED' = 'OPEN'; // Default to OPEN so it trades even if status is not received
  currentSpread: number = 0;
  portfolioLogged: boolean = false;

  recorder: DataRecorder;
  autoTuneTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadSettings();
    
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

  log(message: string, type: 'INFO' | 'SUCCESS' | 'ERROR' | 'SIGNAL' | 'WS' = 'INFO') {
    const logEntry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString('fa-IR'),
      message,
      type
    };
    this.logs.push(logEntry);
    if (this.logs.length > 100) this.logs.shift();
    console.log(`[${logEntry.time}] [${type}] ${message}`);
  }

  setupAxios() {
    const auth = { ...defaultConfig.auth, ...(this.settings.api || {}) };
    const cookies = `csrftoken=${auth.csrftoken}; sessionid=${auth.sessionid}`;
    
    this.api = axios.create({
      baseURL: auth.baseUrl,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8,fa;q=0.7',
        'Content-Type': 'application/json',
        'Origin': auth.baseUrl,
        'Referer': `${auth.baseUrl}/room/`,
        'X-CSRFToken': auth.csrftoken,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookies
      }
    });
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
        closedPositions: this.closedPositions.slice(-50) // Keep last 50
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
      this.sendTelegramReport();
    }
  }

  saveSettings(newSettings: any) {
    const sourceChanged = this.settings.source !== newSettings.source || 
                         (newSettings.source === 'API' && this.settings.api?.wsUrl !== newSettings.api?.wsUrl);
    
    // Force API source
    newSettings.source = 'API';
    
    this.settings = newSettings;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(newSettings, null, 2));
    this.strategy = new Strategy(newSettings);
    this.initTelegram();
    this.setupAxios();
    
    this.recorder = new DataRecorder(newSettings.dataRecorder);

    if (sourceChanged) {
      this.log("Price source settings changed. Restarting source...", "INFO");
      this.connectToExternalWS();
    }
  }

  initTelegram() {
    if (this.settings.telegram?.enabled && this.settings.telegram?.botToken) {
      try {
        this.tgBot = new TelegramBot(this.settings.telegram.botToken, { polling: false });
        this.log("Telegram Bot initialized.", "INFO");
      } catch (e) {
        this.log(`Telegram Init Error: ${e}`, "ERROR");
      }
    } else {
      this.tgBot = null;
    }
  }

  async sendTelegramMessage(msg: string) {
    if (this.tgBot && this.settings.telegram?.chatId) {
      try {
        await this.tgBot.sendMessage(this.settings.telegram.chatId, msg, { parse_mode: 'Markdown' });
      } catch (e) {
        this.log(`Telegram Send Error: ${e}`, "ERROR");
      }
    }
  }

  async sendTelegramReport() {
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
  }

  async start() {
    this.log("Bot engine v4.3 PRO starting...", "INFO");
    
    // Force API source
    this.settings.source = 'API';
    await this.updatePortfolio();
    await this.fetchHistoricalBars();
    this.connectToExternalWS();
    
    if (this.mainLoopTimer) clearInterval(this.mainLoopTimer);
    this.mainLoopTimer = setInterval(() => {
      this.resetDailyIfNeeded();
      this.checkTargetsAndStops();
      
      const now = Date.now();
      
      if (now % 10000 < 1000) {
        this.updatePortfolio();
      }
      
      // Send periodic report every 30 minutes (1800000 ms)
      if (now % 1800000 < 1000) {
        this.sendTelegramReport();
      }
    }, 1000);
  }

  async fetchHistoricalBars() {
    if (!this.api) return;
    try {
      const to = Math.floor(Date.now() / 1000);
      const from = to - (24 * 60 * 60); // Last 24 hours
      this.log(`Fetching historical bars from ${from} to ${to}...`, "INFO");
      
      const response = await this.api.get('/room/api/get-bars/', {
        params: {
          symbol: 'mazane',
          from: from,
          to: to,
          resolution: 1
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
    } catch (error) {
      this.log(`Historical Bars Fetch Error: ${error}`, "ERROR");
    }
  }

  async updatePortfolio() {
    if (!this.api) return;
    try {
      const response = await this.api.post('/room/api/check-portfolio/', {});
      this.portfolio = response.data;
      
      // Try to sync open positions if the API provides them in portfolio
      if (response.data && (response.data.open_positions || response.data.positions)) {
        this.syncPositions(response.data.open_positions || response.data.positions);
      } else {
        // If not in portfolio, try to fetch them from a dedicated endpoint
        try {
          const posResponse = await this.api.get('/room/api/open-positions/');
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
      if (error?.code === 'EAI_AGAIN' || error?.message?.includes('EAI_AGAIN')) {
        if (Math.random() < 0.05) {
          this.log(`Portfolio Update: Network/DNS issue connecting to server.`, "INFO");
        }
      } else {
        this.log(`Portfolio Update Error: ${error.message || error}`, "ERROR");
      }
    }
  }

  syncPositions(apiPositions: any[]) {
    if (!Array.isArray(apiPositions)) return;
    
    const syncedPositions = new Map();
    
    for (const p of apiPositions) {
      const id = p.id || p.order_id || p.transaction_id || Date.now() + Math.random();
      if (Math.random() < 0.1) { // Log 10% of synced positions to avoid flood
        this.log(`Syncing position: ID=${id}, Type=${p.type || p.action}, Entry=${p.entry_price || p.price}`, "INFO");
      }
      const type = (p.type || p.action || 'BUY').toString().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
      const entry = Number(p.entry_price || p.price || p.entry || this.price);
      
      let existingPos = null;
      for (const [localId, localPos] of this.openPositions.entries()) {
        if (localPos.transactionId === id || localPos.id === id || (localPos.type === type && Math.abs(localPos.entry - entry) < 100)) {
          existingPos = localPos;
          break;
        }
      }
      
      syncedPositions.set(id, {
        id: id,
        transactionId: id,
        type: type,
        entry: entry,
        units: Number(p.units || p.amount || 1),
        sl: Number(p.stop_loss || p.sl || existingPos?.sl || 0),
        tp1: Number(p.take_profit || p.tp || existingPos?.tp1 || 0),
        status: 'open',
        entryTime: existingPos?.entryTime || new Date(p.time || p.created_at || Date.now()),
        pattern: existingPos?.pattern || 'API Sync',
        strategy: existingPos?.strategy || 'MANUAL',
        tp1Hit: existingPos?.tp1Hit || false,
        breakEvenHit: existingPos?.breakEvenHit || false
      });
    }
    
    this.openPositions = syncedPositions;
  }

  connectToExternalWS() {
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    if (this.ws) {
      this.ws.terminate();
    }

    const auth = { ...defaultConfig.auth, ...(this.settings.api || {}) };
    const url = auth.wsUrl || 'wss://demo.farazgold.com/ws/';
    const cookies = `csrftoken=${auth.csrftoken}; sessionid=${auth.sessionid}`;
    
    this.log(`Connecting to FarazGold WS: ${url}`, "WS");
    
    try {
      this.ws = new WebSocket(url, {
        headers: {
          'Cookie': cookies,
          'Origin': auth.baseUrl,
          'Referer': `${auth.baseUrl}/room/`,
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': auth.csrftoken,
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
        }
      });
      
      this.ws.on('unexpected-response', (req, res) => {
        this.log(`WS unexpected-response: ${res.statusCode}`, "ERROR");
      });

      this.ws.on('open', () => {
        this.log("Connected to FarazGold WS.", "WS");
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.sendTelegramMessage('🟢 *اتصال به سرور فرازگلد برقرار شد*');
        
        this.ws?.send(JSON.stringify({
          action: 'subscribe',
          symbol: 'mazane',
          timeframe: '1',
          history: 300
        }));
        
        this.startPingLoop();
      });

      this.ws.on('message', (data) => {
        this.lastMessageTime = Date.now();
        try {
          const msg = JSON.parse(data.toString());
          
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
                    this.openPositions.delete(id);
                    this.saveState();
                    this.sendTelegramMessage(`🏁 *معامله بسته شد (سرور)*\nسود/ضرر: ${(tx.pnl || 0).toLocaleString('fa-IR')} تومان`);
                    break;
                  }
                }
              }
            });
          }

        } catch (e) {}
      });

      this.ws.on('error', (err) => {
        this.log(`WS Error: ${err.message}`, "ERROR");
      });

      this.ws.on('close', () => {
        if (this.isConnected) {
          // Only send disconnect message if we were previously connected
          // and haven't sent one recently to avoid spam
          this.sendTelegramMessage('🔴 *ارتباط با سرور فرازگلد قطع شد*');
        }
        this.isConnected = false;
        this.log("WS Connection Closed.", "WS");
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
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      } else {
        // If socket is not open, force close to trigger reconnect
        this.ws?.terminate();
      }
    }, 15000);
  }

  stopPingLoop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.wsReconnectTimer) return;
    this.reconnectAttempts++;
    // Exponential backoff with max 60 seconds
    const delay = Math.min(60000, 5000 * Math.pow(1.5, this.reconnectAttempts - 1));
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
      this.log(`Signal Detected: ${result.signal.type} (${result.signal.pattern || 'SCALP'}) Score: ${result.signal.score}`, "SIGNAL");
      this.recorder.recordSignal({ ...result.signal, price: this.price });
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
    const spreadTicks = this.currentSpread / tickSize;
    
    if (this.currentSpread > 0 && spreadTicks > maxSpread) {
      this.log(`Trade Skipped: Spread too high (${spreadTicks.toFixed(1)} > ${maxSpread})`, "INFO");
      return;
    }

    this.lastTradeTime = now;
    
    // Pre-check balance if portfolio is available
    if (this.portfolio && typeof this.portfolio.balance === 'number') {
      const minRequiredBalance = 200000; // Estimated minimum for 1 unit of mazane
      if (this.portfolio.balance < minRequiredBalance) {
        this.log(`Trade Skipped: Insufficient balance (${this.portfolio.balance.toLocaleString('fa-IR')} < ${minRequiredBalance.toLocaleString('fa-IR')})`, "INFO");
        return;
      }
    }
    
    if (this.settings.source === 'API' && this.api) {
      try {
        const orderData: any = {
          action: signal.type.toLowerCase(),
          order_type: 'verbal',
          units: String(signal.units || "1"),
          price: String(this.price),
          take_profit: String(Math.floor(signal.tp1)),
          stop_loss: String(Math.floor(signal.sl)),
          signal_token: ""
        };
        
        this.log(`Attempting API Trade: ${signal.type} TP:${orderData.take_profit} SL:${orderData.stop_loss}`, "INFO");
        
        const response = await this.api.post('/room/api/submit-order/', orderData);
        const rawStatus = response?.data?.status;
        const ok = rawStatus === true || rawStatus === 'true' || rawStatus === 1 || rawStatus === '1' || rawStatus === 'success' || Boolean(response?.data?.order_id) || Boolean(response?.data?.id) || (typeof response?.data?.message === 'string' && response.data.message.includes('ثبت'));

        if (ok) {
          const transId = response?.data?.order_id || response?.data?.id || response?.data?.transaction_id;
          const id = Date.now();
          this.openPositions.set(id, { 
            ...signal, 
            id, 
            transactionId: transId,
            entryTime: new Date(), 
            status: 'open', 
            units: Number(signal.units || 1) 
          });
          this.log(`Trade Executed: ${signal.type} at ${this.price} (ID: ${transId})`, "SUCCESS");
          this.sendTelegramMessage(`🚀 *معامله جدید باز شد*
نوع: ${signal.type === 'BUY' ? 'خرید 🟢' : 'فروش 🔴'}
قیمت: ${this.price.toLocaleString('fa-IR')}
حد سود: ${signal.tp1.toLocaleString('fa-IR')}
حد ضرر: ${signal.sl.toLocaleString('fa-IR')}`);
        } else {
          const errorMsg = response?.data?.message || "";
          this.log(`Trade Entry Failed. Full Response: ${JSON.stringify(response?.data || {})}`, "ERROR");
          if (errorMsg.includes('موجودی ناکافی')) {
            this.log(`Trade Entry Failed: Insufficient balance in account. Please check your margin.`, "ERROR");
            // Optionally disable trading temporarily or alert user
          } else {
            this.log(`Trade Entry Failed: API returned false status. Response: ${JSON.stringify(response?.data || {})}`, "ERROR");
          }
        }
      } catch (e) {
        this.log(`Trade Entry Error: ${e}`, "ERROR");
      }
    } else {
      const id = Date.now();
      this.openPositions.set(id, { ...signal, id, entryTime: new Date(), status: 'open', units: 1 });
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
          this.closeTrade(id, 'take_profit');
          continue;
        }
      }

      // Break Even Logic (50% of TP)
      if (!position.breakEvenHit) {
        const tpDist = Math.abs(position.tp1 - entryPrice);
        const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
        
        if (currentDist >= tpDist * 0.5) {
          position.breakEvenHit = true;
          position.sl = entryPrice; // Move SL to Entry
          this.log(`Break Even triggered for trade ${id}`, "INFO");
        }
      }

      // Pyramiding Logic (5 ticks profit)
      if (this.settings.activeStrategy === 'NUMERICAL' && !position.pyramidTriggered) {
        const currentDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
        if (currentDist >= 5 * tickSize) {
          position.pyramidTriggered = true;
          position.sl = entryPrice; // Move SL of first step to entry
          
          // Open second step
          const signal = {
            type: position.type,
            entry: currentPrice,
            sl: entryPrice, // SL of second step is entry of first step
            tp1: position.tp1, // Same TP
            score: position.score,
            reasons: ['Pyramiding Step 2'],
            confidence: position.confidence,
            timestamp: Date.now(),
            pattern: 'Pyramiding',
            strategy: 'NUMERICAL'
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
      try {
        let ok = false;
        let apiResponse: any = null;

        if (pos.transactionId) {
          const endpoints = [
            `/room/api/close-futures-transaction/${pos.transactionId}/`,
            `/room/api/close-transaction/${pos.transactionId}/`,
            `/room/api/close-order/${pos.transactionId}/`
          ];

          for (const url of endpoints) {
            if (ok) break;
            try {
              const res = await this.api.post(url, {}, {
                headers: { 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' }
              });
              apiResponse = res?.data;
              // Some APIs return {} on success, or status: true
              ok = apiResponse?.status === true || 
                   apiResponse?.status === 'true' || 
                   apiResponse?.status === 1 || 
                   apiResponse?.status === 'success' ||
                   (res.status === 200 && Object.keys(apiResponse || {}).length === 0);
              
              if (ok) {
                this.log(`Closed via ${url}`, "SUCCESS");
              }
            } catch (e: any) {
              const status = e.response?.status;
              const data = e.response?.data;
              if (status !== 404) {
                this.log(`Endpoint ${url} failed with status ${status}: ${JSON.stringify(data || {})}`, "INFO");
              }
            }
          }
          
          if (!ok) {
            this.log(`Close via transactionId failed after all attempts. Last Response: ${JSON.stringify(apiResponse || {})}`, "ERROR");
            
            const msg = String(apiResponse?.message || "");
            if (msg.includes('یافت نشد') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('invalid')) {
              this.log(`Position likely already closed on server. Removing locally.`, "INFO");
              ok = true; 
            }
          }
        } 
        
        if (!ok) {
          const closeAction = isBuy ? 'sell' : 'buy';
          const orderData: any = {
            action: closeAction,
            order_type: 'verbal',
            units: String(pos.units || 1),
            price: String(this.price),
            take_profit: "",
            stop_loss: "",
            signal_token: ""
          };
          const res = await this.api.post('/room/api/submit-order/', orderData);
          apiResponse = res?.data;
          const rawStatus = apiResponse?.status;
          ok = rawStatus === true || rawStatus === 'true' || rawStatus === 1 || rawStatus === '1' || rawStatus === 'success' || Boolean(apiResponse?.order_id) || Boolean(apiResponse?.id) || (typeof apiResponse?.message === 'string' && apiResponse.message.includes('ثبت'));
          
          if (!ok) {
            this.log(`Close via submit-order failed. Response: ${JSON.stringify(apiResponse || {})}`, "ERROR");
            
            // Check for "already closed" or "no position" errors
            const msg = String(apiResponse?.message || "");
            if (msg.includes('موجودی کافی نیست') || msg.includes('یافت نشد')) {
               // If we can't open the opposite order, maybe we don't need to
               this.log(`Could not submit opposite order. Position might be closed.`, "INFO");
            }
          }
        }
        
        if (!ok) {
          this.log(`Close Trade Failed: API returned false status`, "ERROR");
          return; // Do not close in bot state if API failed
        }
      } catch (e) {
        this.log(`Close Trade API Error: ${e}`, "ERROR");
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
    
    // Daily Loss Limit Check (5% of balance)
    const maxDailyLoss = (this.portfolio?.balance || 100000000) * 0.05;
    if (this.dailyPnL <= -maxDailyLoss) {
      this.log(`Daily Loss Limit Reached! Stopping bot.`, "ERROR");
      this.isTrading = false;
      this.sendTelegramMessage(`🚨 *حد ضرر روزانه فعال شد*
ربات متوقف شد و تمام پوزیشن‌ها بسته خواهند شد.`);
      // Close all other open positions
      for (const [otherId, otherPos] of this.openPositions) {
        if (otherId !== id) {
          this.closeTrade(otherId, 'daily_loss_limit');
        }
      }
    }

    const closedPos = {
      ...pos,
      exitPrice: closePrice,
      exitTime: new Date(),
      pnl,
      reason
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

    this.sendTelegramMessage(`🏁 *معامله بسته شد* (${reason})
سود/ضرر: ${pnl.toLocaleString('fa-IR')} تومان
سود کل امروز: ${this.dailyPnL.toLocaleString('fa-IR')}`);
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
    const candles = this.closes.map((c, i) => ({
      x: this.timestamps[i] || (Date.now() - (this.closes.length - i) * 60000),
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
      marketAnalysis: this.getMarketAnalysis()
    };
  }
}
