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
    const report = `📊 *گزارش عملکرد دوره‌ای*
💰 سود/ضرر امروز: ${this.dailyPnL.toLocaleString('fa-IR')} تومان
📈 قیمت نهایی: ${this.price.toLocaleString('fa-IR')}
🛒 پوزیشن‌های باز: ${this.openPositions.size}
📅 تاریخ: ${this.dailyDateKey}`;
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
      
      if (now % 30000 < 1000) {
        this.updatePortfolio();
      }
      
      // Send periodic report every hour
      if (now % 3600000 < 1000) {
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
        this.closes = [];
        this.highs = [];
        this.lows = [];
        this.volumes = [];
        this.timestamps = [];
        
        for (const bar of response.data) {
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
      if (this.dailyStartBalance === 0) {
        this.dailyStartBalance = this.portfolio.balance || 0;
      }
    } catch (error: any) {
      if (error?.code === 'EAI_AGAIN' || error?.message?.includes('EAI_AGAIN')) {
        // Suppress frequent DNS errors
        if (Math.random() < 0.05) {
          this.log(`Portfolio Update: Network/DNS issue connecting to server.`, "INFO");
        }
      } else {
        this.log(`Portfolio Update Error: ${error.message || error}`, "ERROR");
      }
    }
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
              msg.forEach(bar => this.processCandle(bar, true));
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
               msg.history.forEach((bar: any) => this.processCandle(bar, true));
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
    const delay = Math.min(30000, 3000 * Math.pow(1.2, this.reconnectAttempts));
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectToExternalWS();
    }, delay);
  }

  processCandle(candle: any, skipSignalCheck: boolean = false) {
    const close = parseFloat(candle.close || candle.c);
    const high = parseFloat(candle.high || candle.h);
    const low = parseFloat(candle.low || candle.l);
    const volume = parseFloat(candle.volume || candle.v || 0);
    const time = candle.time ? candle.time * 1000 : (candle.t || Date.now());

    if (close > 0) {
      this.price = close;
      this.closes.push(close);
      this.highs.push(high);
      this.lows.push(low);
      this.volumes.push(volume);
      this.timestamps.push(time);

      if (this.closes.length > 500) {
        this.closes.shift();
        this.highs.shift();
        this.lows.shift();
        this.volumes.shift();
        this.timestamps.shift();
      }
      
      this.recorder.recordCandle({ t: time, o: candle.open || candle.o || close, h: high, l: low, c: close, v: volume });
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

  async enterTrade(signal: any) {
    const now = Date.now();
    if (now - this.lastTradeTime < (this.settings.strategy?.tradeCooldown * 1000 || 8000)) return;
    if (this.openPositions.size >= (this.settings.risk?.maxOpenPositions || 2)) return;

    this.lastTradeTime = now;
    
    if (this.settings.source === 'API' && this.api) {
      try {
        const orderData = {
          action: signal.type.toLowerCase(),
          order_type: 'verbal',
          units: "1",
          price: -1,
          take_profit: String(Math.floor(signal.tp1)),
          stop_loss: String(Math.floor(signal.sl)),
          signal_token: ''
        };
        const response = await this.api.post('/room/api/submit-order/', orderData);
        const rawStatus = response?.data?.status;
        const ok = rawStatus === true || rawStatus === 'true' || rawStatus === 1 || rawStatus === '1' || rawStatus === 'success' || Boolean(response?.data?.order_id) || Boolean(response?.data?.id) || (typeof response?.data?.message === 'string' && response.data.message.includes('ثبت'));

        if (ok) {
          const id = Date.now();
          this.openPositions.set(id, { ...signal, id, entryTime: new Date(), status: 'open', units: 1 });
          this.log(`Trade Executed: ${signal.type} at ${this.price}`, "SUCCESS");
          this.sendTelegramMessage(`🚀 *معامله جدید باز شد*
نوع: ${signal.type === 'BUY' ? 'خرید 🟢' : 'فروش 🔴'}
قیمت: ${this.price.toLocaleString('fa-IR')}
حد سود: ${signal.tp1.toLocaleString('fa-IR')}
حد ضرر: ${signal.sl.toLocaleString('fa-IR')}`);
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

    for (const [id, position] of this.openPositions) {
      if (position.status !== 'open') continue;

      const isBuy = position.type === 'BUY';

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
    }
  }

  async closeTrade(id: number, reason: string = 'manual') {
    const pos = this.openPositions.get(id);
    if (!pos) return;

    this.log(`Closing Trade ${id} (${reason}) at ${this.price}`, "INFO");

    const isBuy = pos.type === 'BUY';
    const closePrice = this.price;
    const pnl = isBuy ? (closePrice - pos.entry) : (pos.entry - closePrice);

    if (this.settings.source === 'API' && this.api) {
      try {
        if (pos.transactionId) {
          await this.api.post(`/room/api/close-futures-transaction/${pos.transactionId}/`, {}, {
            headers: { 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' }
          });
        } else {
          const closeAction = isBuy ? 'sell' : 'buy';
          await this.api.post('/room/api/submit-order/', {
            action: closeAction,
            order_type: 'verbal',
            units: String(pos.units || 1),
            price: -1,
            take_profit: '',
            stop_loss: '',
            signal_token: ''
          });
        }
      } catch (e) {
        this.log(`Close Trade API Error: ${e}`, "ERROR");
      }
    }

    this.dailyPnL += pnl;
    this.totalTrades++;
    if (pnl > 0) this.winningTrades++;
    else if (pnl < 0) this.losingTrades++;
    
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
      entry: pos.entry,
      exit: closePrice,
      units: pos.units || 1,
      pnl: pnl,
      reason: reason
    });

    this.sendTelegramMessage(`🏁 *معامله بسته شد* (${reason})
سود/ضرر: ${pnl.toLocaleString('fa-IR')} تومان
سود کل امروز: ${this.dailyPnL.toLocaleString('fa-IR')}`);
  }

  getState() {
    const candles = this.closes.map((c, i) => ({
      x: this.timestamps[i] || (Date.now() - (this.closes.length - i) * 60000),
      y: [
        this.closes[i-1] || c, // Open (approximate if not stored)
        this.highs[i],         // High
        this.lows[i],          // Low
        c                      // Close
      ]
    })).slice(-50); // Send last 50 candles to keep UI fast

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
      logs: this.logs
    };
  }
}
