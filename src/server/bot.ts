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
  isTrading: boolean = true;
  openPositions: Map<number, any> = new Map();
  strategy: Strategy;
  lastTradeTime: number = 0;
  dailyPnL: number = 0;
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
  marketStatus: 'OPEN' | 'CLOSED' = 'CLOSED';

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
      console.log(`[AutoTune] ${level}: ${msg}`);
      if (level === 'info' && msg.includes('Applied patch')) {
        this.strategy = new Strategy(this.settings);
      }
    });
  }

  setupAxios() {
    if (this.settings.source === 'API') {
      const auth = this.settings.api || defaultConfig.auth;
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
    } else {
      this.api = null;
    }
  }

  loadSettings() {
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
        this.settings = JSON.parse(data);
      } else {
        throw new Error("Settings not found");
      }
    } catch (e) {
      this.settings = {
        ...defaultConfig,
        source: 'SIMULATED'
      };
    }
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, 'utf8');
        const state = JSON.parse(data);
        this.dailyPnL = state.dailyPnL || 0;
      }
    } catch (e) {}
  }

  saveState() {
    try {
      const state = {
        dailyPnL: this.dailyPnL,
        lastTradeTime: this.lastTradeTime,
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
      this.dailyStartBalance = this.portfolio?.balance || 0;
      this.saveState();
      this.sendTelegramReport();
    }
  }

  saveSettings(newSettings: any) {
    const sourceChanged = this.settings.source !== newSettings.source || 
                         (newSettings.source === 'API' && this.settings.api?.wsUrl !== newSettings.api?.wsUrl);
    
    this.settings = newSettings;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(newSettings, null, 2));
    this.strategy = new Strategy(newSettings);
    this.initTelegram();
    this.setupAxios();
    
    this.recorder = new DataRecorder(newSettings.dataRecorder);

    if (sourceChanged) {
      console.log("Price source settings changed. Restarting source...");
      if (this.settings.source === 'API') {
        this.connectToExternalWS();
      } else {
        this.simulateMarket();
      }
    }
  }

  initTelegram() {
    if (this.settings.telegram?.enabled && this.settings.telegram?.botToken) {
      try {
        this.tgBot = new TelegramBot(this.settings.telegram.botToken, { polling: false });
      } catch (e) {
        console.error("Telegram Init Error:", e);
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
        console.error("Telegram Send Error:", e);
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
    console.log("Bot engine v4.3 PRO starting...");
    
    if (this.settings.source === 'API') {
      await this.updatePortfolio();
      this.connectToExternalWS();
    } else {
      this.simulateMarket();
    }
    
    if (this.mainLoopTimer) clearInterval(this.mainLoopTimer);
    this.mainLoopTimer = setInterval(() => {
      this.resetDailyIfNeeded();
      this.checkTargetsAndStops();
      
      const now = Date.now();
      
      if (this.settings.source === 'API' && now % 30000 < 1000) {
        this.updatePortfolio();
      }
      
      // Send periodic report every hour
      if (now % 3600000 < 1000) {
        this.sendTelegramReport();
      }
    }, 1000);
  }

  async updatePortfolio() {
    if (!this.api) return;
    try {
      const response = await this.api.post('/room/api/check-portfolio/', {});
      this.portfolio = response.data;
      if (this.dailyStartBalance === 0) {
        this.dailyStartBalance = this.portfolio.balance || 0;
      }
    } catch (error) {
      console.error("Portfolio Update Error:", error);
    }
  }

  connectToExternalWS() {
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    if (this.ws) {
      this.ws.terminate();
    }

    const auth = this.settings.api || defaultConfig.auth;
    const url = auth.wsUrl;
    const cookies = `csrftoken=${auth.csrftoken}; sessionid=${auth.sessionid}`;
    
    console.log(`Connecting to FarazGold WS: ${url}`);
    
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
        console.error(`WS unexpected-response: ${res.statusCode}`);
      });

      this.ws.on('open', () => {
        console.log("Connected to FarazGold WS.");
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
          
          if (msg.market_status) {
            this.marketStatus = msg.market_status === 'open' ? 'OPEN' : 'CLOSED';
          }

          if (msg.bars && msg.bars['1']) {
            const timeframeValue = this.settings.timeframe?.value || 60;
            if (timeframeValue === 60) {
              const bars = msg.bars['1'];
              if (Array.isArray(bars)) {
                bars.forEach(bar => this.processCandle(bar));
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
        console.error("WS Error:", err);
      });

      this.ws.on('close', () => {
        if (this.isConnected) {
          this.sendTelegramMessage('🔴 *ارتباط با سرور فرازگلد قطع شد*');
        }
        this.isConnected = false;
        this.stopPingLoop();
        this.scheduleReconnect();
      });

    } catch (e) {
      console.error("WS Connection Failed:", e);
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

  processCandle(candle: any) {
    const close = parseFloat(candle.close || candle.c);
    const high = parseFloat(candle.high || candle.h);
    const low = parseFloat(candle.low || candle.l);
    const volume = parseFloat(candle.volume || candle.v || 0);

    if (close > 0) {
      this.price = close;
      this.closes.push(close);
      this.highs.push(high);
      this.lows.push(low);
      this.volumes.push(volume);

      if (this.closes.length > 300) {
        this.closes.shift();
        this.highs.shift();
        this.lows.shift();
        this.volumes.shift();
      }
      
      this.recorder.recordCandle({ t: Date.now(), o: candle.open || candle.o || close, h: high, l: low, c: close, v: volume });
      this.checkForSignal();
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

  simulateMarket() {
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    this.marketStatus = 'OPEN';
    
    if (this.settings.simulation?.mode === 'BACKTEST') {
      try {
        const marketFile = path.join(process.cwd(), 'logs', 'market.jsonl');
        if (fs.existsSync(marketFile)) {
          const content = fs.readFileSync(marketFile, 'utf8');
          const lines = content.split('\n').filter(l => l.trim());
          let i = 0;
          this.simulationInterval = setInterval(() => {
            if (i < lines.length) {
              try {
                const c = JSON.parse(lines[i]);
                this.price = c.c;
                this.processCandle(c);
                i++;
              } catch (e) {}
            } else {
              clearInterval(this.simulationInterval!);
              console.log("Backtest finished.");
            }
          }, this.settings.simulation?.speedMs || 100);
          return;
        } else {
          console.warn("Backtest mode selected but market.jsonl not found. Falling back to random simulation.");
        }
      } catch (e) {
        console.error("Backtest Error:", e);
      }
    }

    this.price = this.settings.simulation?.basePrice || 18500000;
    this.simulationInterval = setInterval(() => {
      try {
        const vol = this.settings.simulation?.volatility || 5000;
        const trend = this.settings.simulation?.trend || 0;
        const change = (Math.random() - 0.5) * vol + (trend * vol * 0.1);
        
        this.price += change;
        this.processCandle({
          close: this.price,
          high: this.price + Math.random() * 2000,
          low: this.price - Math.random() * 2000,
          volume: Math.random() * 100
        });
      } catch (e) {}
    }, 3000);
  }

  checkForSignal() {
    if (!this.isTrading || this.marketStatus === 'CLOSED' || this.closes.length < 20) return;
    
    const history = this.closes.map((c, i) => ({
      price: c,
      high: this.highs[i],
      low: this.lows[i],
      volume: this.volumes[i],
      time: Date.now()
    }));

    const result = this.strategy.analyze(history, this.openPositions.size, this.price);
    if (result.signal) {
      this.recorder.recordSignal({ ...result.signal, price: this.price });
      this.enterTrade(result.signal);
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
          this.sendTelegramMessage(`🚀 *معامله جدید باز شد*
نوع: ${signal.type === 'BUY' ? 'خرید 🟢' : 'فروش 🔴'}
قیمت: ${this.price.toLocaleString('fa-IR')}
حد سود: ${signal.tp1.toLocaleString('fa-IR')}
حد ضرر: ${signal.sl.toLocaleString('fa-IR')}`);
        }
      } catch (e) {
        console.error("Trade Entry Error:", e);
      }
    } else {
      const id = Date.now();
      this.openPositions.set(id, { ...signal, id, entryTime: new Date(), status: 'open', units: 1 });
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
        console.error("Close Trade API Error:", e);
      }
    }

    this.dailyPnL += pnl;
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
      x: new Date(Date.now() - (this.closes.length - i) * 60000).getTime(), // Approximate time
      y: [
        this.closes[i-1] || c, // Open (approximate if not stored)
        this.highs[i],         // High
        this.lows[i],          // Low
        c                      // Close
      ]
    })).slice(-50); // Send last 50 candles

    return {
      price: this.price,
      isTrading: this.isTrading,
      marketStatus: this.marketStatus,
      isConnected: this.isConnected,
      openPositions: Array.from(this.openPositions.values()),
      dailyPnL: this.dailyPnL,
      indicators: this.strategy.indicators,
      settings: this.settings,
      portfolio: this.portfolio,
      candles: candles
    };
  }
}
