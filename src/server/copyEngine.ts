import WebSocket from 'ws';
import axios, { AxiosInstance } from 'axios';
import { config } from './config';
import fs from 'fs';
import path from 'path';

export class CopyEngine {
  private sourceWs: WebSocket | null = null;
  private destApi: AxiosInstance | null = null;
  private isRunning: boolean = false;
  private settings: any;
  private activeTrades: Map<number, number> = new Map(); // Source TxID -> Dest TxID
  private lastPrice: number = 0;
  private logs: any[] = [];
  private statePath = path.join(process.cwd(), 'src/server/copy_state.json');

  constructor(sharedSettings: any) {
    this.settings = sharedSettings;
    this.loadState();
  }

  private loadState() {
    if (fs.existsSync(this.statePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
        if (data.activeTrades) {
          this.activeTrades = new Map(Object.entries(data.activeTrades).map(([k, v]) => [Number(k), Number(v)]));
        }
      } catch (e) {
        this.log("Failed to load copy state.", "ERROR");
      }
    }
  }

  private saveState() {
    try {
      const data = {
        activeTrades: Object.fromEntries(this.activeTrades)
      };
      fs.writeFileSync(this.statePath, JSON.stringify(data, null, 2));
    } catch (e) {
      this.log("Failed to save copy state.", "ERROR");
    }
  }

  public async start() {
    if (this.isRunning) return { success: true, message: "Already running" };
    
    if (!this.settings.copyTrade?.source?.bearerToken || !this.settings.copyTrade?.destination?.bearerToken) {
      this.log("Missing Bearer Tokens. Please enter tokens for both accounts.", "ERROR");
      return { success: false, message: "توکن‌های مبدا یا مقصد وارد نشده‌اند." };
    }

    this.isRunning = true;
    this.log("Starting Copy Trade Engine...", "INFO");
    
    try {
      await this.setupDestinationApi();
      this.connectSourceWs();
      return { success: true, message: "سیستم کپی ترید با موفقیت فعال شد." };
    } catch (e: any) {
      this.isRunning = false;
      return { success: false, message: e.message };
    }
  }

  public updateSettings(newSettings: any) {
    this.settings = newSettings;
    this.log("Settings updated.", "INFO");
    if (this.isRunning) {
      // Re-setup if running to apply new tokens/types
      this.setupDestinationApi();
      if (this.sourceWs) {
        this.sourceWs.terminate();
        this.connectSourceWs();
      }
    }
  }

  public stop() {
    this.isRunning = false;
    if (this.sourceWs) {
      this.sourceWs.terminate();
      this.sourceWs = null;
    }
    this.log("Copy Trade Engine stopped.", "INFO");
  }

  private async setupDestinationApi() {
    const dest = this.settings.copyTrade.destination;
    const baseUrl = dest.type === 'real' ? 'https://farazgold.com' : 'https://demo.farazgold.com';
    
    this.destApi = axios.create({
      baseURL: baseUrl,
      headers: {
        'Authorization': `Bearer ${dest.bearerToken}`,
        'Content-Type': 'application/json',
        'Origin': baseUrl,
        'Referer': `${baseUrl}/room/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    // Test connection
    try {
      await this.destApi.get('/api/room/api/get-user-info/');
      this.log("Destination API connected successfully.", "SUCCESS");
    } catch (e: any) {
      this.log(`Destination API connection failed: ${e.message}`, "ERROR");
    }
  }

  private connectSourceWs() {
    if (!this.isRunning) return;

    const src = this.settings.copyTrade.source;
    if (!src || !src.bearerToken) {
      this.log("Source bearer token missing. Cannot connect.", "ERROR");
      return;
    }

    const baseUrl = src.type === 'real' ? 'https://farazgold.com' : 'https://demo.farazgold.com';
    const baseWsUrl = src.type === 'real' ? 'wss://farazgold.com/ws/' : 'wss://demo.farazgold.com/ws/';
    
    // FarazGold WS often requires token in URL
    const wsUrl = baseWsUrl.includes('?') 
      ? `${baseWsUrl}&token=${src.bearerToken}`
      : `${baseWsUrl}?token=${src.bearerToken}`;
    
    this.log(`Connecting to Source WS: ${baseWsUrl}`, "INFO");

    if (this.sourceWs) {
      this.sourceWs.terminate();
    }

    this.sourceWs = new WebSocket(wsUrl, {
      headers: {
        'Origin': baseUrl,
        'Referer': `${baseUrl}/room/`,
        'Authorization': `Bearer ${src.bearerToken}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      handshakeTimeout: 10000
    });

    let pingInterval: NodeJS.Timeout;

    this.sourceWs.on('unexpected-response', (req, res) => {
      this.log(`Source WS unexpected-response: ${res.statusCode}. Check if token is valid.`, "ERROR");
      if (this.sourceWs) {
        this.sourceWs.terminate();
      }
    });

    this.sourceWs.on('open', () => {
      this.log("Source WebSocket connected.", "SUCCESS");
      
      // Keep alive
      pingInterval = setInterval(() => {
        if (this.sourceWs?.readyState === WebSocket.OPEN) {
          this.sourceWs.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);

      this.sourceWs?.send(JSON.stringify({
        action: 'SubAdd',
        subs: ['0~farazgold~mazane~gold~1']
      }));
    });

    this.sourceWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') return;
        this.handleSourceMessage(msg);
      } catch (e) {}
    });

    this.sourceWs.on('close', (code, reason) => {
      if (pingInterval) clearInterval(pingInterval);
      this.log(`Source WebSocket closed (Code: ${code}, Reason: ${reason || 'None'}). Reconnecting in 5s...`, "ERROR");
      if (this.isRunning) {
        setTimeout(() => this.connectSourceWs(), 5000);
      }
    });

    this.sourceWs.on('error', (err) => {
      this.log(`Source WebSocket Error: ${err.message}`, "ERROR");
    });
  }

  private async handleSourceMessage(msg: any) {
    // 1. Price Update
    if (msg.action === 'Update' && msg.data?.price) {
      this.lastPrice = msg.data.price;
    }

    // 2. New Transaction (Open)
    if (msg.new_transactions_open || msg.transactions_open || msg.new_user_orders) {
      const txs = msg.new_transactions_open || msg.transactions_open || msg.new_user_orders;
      const arr = Array.isArray(txs) ? txs : [txs];
      for (const tx of arr) {
        // Skip if it's just an order update that isn't 'completed'
        if (msg.new_user_orders && tx.status && tx.status !== 'completed' && tx.status !== 'filled') continue;

        const srcTxId = Number(tx.id || tx.transaction_id || tx.order_id);
        if (srcTxId && !this.activeTrades.has(srcTxId)) {
          const type = (tx.type || tx.action || '').toString().toUpperCase();
          const price = Number(tx.price || tx.entry_price || tx.entry || this.lastPrice);
          const units = Number(tx.units || tx.amount || 1);

          if (!type.includes('BUY') && !type.includes('SELL')) continue;

          this.log(`New trade detected in Source: ${type} at ${price} (ID: ${srcTxId})`, "SIGNAL");
          await this.copyOpenTrade({ ...tx, type, price, units, id: srcTxId });
        }
      }
    }

    // 3. Order Update (SL/TP changes)
    if (msg.new_user_orders) {
      const order = msg.new_user_orders;
      const srcTxId = Number(order.transaction_id || order.id);
      if (srcTxId && this.activeTrades.has(srcTxId)) {
        const destTxId = this.activeTrades.get(srcTxId)!;
        const sl = Number(order.stop_loss || order.sl || 0);
        const tp = Number(order.take_profit || order.tp || 0);
        
        if (sl > 0 || tp > 0) {
          this.log(`Update detected in Source for ${srcTxId}: SL=${sl}, TP=${tp}`, "INFO");
          await this.syncSlTp(destTxId, sl, tp);
        }
      }
    }

    // 4. Transaction Closed
    if (msg.new_transactions_history || msg.transactions_history || (msg.new_user_orders && (msg.new_user_orders.status === 'closed' || msg.new_user_orders.status === 'cancelled'))) {
      const txs = msg.new_transactions_history || msg.transactions_history || msg.new_user_orders;
      const arr = Array.isArray(txs) ? txs : [txs];
      for (const tx of arr) {
        const srcTxId = Number(tx.id || tx.transaction_id || tx.order_id);
        if (srcTxId && this.activeTrades.has(srcTxId)) {
          const destTxId = this.activeTrades.get(srcTxId)!;
          this.log(`Trade ${srcTxId} closed in Source. Closing ${destTxId} in Destination...`, "SUCCESS");
          await this.closeDestTrade(destTxId);
          this.activeTrades.delete(srcTxId);
          this.saveState();
        }
      }
    }
  }

  private async copyOpenTrade(srcTx: any) {
    if (!this.destApi) return;

    try {
      const typeStr = srcTx.type.toLowerCase();
      const action = typeStr.includes('buy') ? 'buy' : 'sell';
      
      // Check max positions for Copy Trade
      const maxPos = this.settings.copyTrade?.maxPositions ?? 5;
      if (this.activeTrades.size >= maxPos) {
        this.log(`Copy Trade Skipped: Max Concurrent Positions reached (${this.activeTrades.size}/${maxPos})`, "INFO");
        return;
      }

      const multiplier = Number(this.settings.copyTrade.multiplier || 1);
      const units = Math.max(1, Math.round(srcTx.units * multiplier));
      
      this.log(`Copying ${action.toUpperCase()} ${units} units to Destination (Source ID: ${srcTx.id})...`, "INFO");

      const response = await this.destApi.post('/api/room/api/submit-order/', {
        action: action,
        order_type: "verbal",
        units: String(units),
        price: -1,
        take_profit: String(Math.round(srcTx.tp || srcTx.take_profit || 0)),
        stop_loss: String(Math.round(srcTx.sl || srcTx.stop_loss || 0)),
        signal_token: ""
      });

      const data = response.data;
      if (data.status === true || data.status === 'success' || data.order_id) {
        const destTxId = data.order_id || data.id || data.transaction_id;
        if (destTxId) {
          this.activeTrades.set(Number(srcTx.id), Number(destTxId));
          this.saveState();
          this.log(`Trade copied successfully! Source:${srcTx.id} -> Destination:${destTxId}`, "SUCCESS");
        }
      } else {
        this.log(`Failed to copy trade: ${data.message || JSON.stringify(data)}`, "ERROR");
      }
    } catch (e: any) {
      this.log(`Error copying trade: ${e.message}`, "ERROR");
    }
  }

  private async syncSlTp(destTxId: number, sl: number, tp: number) {
    if (!this.destApi) return;
    
    try {
      if (this.settings.copyTrade.copySL && sl > 0) {
        await this.destApi.post(`/api/room/api/edit-stop-loss/${destTxId}/`, { stop_loss: String(Math.round(sl)) });
      }
      if (this.settings.copyTrade.copyTP && tp > 0) {
        await this.destApi.post(`/api/room/api/edit-take-profit/${destTxId}/`, { take_profit: String(Math.round(tp)) });
      }
      this.log(`Synced SL/TP for Destination ID ${destTxId}`, "SUCCESS");
    } catch (e: any) {
      this.log(`Error syncing SL/TP for ${destTxId}: ${e.message}`, "ERROR");
    }
  }

  private async closeDestTrade(destTxId: number) {
    if (!this.destApi) return;
    try {
      const endpoints = [
        `/api/room/api/close-futures-transaction/${destTxId}/`,
        `/api/room/api/close-transaction/${destTxId}/`
      ];

      let ok = false;
      for (const url of endpoints) {
        if (ok) break;
        try {
          const res = await this.destApi.post(url, {}, {
            headers: { 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' }
          });
          if (res.data?.status === true || res.data?.status === 'success') {
            ok = true;
            this.log(`Destination trade ${destTxId} closed successfully.`, "SUCCESS");
          }
        } catch (e) {}
      }

      if (!ok) {
        this.log(`Failed to close destination trade ${destTxId} via standard endpoints.`, "ERROR");
      }
    } catch (e: any) {
      this.log(`Error closing destination trade ${destTxId}: ${e.message}`, "ERROR");
    }
  }

  private log(message: string, type: 'INFO' | 'SUCCESS' | 'ERROR' | 'SIGNAL' = 'INFO') {
    const logEntry = {
      time: new Date().toLocaleTimeString('fa-IR'),
      message: `[CopyTrade] ${message}`,
      type
    };
    console.log(`\x1b[34m[COPY]\x1b[0m [${logEntry.time}] ${message}`);
    this.logs.unshift(logEntry);
    if (this.logs.length > 100) this.logs.pop();
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      activeTradesCount: this.activeTrades.size,
      logs: this.logs,
      settings: this.settings.copyTrade
    };
  }
}
