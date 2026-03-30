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
  const activeStrategy = cfg.activeStrategy || 'SCALP';

  // Common parameters
  cfg.targetsTicks.stopTicks = clamp(randInt((cfg.targetsTicks.stopTicks ?? 12)-4, (cfg.targetsTicks.stopTicks ?? 12)+6), 6, 40);
  cfg.targetsTicks.tpTicks = clamp(randInt((cfg.targetsTicks.tpTicks ?? 18)-6, (cfg.targetsTicks.tpTicks ?? 18)+10), 8, 80);

  cfg.targetsTicks.trailing.activateAfterTicks = clamp(randInt((cfg.targetsTicks.trailing.activateAfterTicks ?? 12)-4, (cfg.targetsTicks.trailing.activateAfterTicks ?? 12)+8), 4, 80);
  cfg.targetsTicks.trailing.trailTicks = clamp(randInt((cfg.targetsTicks.trailing.trailTicks ?? 10)-4, (cfg.targetsTicks.trailing.trailTicks ?? 10)+8), 4, 80);

  cfg.strategy.minSignalScore = clamp(randInt((cfg.strategy.minSignalScore ?? 1), (cfg.strategy.minSignalScore ?? 1)+2), 1, 5);

  if (activeStrategy === 'HST') {
    const hst = cfg.strategy.hst || { hmaLength: 55, stPeriod: 10, stMultiplier: 3 };
    hst.hmaLength = clamp(randInt(hst.hmaLength - 10, hst.hmaLength + 10), 10, 200);
    hst.stPeriod = clamp(randInt(hst.stPeriod - 3, hst.stPeriod + 3), 5, 50);
    hst.stMultiplier = clamp(Number((hst.stMultiplier + (Math.random() * 1 - 0.5)).toFixed(1)), 1, 10);
    cfg.strategy.hst = hst;
  } else if (activeStrategy === 'QUANT') {
    const quant = cfg.strategy.quant || { maFast: 50, maSlow: 200, swingLength: 5, patternTolerancePct: 0.05 };
    quant.maFast = clamp(randInt(quant.maFast - 10, quant.maFast + 10), 10, 100);
    quant.maSlow = clamp(randInt(quant.maSlow - 20, quant.maSlow + 20), 50, 500);
    quant.swingLength = clamp(randInt(quant.swingLength - 2, quant.swingLength + 2), 2, 10);
    quant.patternTolerancePct = clamp(Number((quant.patternTolerancePct + (Math.random() * 0.04 - 0.02)).toFixed(3)), 0.01, 0.5);
    cfg.strategy.quant = quant;
  } else if (activeStrategy === 'TREND') {
    const trend = cfg.strategy.trend || { maFast: 20, maSlow: 50, macdFast: 12, macdSlow: 26, macdSignal: 9 };
    trend.maFast = clamp(randInt(trend.maFast - 5, trend.maFast + 5), 5, 50);
    trend.maSlow = clamp(randInt(trend.maSlow - 10, trend.maSlow + 10), 20, 200);
    trend.macdFast = clamp(randInt(trend.macdFast - 3, trend.macdFast + 3), 5, 30);
    trend.macdSlow = clamp(randInt(trend.macdSlow - 5, trend.macdSlow + 5), 15, 60);
    cfg.strategy.trend = trend;
  } else if (activeStrategy === 'HMAMACD') {
    const hmamacd = cfg.strategy.hmamacd || { hmaFast: 9, hmaSlow: 21, macdFast: 12, macdSlow: 26, macdSignal: 9 };
    hmamacd.hmaFast = clamp(randInt(hmamacd.hmaFast - 3, hmamacd.hmaFast + 3), 3, 30);
    hmamacd.hmaSlow = clamp(randInt(hmamacd.hmaSlow - 6, hmamacd.hmaSlow + 8), 8, 80);
    hmamacd.macdFast = clamp(randInt(hmamacd.macdFast - 3, hmamacd.macdFast + 3), 5, 30);
    hmamacd.macdSlow = clamp(randInt(hmamacd.macdSlow - 5, hmamacd.macdSlow + 5), 15, 60);
    cfg.strategy.hmamacd = hmamacd;
  } else {
    if (!cfg.strategy.indicators) cfg.strategy.indicators = {};
    if (!cfg.strategy.indicators.ema) cfg.strategy.indicators.ema = { fast: 8, slow: 21 };
    if (!cfg.strategy.indicators.rsi) cfg.strategy.indicators.rsi = { period: 9, oversold: 35, overbought: 65 };

    const emaFast = cfg.strategy.indicators.ema.fast;
    const emaSlow = cfg.strategy.indicators.ema.slow;
    const rsiP = cfg.strategy.indicators.rsi.period;

    cfg.strategy.indicators.ema.fast = clamp(randInt(emaFast-3, emaFast+3), 3, 30);
    cfg.strategy.indicators.ema.slow = clamp(randInt(emaSlow-6, emaSlow+8), 8, 80);
    if (cfg.strategy.indicators.ema.slow <= cfg.strategy.indicators.ema.fast + 2) {
      cfg.strategy.indicators.ema.slow = cfg.strategy.indicators.ema.fast + 5;
    }

    cfg.strategy.indicators.rsi.period = clamp(randInt(rsiP-4, rsiP+6), 5, 30);
    cfg.strategy.indicators.rsi.oversold = clamp(randInt((cfg.strategy.indicators.rsi.oversold ?? 35)-5, (cfg.strategy.indicators.rsi.oversold ?? 35)+5), 15, 45);
    cfg.strategy.indicators.rsi.overbought = clamp(randInt((cfg.strategy.indicators.rsi.overbought ?? 65)-5, (cfg.strategy.indicators.rsi.overbought ?? 65)+5), 55, 85);
  }

  if (cfg.filters) {
    const minAtr = Number(cfg.filters.minAtrPercent ?? 0.01);
    const step = 0.01;
    const choice = (Math.random() < 0.5) ? minAtr : (minAtr + step);
    cfg.filters.minAtrPercent = clamp(choice, 0, 1);
  }

  return cfg;
}

function score(metrics: any, maximizeBigWins: boolean = false) {
  const t = metrics.trades;
  if (t < 10) return -1e12; // Need at least some trades
  
  const net = metrics.netTicks;
  const dd = metrics.maxDrawdownTicks || 1;
  const pf = metrics.profitFactor || 0;
  const wr = metrics.winRate || 0;
  const maxWin = metrics.maxWinTicks || 0;
  const avg = metrics.avgTicks || 0;

  // Scoring formula:
  // 1. Net profit is king
  // 2. Penalize drawdown heavily
  // 3. Reward high Profit Factor
  // 4. Reward "Big Wins" (maxWin)
  // 5. Reward high average profit per trade
  // 6. Win rate is secondary but should be > 40%
  
  let s = net * 1.0;
  s -= dd * 2.0; // Heavy drawdown penalty
  s += pf * 100; // Reward efficiency
  
  if (maximizeBigWins) {
    s += maxWin * 10.0; // Heavy reward for big wins (user request)
    s += avg * 100; // Reward quality even more
  } else {
    s += maxWin * 2.0; // Standard reward for big wins
    s += avg * 50; // Standard reward for quality
  }
  
  if (wr < 0.4) s -= 500; // Penalty for low win rate
  if (t > 50) s += 100; // Reward consistency
  
  return s;
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
  const patch: any = {
    strategy: {
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

  if (bestCfg.activeStrategy === 'HST') {
    patch.strategy.hst = bestCfg.strategy.hst;
  } else if (bestCfg.activeStrategy === 'QUANT') {
    patch.strategy.quant = bestCfg.strategy.quant;
  } else if (bestCfg.activeStrategy === 'TREND') {
    patch.strategy.trend = bestCfg.strategy.trend;
  } else if (bestCfg.activeStrategy === 'HMAMACD') {
    patch.strategy.hmamacd = bestCfg.strategy.hmamacd;
  } else {
    patch.strategy.indicators = {
      ema: { fast: bestCfg.strategy.indicators.ema.fast, slow: bestCfg.strategy.indicators.ema.slow },
      rsi: {
        period: bestCfg.strategy.indicators.rsi.period,
        oversold: bestCfg.strategy.indicators.rsi.oversold,
        overbought: bestCfg.strategy.indicators.rsi.overbought
      }
    };
  }
  
  return patch;
}

export async function runOptimization(inFile: string, outFile: string, iters: number = 80) {
  const bars = readJsonl(inFile);
  if (bars.length < 300) {
    throw new Error(`Not enough data in ${inFile}. Need at least ~300 bars. Have ${bars.length}.`);
  }

  const strategies = ['SCALP', 'HST', 'QUANT', 'TREND', 'HMAMACD'];
  const splits = pickSplits();
  const maximizeBigWins = !!baseConfig.autoTune?.maximizeBigWins;
  
  let absoluteBestCfg = null;
  let absoluteBestScore = -1e18;
  let absoluteBestAgg = null;
  let bestStrategyName = '';

  for (const strat of strategies) {
    const base = deepClone(baseConfig);
    base.activeStrategy = strat;
    
    let currentBestCfg = base;
    let currentBestScore = -1e18;
    let currentBestAgg = null;

    // Initial evaluation
    {
      const wf = walkForward(base, bars, splits);
      currentBestScore = score(wf.agg, maximizeBigWins);
      currentBestAgg = wf.agg;
    }

    // Optimize this strategy
    const stratIters = Math.floor(iters / strategies.length);
    for (let n=0; n < stratIters; n++) {
      const cand = propose(currentBestCfg);
      const wf = walkForward(cand, bars, splits);
      const sc = score(wf.agg, maximizeBigWins);
      if (sc > currentBestScore) {
        currentBestScore = sc;
        currentBestCfg = cand;
        currentBestAgg = wf.agg;
      }
    }

    if (currentBestScore > absoluteBestScore) {
      absoluteBestScore = currentBestScore;
      absoluteBestCfg = currentBestCfg;
      absoluteBestAgg = currentBestAgg;
      bestStrategyName = strat;
    }
  }

  if (!absoluteBestCfg) throw new Error("Optimization failed to find a valid configuration.");

  const patch = toPatch(absoluteBestCfg);
  patch.activeStrategy = bestStrategyName;

  // Hourly Analysis on the best config
  const fullBacktest = runBacktest(absoluteBestCfg, bars);
  const hourlyStats = fullBacktest.metrics.hourlyStats;
  const bestHours = Object.entries(hourlyStats)
    .map(([h, s]: [any, any]) => ({ hour: parseInt(h), ...s }))
    .sort((a, b) => b.netTicks - a.netTicks)
    .slice(0, 5);

  const payload = {
    generatedAt: new Date().toISOString(),
    objectiveScore: absoluteBestScore,
    bestStrategy: bestStrategyName,
    bestHours,
    metrics: absoluteBestAgg,
    patch,
    full: {
      activeStrategy: bestStrategyName,
      strategy: absoluteBestCfg.strategy,
      targetsTicks: absoluteBestCfg.targetsTicks,
      filters: absoluteBestCfg.filters
    }
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  return payload;
}
