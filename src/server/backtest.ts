import fs from 'fs';
import { Strategy } from './strategy';

export function readJsonl(file: string) {
  const out: any[] = [];
  if (!fs.existsSync(file)) return out;
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const ln of lines) {
    try { out.push(JSON.parse(ln)); } catch (_) {}
  }
  return out;
}

function maxDrawdown(equityCurve: number[]) {
  let peak = 0;
  let maxDd = 0;
  for (const x of equityCurve) {
    if (x > peak) peak = x;
    const dd = peak - x;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function simulateTrade({ bars, iEntry, side, cfg, entryPrice }: any) {
  const tickSize = Number(cfg.market?.tickSize ?? 1);
  const tt = cfg.targetsTicks || {};
  const stopTicks = Number(tt.stopTicks ?? 12);
  const tp1Ticks = Number(tt.tpTicks ?? 18);

  const trailing = tt.trailing || {};
  const trailEnabled = Boolean(trailing.enabled);
  const activateAfterTicks = Number(trailing.activateAfterTicks ?? 12);
  const trailTicks = Number(trailing.trailTicks ?? 10);

  const breakEven = cfg.targets?.breakEven || {};
  const beEnabled = Boolean(breakEven.enabled);
  const beBufferTicks = Number(breakEven.bufferTicks ?? 1);

  const partial = cfg.targets?.partialClose || {};
  const partialEnabled = Boolean(partial.enabled);

  const isBuy = side === 'BUY';
  const sl = isBuy ? entryPrice - stopTicks * tickSize : entryPrice + stopTicks * tickSize;
  const tp1 = isBuy ? entryPrice + tp1Ticks * tickSize : entryPrice - tp1Ticks * tickSize;

  let posUnits = 1;
  let realizedTicks = 0;
  let tp1Hit = false;

  let mfe = 0, mae = 0;
  let dynStop = sl;
  let trailingActive = false;
  let peak = entryPrice;

  for (let k = iEntry + 1; k < bars.length; k++) {
    const b = bars[k];
    const hi = Number(b.h ?? b.high ?? b.c);
    const lo = Number(b.l ?? b.low ?? b.c);

    const favorable = isBuy ? (hi - entryPrice) : (entryPrice - lo);
    const adverse = isBuy ? (entryPrice - lo) : (hi - entryPrice);
    mfe = Math.max(mfe, Math.round(favorable / tickSize));
    mae = Math.max(mae, Math.round(adverse / tickSize));

    if (isBuy) peak = Math.max(peak, hi);
    else peak = Math.min(peak, lo);

    if (trailEnabled) {
      const movedTicks = isBuy ? Math.round((peak - entryPrice) / tickSize) : Math.round((entryPrice - peak) / tickSize);
      if (!trailingActive && movedTicks >= activateAfterTicks) trailingActive = true;
      if (trailingActive) {
        const newStop = isBuy ? (peak - trailTicks * tickSize) : (peak + trailTicks * tickSize);
        if (isBuy) dynStop = Math.max(dynStop, newStop);
        else dynStop = Math.min(dynStop, newStop);
      }
    }

    const slHit = isBuy ? (lo <= dynStop) : (hi >= dynStop);
    if (slHit) {
      const exit = dynStop;
      const ticks = isBuy ? Math.round((exit - entryPrice) / tickSize) : Math.round((entryPrice - exit) / tickSize);
      realizedTicks += ticks * posUnits;
      return { exitIndex: k, exitPrice: exit, realizedTicks, maeTicks: mae, mfeTicks: mfe, reason: 'SL/Stop' };
    }

    if (!tp1Hit) {
      const tp1HitBar = isBuy ? (hi >= tp1) : (lo <= tp1);
      if (tp1HitBar) {
        tp1Hit = true;
        if (partialEnabled) {
          const pct = Number(partial.tp1ClosePercent ?? 50) / 100;
          const closeUnits = Math.max(0, Math.min(posUnits, pct * posUnits));
          const ticks = isBuy ? Math.round((tp1 - entryPrice) / tickSize) : Math.round((entryPrice - tp1) / tickSize);
          realizedTicks += ticks * closeUnits;
          posUnits -= closeUnits;
        }
        if (beEnabled) {
          const be = isBuy ? (entryPrice + beBufferTicks * tickSize) : (entryPrice - beBufferTicks * tickSize);
          if (isBuy) dynStop = Math.max(dynStop, be);
          else dynStop = Math.min(dynStop, be);
        }
      }
    }
  }

  const last = bars[bars.length - 1];
  const exitPrice = Number(last.c ?? last.close ?? 0);
  const ticks = isBuy ? Math.round((exitPrice - entryPrice) / tickSize) : Math.round((entryPrice - exitPrice) / tickSize);
  realizedTicks += ticks * posUnits;
  return { exitIndex: bars.length - 1, exitPrice, realizedTicks, maeTicks: mae, mfeTicks: mfe, reason: 'EOD' };
}

export function runBacktest(cfg: any, bars: any[], opts: any = {}) {
  const warmup = Number(opts.warmup || 50);
  const strat = new Strategy({ ...cfg.strategy, targets: cfg.targets, risk: cfg.risk, market: cfg.market, targetsTicks: cfg.targetsTicks });

  let equityTicks = 0;
  const equityCurve: number[] = [];
  const trades: any[] = [];
  const history: any[] = [];

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    history.push({
      price: Number(b.c ?? b.close),
      high: Number(b.h ?? b.high ?? b.c),
      low: Number(b.l ?? b.low ?? b.c),
      volume: Number(b.v ?? b.volume ?? 0),
      time: Number(b.t || Date.now())
    });
    if (history.length > 300) history.shift();

    if (i < warmup) { equityCurve.push(equityTicks); continue; }

    const res = strat.analyze(history, 0, Number(b.c ?? b.close));
    if (!res?.signal) { equityCurve.push(equityTicks); continue; }

    const s = res.signal;
    const minScore = Number(cfg.strategy?.minSignalScore ?? 1);
    if (Number(s.score || 0) < minScore) { equityCurve.push(equityTicks); continue; }

    const side = s.type;
    const entryPrice = Number(b.c ?? b.close);
    const sim = simulateTrade({ bars, iEntry: i, side, cfg, entryPrice });

    equityTicks += sim.realizedTicks;
    equityCurve.push(equityTicks);

    trades.push({
      iEntry: i, iExit: sim.exitIndex,
      side, entry: entryPrice, exit: sim.exitPrice,
      pnlTicks: sim.realizedTicks,
      maeTicks: sim.maeTicks, mfeTicks: sim.mfeTicks,
      reason: sim.reason,
      score: s.score
    });

    i = sim.exitIndex;
  }

  const grossWin = trades.filter(t => t.pnlTicks > 0).reduce((a,b)=>a+b.pnlTicks,0);
  const grossLoss = Math.abs(trades.filter(t => t.pnlTicks < 0).reduce((a,b)=>a+b.pnlTicks,0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
  const winRate = trades.length ? (trades.filter(t=>t.pnlTicks>0).length / trades.length) : 0;
  const avg = trades.length ? (trades.reduce((a,b)=>a+b.pnlTicks,0)/trades.length) : 0;

  return {
    trades,
    metrics: {
      trades: trades.length,
      netTicks: equityTicks,
      winRate,
      profitFactor: pf,
      avgTicks: avg,
      maxDrawdownTicks: maxDrawdown(equityCurve)
    }
  };
}
