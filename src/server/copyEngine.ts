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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
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
    const wsUrl = src.type === 'real' ? 'wss://farazgold.com/ws/' : 'wss://demo.farazgold.com/ws/';
    
    this.log(`Connecting to Source WS: ${wsUrl}`, "INFO");

    this.sourceWs = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${src.bearerToken}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'
      }
    });

    this.sourceWs.on('open', () => {
      this.log("Source WebSocket connected.", "SUCCESS");
      this.sourceWs?.send(JSON.stringify({
        action: 'SubAdd',
        subs: ['0~farazgold~mazane~gold~1']
      }));
    });

    this.sourceWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleSourceMessage(msg);
      } catch (e) {}
    });

    this.sourceWs.on('close', () => {
      this.log("Source WebSocket closed. Reconnecting in 5s...", "ERROR");
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
    if (msg.new_transactions_open || msg.transactions_open) {
      const txs = msg.new_transactions_open || msg.transactions_open;
      const arr = Array.isArray(txs) ? txs : [txs];
      for (const tx of arr) {
        const srcTxId = Number(tx.id);
        if (srcTxId && !this.activeTrades.has(srcTxId)) {
          this.log(`New trade detected in Source: ${tx.type} at ${tx.price} (ID: ${srcTxId})`, "SIGNAL");
          await this.copyOpenTrade(tx);
        }
      }
    }

    // 3. Order Update (SL/TP changes)
    if (msg.new_user_orders) {
      const order = msg.new_user_orders;
      const srcTxId = Number(order.transaction_id);
      if (srcTxId && this.activeTrades.has(srcTxId)) {
        const destTxId = this.activeTrades.get(srcTxId)!;
        this.log(`Update detected in Source for ${srcTxId}: SL=${order.stop_loss}, TP=${order.take_profit}`, "INFO");
        await this.syncSlTp(destTxId, order.stop_loss, order.take_profit);
      }
    }

    // 4. Transaction Closed
    if (msg.new_transactions_history || msg.transactions_history) {
      const txs = msg.new_transactions_history || msg.transactions_history;
      const arr = Array.isArray(txs) ? txs : [txs];
      for (const tx of arr) {
        const srcTxId = Number(tx.id || tx.transaction_id);
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
      const typeStr = (srcTx.type || srcTx.action || '').toLowerCase();
      if (!typeStr.includes('buy') && !typeStr.includes('sell')) {
        this.log(`Skipping trade ${srcTx.id}: Unknown type "${typeStr}"`, "INFO");
        return;
      }

      const action = typeStr.includes('buy') ? 'buy' : 'sell';
      
      // Check max positions for Copy Trade
      const maxPos = this.settings.copyTrade?.maxPositions ?? 5;
      if (this.activeTrades.size >= maxPos) {
        this.log(`Copy Trade Skipped: Max Concurrent Positions reached (${this.activeTrades.size}/${maxPos})`, "INFO");
        return;
      }

      const units = Math.max(1, Math.round(srcTx.units * (this.settings.copyTrade.multiplier || 1)));
      
      this.log(`Copying ${action} ${units} units to Destination (Source ID: ${srcTx.id})...`, "INFO");

      const response = await this.destApi.post('/api/room/api/submit-order/', {
        action: action,
        order_type: "verbal",
        units: String(units),
        price: -1,
        take_profit: String(srcTx.tp || srcTx.take_profit || 0),
        stop_loss: String(srcTx.sl || srcTx.stop_loss || 0),
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
