import fs from 'fs';
import path from 'path';
import { readJsonl, runBacktest } from './backtest';
import { config as baseConfig } from './config';

function deepClone(x: any){ return JSON.parse(JSON.stringify(x)); }

export function deepMerge(target: any, patch: any) {
  for (const [k,v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

function clamp(n: number, a: number, b: number){ return Math.max(a, Math.min(b, n)); }

function randInt(a: number, b: number){ return Math.floor(Math.random()*(b-a+1))+a; }

function propose(base: any) {
  const cfg = deepClone(base);

  const emaFast = cfg.strategy?.indicators?.ema?.fast ?? 8;
  const emaSlow = cfg.strategy?.indicators?.ema?.slow ?? 21;
  const rsiP = cfg.strategy?.indicators?.rsi?.period ?? 9;

  cfg.strategy.indicators.ema.fast = clamp(randInt(emaFast-3, emaFast+3), 3, 30);
  cfg.strategy.indicators.ema.slow = clamp(randInt(emaSlow-6, emaSlow+8), 8, 80);
  if (cfg.strategy.indicators.ema.slow <= cfg.strategy.indicators.ema.fast + 2) {
    cfg.strategy.indicators.ema.slow = cfg.strategy.indicators.ema.fast + 5;
  }

  cfg.strategy.indicators.rsi.period = clamp(randInt(rsiP-4, rsiP+6), 5, 30);
  cfg.strategy.indicators.rsi.oversold = clamp(randInt((cfg.strategy.indicators.rsi.oversold ?? 35)-5, (cfg.strategy.indicators.rsi.oversold ?? 35)+5), 15, 45);
  cfg.strategy.indicators.rsi.overbought = clamp(randInt((cfg.strategy.indicators.rsi.overbought ?? 65)-5, (cfg.strategy.indicators.rsi.overbought ?? 65)+5), 55, 85);

  cfg.targetsTicks.stopTicks = clamp(randInt((cfg.targetsTicks.stopTicks ?? 12)-4, (cfg.targetsTicks.stopTicks ?? 12)+6), 6, 40);
  cfg.targetsTicks.tpTicks = clamp(randInt((cfg.targetsTicks.tpTicks ?? 18)-6, (cfg.targetsTicks.tpTicks ?? 18)+10), 8, 80);

  cfg.targetsTicks.trailing.activateAfterTicks = clamp(randInt((cfg.targetsTicks.trailing.activateAfterTicks ?? 12)-4, (cfg.targetsTicks.trailing.activateAfterTicks ?? 12)+8), 4, 80);
  cfg.targetsTicks.trailing.trailTicks = clamp(randInt((cfg.targetsTicks.trailing.trailTicks ?? 10)-4, (cfg.targetsTicks.trailing.trailTicks ?? 10)+8), 4, 80);

  cfg.strategy.minSignalScore = clamp(randInt((cfg.strategy.minSignalScore ?? 1), (cfg.strategy.minSignalScore ?? 1)+2), 1, 5);

  if (cfg.filters) {
    const minAtr = Number(cfg.filters.minAtrPercent ?? 0.01);
    const step = 0.01;
    const choice = (Math.random() < 0.5) ? minAtr : (minAtr + step);
    cfg.filters.minAtrPercent = clamp(choice, 0, 1);
  }

  return cfg;
}

function score(metrics: any) {
  const t = metrics.trades;
  if (t < 20) return -1e9;
  const net = metrics.netTicks;
  const dd = metrics.maxDrawdownTicks || 0;
  const pf = metrics.profitFactor || 0;
  const wr = metrics.winRate || 0;

  return net - 0.75 * dd + 50 * (pf - 1) + 10 * (wr - 0.5);
}

function walkForward(cfg: any, bars: any[], splits: any[]) {
  const n = bars.length;
  const results: any[] = [];
  for (const sp of splits) {
    const a = Math.floor(n * sp.trainStart);
    const b = Math.floor(n * sp.trainEnd);
    const c = Math.floor(n * sp.testEnd);
    const trainBars = bars.slice(a, b);
    const testBars  = bars.slice(b, c);

    const train = runBacktest(cfg, trainBars).metrics;
    const test  = runBacktest(cfg, testBars).metrics;

    results.push({ train, test });
  }
  const agg = results.reduce((acc,r)=>{
    acc.trades += r.test.trades;
    acc.netTicks += r.test.netTicks;
    acc.maxDrawdownTicks = Math.max(acc.maxDrawdownTicks, r.test.maxDrawdownTicks);
    acc.profitFactor += r.test.profitFactor;
    acc.winRate += r.test.winRate;
    return acc;
  }, { trades:0, netTicks:0, maxDrawdownTicks:0, profitFactor:0, winRate:0 });

  if (results.length) {
    agg.profitFactor /= results.length;
    agg.winRate /= results.length;
  }
  return { agg, results };
}

function pickSplits() {
  return [
    { trainStart: 0.00, trainEnd: 0.60, testEnd: 0.75 },
    { trainStart: 0.10, trainEnd: 0.70, testEnd: 0.85 },
    { trainStart: 0.20, trainEnd: 0.80, testEnd: 1.00 },
  ];
}

function toPatch(bestCfg: any) {
  return {
    strategy: {
      indicators: {
        ema: { fast: bestCfg.strategy.indicators.ema.fast, slow: bestCfg.strategy.indicators.ema.slow },
        rsi: {
          period: bestCfg.strategy.indicators.rsi.period,
          oversold: bestCfg.strategy.indicators.rsi.oversold,
          overbought: bestCfg.strategy.indicators.rsi.overbought
        }
      },
      minSignalScore: bestCfg.strategy.minSignalScore
    },
    targetsTicks: {
      stopTicks: bestCfg.targetsTicks.stopTicks,
      tpTicks: bestCfg.targetsTicks.tpTicks,
      trailing: {
        activateAfterTicks: bestCfg.targetsTicks.trailing.activateAfterTicks,
        trailTicks: bestCfg.targetsTicks.trailing.trailTicks
      }
    },
    filters: { minAtrPercent: bestCfg.filters?.minAtrPercent }
  };
}

export async function runOptimization(inFile: string, outFile: string, iters: number = 80) {
  const bars = readJsonl(inFile);
  if (bars.length < 300) {
    throw new Error(`Not enough data in ${inFile}. Need at least ~300 bars. Have ${bars.length}.`);
  }

  const base = deepClone(baseConfig);
  const splits = pickSplits();

  let bestCfg = base;
  let bestScore = -1e18;
  let bestAgg = null;

  {
    const wf = walkForward(base, bars, splits);
    const sc = score(wf.agg);
    bestScore = sc;
    bestAgg = wf.agg;
  }

  for (let n=0;n<iters;n++) {
    const cand = propose(base);
    const wf = walkForward(cand, bars, splits);
    const sc = score(wf.agg);
    if (sc > bestScore) {
      bestScore = sc;
      bestCfg = cand;
      bestAgg = wf.agg;
    }
  }

  const patch = toPatch(bestCfg);
  const payload = {
    generatedAt: new Date().toISOString(),
    objectiveScore: bestScore,
    metrics: bestAgg,
    patch,
    full: {
      strategy: bestCfg.strategy,
      targetsTicks: bestCfg.targetsTicks,
      filters: bestCfg.filters
    }
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  return payload;
}
