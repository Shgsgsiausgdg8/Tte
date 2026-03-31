import fs from 'fs';
import { Strategy } from './strategy';

export function readJsonl(file: string) {
  const out: any[] = [];
  if (!fs.existsSync(file)) return out;
  
  // To prevent memory exhaustion, we read the file in chunks or limit the number of lines
  // For simplicity and speed in this environment, we'll read the file and take the last 10,000 lines
  // if it's too large.
  try {
    const stats = fs.statSync(file);
    const maxSize = 50 * 1024 * 1024; // 50MB limit for readFileSync
    
    let raw = "";
    if (stats.size > maxSize) {
      // If file is too large, we read the last 50MB
      const fd = fs.openSync(file, 'r');
      const buffer = Buffer.alloc(maxSize);
      fs.readSync(fd, buffer, 0, maxSize, stats.size - maxSize);
      fs.closeSync(fd);
      raw = buffer.toString('utf8');
      // Skip the first partial line
      const firstNewline = raw.indexOf('\n');
      if (firstNewline !== -1) raw = raw.substring(firstNewline + 1);
    } else {
      raw = fs.readFileSync(file, 'utf8');
    }

    const lines = raw.split(/\r?\n/).filter(Boolean);
    // Limit to last 10,000 bars for optimization to keep memory usage low
    const targetLines = lines.slice(-10000);
    
    for (const ln of targetLines) {
      try { out.push(JSON.parse(ln)); } catch (_) {}
    }
  } catch (e) {
    console.error(`Error reading JSONL ${file}:`, e);
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

  // Realistic factors
  const slippageTicks = Number(cfg.backtest?.slippageTicks ?? 1);
  const commissionTicks = Number(cfg.backtest?.commissionTicks ?? 0.5);

  const trailing = tt.trailing || {};
  const trailEnabled = Boolean(trailing.enabled);
  const activateAfterTicks = Number(trailing.activateAfterTicks ?? 12);
  const trailTicks = Number(trailing.trailTicks ?? 10);

  const breakEven = cfg.targets?.breakEven || {};
  const beEnabled = Boolean(breakEven.enabled);
  const beBufferTicks = Number(breakEven.bufferTicks ?? 1);

  const isBuy = side === 'BUY';
  
  // Apply slippage to entry
  const actualEntry = isBuy ? entryPrice + slippageTicks * tickSize : entryPrice - slippageTicks * tickSize;

  let sl = isBuy ? actualEntry - stopTicks * tickSize : actualEntry + stopTicks * tickSize;
  let tp1 = isBuy ? actualEntry + tp1Ticks * tickSize : actualEntry - tp1Ticks * tickSize;

  let realizedTicks = 0;
  let mfe = 0, mae = 0;
  let dynStop = sl;
  let trailingActive = false;
  let peak = actualEntry;

  for (let k = iEntry + 1; k < bars.length; k++) {
    const b = bars[k];
    const hi = Number(b.h ?? b.high ?? b.c);
    const lo = Number(b.l ?? b.low ?? b.c);
    const cl = Number(b.c ?? b.close);

    const favorable = isBuy ? (hi - actualEntry) : (actualEntry - lo);
    const adverse = isBuy ? (actualEntry - lo) : (hi - actualEntry);
    mfe = Math.max(mfe, Math.round(favorable / tickSize));
    mae = Math.max(mae, Math.round(adverse / tickSize));

    if (isBuy) peak = Math.max(peak, hi);
    else peak = Math.min(peak, lo);

    if (trailEnabled) {
      const movedTicks = isBuy ? Math.round((peak - actualEntry) / tickSize) : Math.round((actualEntry - peak) / tickSize);
      if (!trailingActive && movedTicks >= activateAfterTicks) trailingActive = true;
      
      if (trailingActive) {
        const newStop = isBuy ? peak - trailTicks * tickSize : peak + trailTicks * tickSize;
        if (isBuy) dynStop = Math.max(dynStop, newStop);
        else dynStop = Math.min(dynStop, newStop);
      }
    }

    if (beEnabled && !trailingActive) {
      const trigger = isBuy ? actualEntry + (tp1Ticks * 0.5) * tickSize : actualEntry - (tp1Ticks * 0.5) * tickSize;
      if (isBuy && hi >= trigger) dynStop = Math.max(dynStop, actualEntry + beBufferTicks * tickSize);
      if (!isBuy && lo <= trigger) dynStop = Math.min(dynStop, actualEntry - beBufferTicks * tickSize);
    }

    // Check TP
    if (isBuy && hi >= tp1) {
      const exit = tp1 - slippageTicks * tickSize;
      const ticks = Math.round((exit - actualEntry) / tickSize) - commissionTicks;
      return { exitIndex: k, exitPrice: exit, realizedTicks: ticks, maeTicks: mae, mfeTicks: mfe, reason: 'TP' };
    }
    if (!isBuy && lo <= tp1) {
      const exit = tp1 + slippageTicks * tickSize;
      const ticks = Math.round((actualEntry - exit) / tickSize) - commissionTicks;
      return { exitIndex: k, exitPrice: exit, realizedTicks: ticks, maeTicks: mae, mfeTicks: mfe, reason: 'TP' };
    }

    // Check SL / Trailing Stop
    if (isBuy && lo <= dynStop) {
      const exit = dynStop - slippageTicks * tickSize;
      const ticks = Math.round((exit - actualEntry) / tickSize) - commissionTicks;
      return { exitIndex: k, exitPrice: exit, realizedTicks: ticks, maeTicks: mae, mfeTicks: mfe, reason: trailingActive ? 'TSL' : 'SL' };
    }
    if (!isBuy && hi >= dynStop) {
      const exit = dynStop + slippageTicks * tickSize;
      const ticks = Math.round((actualEntry - exit) / tickSize) - commissionTicks;
      return { exitIndex: k, exitPrice: exit, realizedTicks: ticks, maeTicks: mae, mfeTicks: mfe, reason: trailingActive ? 'TSL' : 'SL' };
    }

    // End of data
    if (k === bars.length - 1) {
      const exit = cl;
      const ticks = isBuy ? Math.round((exit - actualEntry) / tickSize) : Math.round((actualEntry - exit) / tickSize);
      return { exitIndex: k, exitPrice: exit, realizedTicks: ticks - commissionTicks, maeTicks: mae, mfeTicks: mfe, reason: 'EOD' };
    }
  }

  return { exitIndex: iEntry, exitPrice: actualEntry, realizedTicks: 0, maeTicks: 0, mfeTicks: 0, reason: 'ERROR' };
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

    // Cooldown check for backtest
    if (trades.length > 0) {
      const lastTrade = trades[trades.length - 1];
      const cooldownMs = (cfg.strategy?.tradeCooldown || 10) * 1000;
      const currentTime = Number(b.t || Date.now());
      const lastTime = lastTrade.time;
      
      // Normalize to ms for comparison
      const currentMs = currentTime < 10000000000 ? currentTime * 1000 : currentTime;
      const lastMs = lastTime < 10000000000 ? lastTime * 1000 : lastTime;

      if (currentMs - lastMs < cooldownMs) {
        equityCurve.push(equityTicks);
        continue;
      }
    }

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
      score: s.score,
      time: Number(b.t || Date.now())
    });

    i = sim.exitIndex;
  }

  const hourlyStats: Record<number, { netTicks: number, trades: number }> = {};
  for (let h = 0; h < 24; h++) hourlyStats[h] = { netTicks: 0, trades: 0 };

  for (const t of trades) {
    // FarazGold often uses seconds. If timestamp is too small, assume seconds.
    const timestamp = t.time < 10000000000 ? t.time * 1000 : t.time;
    const hour = new Date(timestamp).getHours();
    hourlyStats[hour].netTicks += t.pnlTicks;
    hourlyStats[hour].trades += 1;
  }

  const grossWin = trades.filter(t => t.pnlTicks > 0).reduce((a,b)=>a+b.pnlTicks,0);
  const grossLoss = Math.abs(trades.filter(t => t.pnlTicks < 0).reduce((a,b)=>a+b.pnlTicks,0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
  const winRate = trades.length ? (trades.filter(t=>t.pnlTicks>0).length / trades.length) : 0;
  const avg = trades.length ? (trades.reduce((a,b)=>a+b.pnlTicks,0)/trades.length) : 0;
  const maxWin = trades.length ? Math.max(...trades.map(t => t.pnlTicks)) : 0;

  return {
    trades,
    metrics: {
      trades: trades.length,
      netTicks: equityTicks,
      winRate,
      profitFactor: pf,
      avgTicks: avg,
      maxWinTicks: maxWin,
      maxDrawdownTicks: maxDrawdown(equityCurve),
      hourlyStats
    }
  };
}
