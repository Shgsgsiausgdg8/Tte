import fs from 'fs';
import path from 'path';

export class DataRecorder {
  enabled: boolean;
  dir: string;
  marketFile: string;
  signalFile: string;
  tradeFile: string;
  flushEvery: number;
  private _bufMarket: string[] = [];
  private _bufSignal: string[] = [];
  private _bufTrade: string[] = [];

  constructor(opts: any = {}) {
    this.enabled = Boolean(opts.enabled);
    this.dir = opts.dir || path.join(process.cwd(), 'logs');
    this.marketFile = path.join(this.dir, opts.marketFile || 'market.jsonl');
    this.signalFile = path.join(this.dir, opts.signalFile || 'signals.jsonl');
    this.tradeFile = path.join(this.dir, opts.tradeFile || 'trades.jsonl');
    this.flushEvery = Number(opts.flushEvery || 1);
    this._ensureDir();
  }

  private _ensureDir() {
    try {
      if (!fs.existsSync(this.dir)) {
        fs.mkdirSync(this.dir, { recursive: true });
      }
    } catch (_) {}
  }

  private _append(file: string, lines: string[]) {
    if (!lines.length) return;
    try {
      fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
    } catch (_) {}
  }

  private _push(buf: string[], obj: any, file: string) {
    if (!this.enabled) return;
    const line = JSON.stringify(obj);
    buf.push(line);
    if (buf.length >= this.flushEvery) {
      this._append(file, buf);
      buf.length = 0;
    }
  }

  recordCandle(c: any) {
    if (!c) return;
    this._push(this._bufMarket, {
      t: c.t || Date.now(),
      o: Number(c.o),
      h: Number(c.h),
      l: Number(c.l),
      c: Number(c.c),
      v: Number(c.v || 0)
    }, this.marketFile);
  }

  recordSignal(s: any) {
    if (!s) return;
    this._push(this._bufSignal, {
      t: s.t || Date.now(),
      type: s.type,
      score: Number(s.score || 0),
      price: Number(s.price || 0),
      entry: Number(s.entry || 0),
      sl: Number(s.sl || 0),
      tp1: Number(s.tp1 || 0),
      reasons: Array.isArray(s.reasons) ? s.reasons : [],
      indicators: s.indicators || null
    }, this.signalFile);
  }

  recordTrade(t: any) {
    if (!t) return;
    this._push(this._bufTrade, {
      tOpen: t.tOpen || Date.now(),
      tClose: t.tClose || null,
      side: t.side,
      entry: Number(t.entry || 0),
      exit: Number(t.exit || 0),
      units: Number(t.units || 0),
      pnl: Number(t.pnl || 0),
      pnlTicks: Number(t.pnlTicks || 0),
      reason: t.reason || '',
      maeTicks: Number(t.maeTicks || 0),
      mfeTicks: Number(t.mfeTicks || 0),
      meta: t.meta || null
    }, this.tradeFile);
  }

  flush() {
    if (!this.enabled) return;
    this._append(this.marketFile, this._bufMarket); this._bufMarket.length = 0;
    this._append(this.signalFile, this._bufSignal); this._bufSignal.length = 0;
    this._append(this.tradeFile, this._bufTrade); this._bufTrade.length = 0;
  }
}
