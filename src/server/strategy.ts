export class Strategy {
  config: any;
  lastSignalTime: number = 0;
  lastSignalType: string | null = null;
  lastSameSideSignalTime: number = 0;
  indicators: any = {};
  signals: any[] = [];
  minSignalScore: number;
  cooldown: number;
  tickHistory: { price: number, time: number }[] = [];
  roundNumberHit: { price: number, time: number } | null = null;

  constructor(config: any) {
    this.config = config;
    this.minSignalScore = config.strategy?.minSignalScore || 1;
    this.cooldown = (config.strategy?.tradeCooldown || 10) * 1000;
  }

  analyze(priceHistory: any[], openPositionsCount: number, currentPrice: number, dryRun: boolean = false) {
    if (!Array.isArray(priceHistory) || priceHistory.length < 50) {
      return { signal: null, reason: `Waiting for data... (${priceHistory?.length || 0}/50)` };
    }

    const now = Date.now();

    if (!dryRun && now - this.lastSignalTime < this.cooldown) {
      return { signal: null, reason: 'Cooldown active' };
    }

    if (!dryRun && openPositionsCount >= (this.config.strategy?.filters?.maxPositions ?? 999)) {
      return { signal: null, reason: 'Max positions reached' };
    }

    const maxTradesPer10Min = this.config.strategy?.filters?.maxTradesPer10Min || 0;
    if (!dryRun && maxTradesPer10Min > 0) {
      const tenMinsAgo = now - 10 * 60 * 1000;
      const recentSignals = this.signals.filter(s => s.timestamp > tenMinsAgo);
      if (recentSignals.length >= maxTradesPer10Min) {
        return { signal: null, reason: `Max trades (${maxTradesPer10Min}) per 10m reached` };
      }
    }

    const activeStrategy = this.config.activeStrategy || 'SCALP';
    let result: any = null;

    // Always calculate indicators for dashboard/UI
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.price);
    const volumes = priceHistory.map(p => p.volume ?? 0);
    this.calculateIndicators(closes, highs, lows, volumes);
    
    // Detect regime for all strategies
    this.indicators.regime = this.detectMarketRegime(highs, lows, closes);

    // Update tick history for numerical strategy
    if (!dryRun) {
      this.tickHistory.push({ price: currentPrice, time: now });
      this.tickHistory = this.tickHistory.filter(t => now - t.time <= 10000); // Keep last 10s
    }

    if (activeStrategy === 'SCALP') {
      result = this.analyzeScalp(priceHistory, currentPrice);
    } else if (activeStrategy === 'QUANT') {
      result = this.analyzeQuant(priceHistory, currentPrice);
    } else if (activeStrategy === 'TREND') {
      result = this.analyzeTrend(priceHistory, currentPrice);
    } else if (activeStrategy === 'FAST') {
      result = this.analyzeFast(priceHistory, currentPrice);
    } else if (activeStrategy === 'NUMERICAL') {
      result = this.analyzeNumerical(currentPrice);
    } else if (activeStrategy === 'HST') {
      result = this.analyzeHST(priceHistory, currentPrice);
    }

    if (result?.signal && !dryRun) {
      const anti = this.config.strategy?.antiSpam || {};
      if (anti.enabled && this.lastSignalType === result.signal.type) {
        const minMs = (anti.minMinutesBetweenSameSideSignals || 2) * 60 * 1000;
        if (now - this.lastSameSideSignalTime < minMs) {
          return { signal: null, reason: 'Anti-spam active' };
        }
      }

      this.lastSignalTime = now;
      if (this.lastSignalType === result.signal.type) this.lastSameSideSignalTime = now;
      this.lastSignalType = result.signal.type;

      this.signals.push({ ...result.signal, timestamp: now });
      if (this.signals.length > 80) this.signals.shift();
    }

    return result || { signal: null, reason: 'No signal' };
  }

  // ==========================================
  // 1. SCALP STRATEGY (EMA + RSI)
  // ==========================================
  analyzeScalp(priceHistory: any[], currentPrice: number) {
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.price);
    const volumes = priceHistory.map(p => p.volume ?? 0);
    const price = currentPrice || closes[closes.length - 1];

    this.calculateIndicators(closes, highs, lows, volumes);

    const ind = this.indicators;
    const cfg = this.config.strategy?.indicators || this.config.strategy || {};

    if (!ind.rsi || !ind.emaFast || !ind.emaSlow) return { signal: null, reason: 'Indicators not ready' };

    const rsi = ind.rsi;
    const emaFast = ind.emaFast;
    const emaSlow = ind.emaSlow;
    const atr = ind.atr || price * 0.002;

    const atrPercent = (atr / price) * 100;
    const minAtrPercent = Number(this.config.strategy?.filters?.minAtrPercent ?? 0.005);
    if (atrPercent < minAtrPercent) return { signal: null, reason: 'Low volatility' };

    let score = 0;
    let reasons: string[] = [];
    let type: 'BUY' | 'SELL' | null = null;

    const trendUp = emaFast > emaSlow;
    const trendDown = emaFast < emaSlow;

    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2] || lastClose;

    const momentumUp = lastClose > prevClose;
    const momentumDown = lastClose < prevClose;

    const entryCfg = (this.config.strategy?.entry || {});
    const maxDistPct = Number(entryCfg.maxDistanceFromSlowEmaPercent ?? 0.08);
    const maxDist = (maxDistPct / 100);

    // Stricter distance check from slow EMA to avoid buying at the top or selling at the bottom
    const distToSlowEma = Math.abs(price - emaSlow) / emaSlow;
    const nearSlowForBuy = distToSlowEma <= maxDist;
    const nearSlowForSell = distToSlowEma <= maxDist;

    // Require stronger RSI levels for entry
    const rsiOversold = cfg.rsi?.oversold || 40; // Stricter than 45
    const rsiOverbought = cfg.rsi?.overbought || 60; // Stricter than 55

    if (trendUp && nearSlowForBuy) {
      if (rsi <= rsiOversold) {
        type = 'BUY';
        score += 2;
        reasons.push(`RSI Pullback (${rsi.toFixed(1)})`);
      }
      // Require strong momentum and RSI not overbought
      if (!type && rsi < 55 && momentumUp && price >= emaFast && closes[closes.length - 2] < emaFast) {
        type = 'BUY';
        score += 1;
        reasons.push('Momentum Reversal (Crossed Fast EMA)');
      }
      // Strong EMA cross confirmation
      if (!type && emaFast > emaSlow && closes[closes.length - 2] <= emaSlow && rsi > 40 && rsi < 60) {
        type = 'BUY';
        score += 1;
        reasons.push('EMA Cross Up Confirmation');
      }
      if (type) {
        reasons.push('Trend Up (EMA Fast > Slow)');
        if (momentumUp) { score += 1; reasons.push('Green Candle'); }
      }
    } else if (trendDown && nearSlowForSell) {
      if (rsi >= rsiOverbought) {
        type = 'SELL';
        score += 2;
        reasons.push(`RSI Pullback (${rsi.toFixed(1)})`);
      }
      // Require strong momentum and RSI not oversold
      if (!type && rsi > 45 && momentumDown && price <= emaFast && closes[closes.length - 2] > emaFast) {
        type = 'SELL';
        score += 1;
        reasons.push('Momentum Reversal (Crossed Fast EMA)');
      }
      // Strong EMA cross confirmation
      if (!type && emaFast < emaSlow && closes[closes.length - 2] >= emaSlow && rsi > 40 && rsi < 60) {
        type = 'SELL';
        score += 1;
        reasons.push('EMA Cross Down Confirmation');
      }
      if (type) {
        reasons.push('Trend Down (EMA Fast < Slow)');
        if (momentumDown) { score += 1; reasons.push('Red Candle'); }
      }
    }

    if (!type || score < this.minSignalScore) return { signal: null, reason: 'Score too low' };

    return { signal: this.createSignal(type, price, score, reasons, atr, 'SCALP'), reason: 'Signal OK' };
  }

  // ==========================================
  // 2. QUANT STRATEGY (Price Action & Patterns)
  // ==========================================
  analyzeQuant(priceHistory: any[], currentPrice: number) {
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.price);
    const price = currentPrice || closes[closes.length - 1];

    const qCfg = this.config.strategy?.quant || { maFast: 50, maSlow: 200, swingLength: 5, patternTolerancePct: 0.1 };
    
    const ma50 = this.calculateSMA(closes, qCfg.maFast || 50);
    const ma200 = this.calculateSMA(closes, qCfg.maSlow || 200);
    
    if (!ma50 || !ma200) return { signal: null, reason: 'MAs not ready' };

    const trendUp = ma50 > ma200;
    const trendDown = ma50 < ma200;
    
    // Find Swings
    const swings = this.findSwings(highs, lows, qCfg.swingLength || 3); // Reduced swing length for more signals
    if (swings.highs.length < 2 || swings.lows.length < 2) return { signal: null, reason: 'Not enough swings' };

    let type: 'BUY' | 'SELL' | null = null;
    let reasons: string[] = [];
    let score = 0;
    let patternName = '';
    let sl = 0;
    let tp = 0;

    const tol = (qCfg.patternTolerancePct || 0.1) / 100; // Increased tolerance
    const rr = qCfg.riskRewardRatio || 2;

    // Double Bottom (W) - Buy Pattern
    if (trendUp) {
      const lastLow1 = swings.lows[swings.lows.length - 1];
      const lastLow2 = swings.lows[swings.lows.length - 2];
      const midHigh = swings.highs[swings.highs.length - 1];

      if (lastLow1 && lastLow2 && midHigh && lastLow1.index > lastLow2.index && midHigh.index > lastLow2.index && midHigh.index < lastLow1.index) {
        const diff = Math.abs(lastLow1.price - lastLow2.price) / lastLow2.price;
        if (diff <= tol) {
          // Breakout of neckline
          if (price > midHigh.price && closes[closes.length - 2] <= midHigh.price) {
            type = 'BUY';
            patternName = 'Double Bottom (W)';
            score = 3;
            reasons.push(patternName, 'MA50 > MA200');
            sl = Math.min(lastLow1.price, lastLow2.price) - (price * 0.001); // slightly below lows
            const risk = price - sl;
            tp = price + (risk * rr);
          }
        }
      }
    }

    // Double Top (M) - Sell Pattern
    if (trendDown && !type) {
      const lastHigh1 = swings.highs[swings.highs.length - 1];
      const lastHigh2 = swings.highs[swings.highs.length - 2];
      const midLow = swings.lows[swings.lows.length - 1];

      if (lastHigh1 && lastHigh2 && midLow && lastHigh1.index > lastHigh2.index && midLow.index > lastHigh2.index && midLow.index < lastHigh1.index) {
        const diff = Math.abs(lastHigh1.price - lastHigh2.price) / lastHigh2.price;
        if (diff <= tol) {
          // Breakout of neckline
          if (price < midLow.price && closes[closes.length - 2] >= midLow.price) {
            type = 'SELL';
            patternName = 'Double Top (M)';
            score = 3;
            reasons.push(patternName, 'MA50 < MA200');
            sl = Math.max(lastHigh1.price, lastHigh2.price) + (price * 0.001); // slightly above highs
            const risk = sl - price;
            tp = price - (risk * rr);
          }
        }
      }
    }

    // Rectangle Breakout
    if (!type) {
      const recentHighs = swings.highs.slice(-3);
      const recentLows = swings.lows.slice(-3);
      if (recentHighs.length === 3 && recentLows.length === 3) {
        const maxH = Math.max(...recentHighs.map(h => h.price));
        const minH = Math.min(...recentHighs.map(h => h.price));
        const maxL = Math.max(...recentLows.map(l => l.price));
        const minL = Math.min(...recentLows.map(l => l.price));

        const isRange = (maxH - minH)/minH <= tol && (maxL - minL)/minL <= tol;
        if (isRange) {
          const rangeHeight = maxH - minL;
          if (trendUp && price > maxH && closes[closes.length - 2] <= maxH) {
            type = 'BUY';
            patternName = 'Rectangle Breakout (Bullish)';
            score = 2;
            reasons.push(patternName, 'MA50 > MA200');
            sl = minL;
            tp = price + (rangeHeight * rr);
          } else if (trendDown && price < minL && closes[closes.length - 2] >= minL) {
            type = 'SELL';
            patternName = 'Rectangle Breakout (Bearish)';
            score = 2;
            reasons.push(patternName, 'MA50 < MA200');
            sl = maxH;
            tp = price - (rangeHeight * rr);
          }
        }
      }
    }

    if (!type) return { signal: null, reason: 'No pattern detected' };

    // Secondary confirmation (RSI)
    const rsi = this.calculateRSI(closes, 14);
    if (type === 'BUY' && rsi > 50) score += 1;
    if (type === 'SELL' && rsi < 50) score += 1;

    const signal = {
      type,
      entry: price,
      sl,
      tp1: tp,
      score,
      reasons,
      confidence: Math.min(100, 50 + (score * 10)),
      timestamp: Date.now(),
      pattern: patternName,
      strategy: 'QUANT',
      indicators: { ma50: ma50.toFixed(0), ma200: ma200.toFixed(0), rsi: rsi.toFixed(1) }
    };

    return { signal, reason: 'Pattern matched' };
  }

  // ==========================================
  // 3. TREND STRATEGY (MA Crossover + MACD)
  // ==========================================
  analyzeTrend(priceHistory: any[], currentPrice: number) {
    const closes = priceHistory.map(p => p.price);
    const price = currentPrice || closes[closes.length - 1];

    const tCfg = this.config.strategy?.trend || { maFast: 20, maSlow: 50, macdFast: 12, macdSlow: 26, macdSignal: 9 };
    
    const maFast = this.calculateSMA(closes, tCfg.maFast);
    const maSlow = this.calculateSMA(closes, tCfg.maSlow);
    
    const prevMaFast = this.calculateSMA(closes.slice(0, -1), tCfg.maFast);
    const prevMaSlow = this.calculateSMA(closes.slice(0, -1), tCfg.maSlow);

    if (!maFast || !maSlow || !prevMaFast || !prevMaSlow) return { signal: null, reason: 'MAs not ready' };

    let type: 'BUY' | 'SELL' | null = null;
    let reasons: string[] = [];
    let score = 0;

    // Crossover
    const crossUp = prevMaFast <= prevMaSlow && maFast > maSlow;
    const crossDown = prevMaFast >= prevMaSlow && maFast < maSlow;

    if (crossUp) {
      type = 'BUY';
      score += 2;
      reasons.push(`MA${tCfg.maFast} crossed above MA${tCfg.maSlow}`);
    } else if (crossDown) {
      type = 'SELL';
      score += 2;
      reasons.push(`MA${tCfg.maFast} crossed below MA${tCfg.maSlow}`);
    }

    if (!type) return { signal: null, reason: 'No crossover' };

    // MACD Confirmation
    const macd = this.calculateMACD(closes, tCfg.macdFast, tCfg.macdSlow, tCfg.macdSignal);
    if (macd) {
      if (type === 'BUY' && macd.histogram > 0) {
        score += 1;
        reasons.push('MACD Bullish');
      } else if (type === 'SELL' && macd.histogram < 0) {
        score += 1;
        reasons.push('MACD Bearish');
      }
    }

    if (score < this.minSignalScore) return { signal: null, reason: 'Score too low' };

    const atr = this.calculateATR(priceHistory.map(p=>p.high), priceHistory.map(p=>p.low), closes, 14);
    
    const slDist = atr * 2;
    const tpDist = atr * 4; // 1:2 RR

    const sl = type === 'BUY' ? price - slDist : price + slDist;
    const tp = type === 'BUY' ? price + tpDist : price - tpDist;

    const signal = {
      type,
      entry: price,
      sl,
      tp1: tp,
      score,
      reasons,
      confidence: Math.min(100, 50 + (score * 15)),
      timestamp: Date.now(),
      strategy: 'TREND',
      indicators: { maFast: maFast.toFixed(0), maSlow: maSlow.toFixed(0), macdHist: macd?.histogram?.toFixed(2) }
    };

    return { signal, reason: 'Trend signal OK' };
  }

  // ==========================================
  // 4. FAST STRATEGY (Short EMA + RSI + Momentum)
  // ==========================================
  analyzeFast(priceHistory: any[], currentPrice: number) {
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.price);
    const price = currentPrice || closes[closes.length - 1];

    // Very short periods for fast reaction
    const rsi = this.calculateRSI(closes, 7);
    const emaFast = this.calculateEMA(closes, 5);
    const emaSlow = this.calculateEMA(closes, 13);
    
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2] || lastClose;
    const momentum = lastClose - prevClose;

    let type: 'BUY' | 'SELL' | null = null;
    let reasons: string[] = [];
    let score = 0;

    // Aggressive Buy
    if (price > emaFast && emaFast > emaSlow) {
      if (rsi < 40 && momentum > 0) { // Stricter RSI
        type = 'BUY';
        score = 2;
        reasons.push('Fast EMA Cross', 'RSI Oversold Pullback');
      } else if (rsi < 55 && momentum > 0 && lastClose > emaFast && prevClose <= emaFast) { // Require cross
        type = 'BUY';
        score = 1;
        reasons.push('Fast Momentum Breakout');
      }
    } 
    // Aggressive Sell
    else if (price < emaFast && emaFast < emaSlow) {
      if (rsi > 60 && momentum < 0) { // Stricter RSI
        type = 'SELL';
        score = 2;
        reasons.push('Fast EMA Cross', 'RSI Overbought Pullback');
      } else if (rsi > 45 && momentum < 0 && lastClose < emaFast && prevClose >= emaFast) { // Require cross
        type = 'SELL';
        score = 1;
        reasons.push('Fast Momentum Breakout');
      }
    }

    if (!type || score < 2) return { signal: null, reason: 'No fast signal (Score < 2)' }; // Require higher score for FAST

    const atr = this.calculateATR(highs, lows, closes, 7);
    const signal = this.createSignal(type, price, score, reasons, atr, 'FAST');
    
    return { signal, reason: 'Fast signal OK' };
  }

  // ==========================================
  // 5. NUMERICAL SCALPING STRATEGY (Faraz Gold)
  // ==========================================
  analyzeNumerical(currentPrice: number) {
    const now = Date.now();
    const cfg = this.config.strategy?.numerical || {
      spreadThreshold: 14,
      takeProfitPips: 10,
      stopLossPips: 8,
      roundNumberMagnet: 5,
      volumePerStep: 1,
      roundNumberBase: 10000
    };

    const tickSize = Number(this.config.market?.tickSize ?? 1000);
    const roundBase = cfg.roundNumberBase || 10000;

    // 1. Calculate Momentum (last 5 seconds)
    const last5SecTicks = this.tickHistory.filter(t => now - t.time <= 5000);
    let upCount = 0;
    let downCount = 0;
    let totalGrowth = 0;
    let totalDrop = 0;

    for (let i = 1; i < last5SecTicks.length; i++) {
      const diff = last5SecTicks[i].price - last5SecTicks[i - 1].price;
      if (diff > 0) {
        upCount++;
        totalGrowth += diff;
      } else if (diff < 0) {
        downCount++;
        totalDrop += Math.abs(diff);
      }
    }

    const momentumUp = upCount >= 3 && totalGrowth >= (6 * tickSize);
    const momentumDown = downCount >= 3 && totalDrop >= (6 * tickSize);

    // 2. Identify Round Numbers
    const roundNumber = Math.round(currentPrice / roundBase) * roundBase;
    const distToRound = Math.abs(currentPrice - roundNumber);

    let type: 'BUY' | 'SELL' | null = null;
    let patternName = '';
    let reasons: string[] = [];

    // Track round number hits (within magnet distance)
    const magnetDist = (cfg.roundNumberMagnet || 5) * tickSize;
    if (distToRound <= magnetDist) {
      if (!this.roundNumberHit || this.roundNumberHit.price !== roundNumber) {
        this.roundNumberHit = { price: roundNumber, time: now };
      }
    }

    // A) Breakout Strategy
    if (currentPrice >= roundNumber + (2 * tickSize) && momentumUp) {
      if (this.roundNumberHit && this.roundNumberHit.price === roundNumber && now - this.roundNumberHit.time < 10000) {
        type = 'BUY';
        patternName = 'Round Number Breakout (Long)';
        reasons.push('Price crossed RN + 2', 'Momentum Up');
      }
    } else if (currentPrice <= roundNumber - (2 * tickSize) && momentumDown) {
      if (this.roundNumberHit && this.roundNumberHit.price === roundNumber && now - this.roundNumberHit.time < 10000) {
        type = 'SELL';
        patternName = 'Round Number Breakout (Short)';
        reasons.push('Price crossed RN - 2', 'Momentum Down');
      }
    }

    // B) Rejection Strategy
    if (!type && this.roundNumberHit && this.roundNumberHit.price === roundNumber) {
      const timeSinceHit = now - this.roundNumberHit.time;
      if (timeSinceHit >= 3000 && timeSinceHit <= 8000) {
        if (currentPrice <= roundNumber - (2 * tickSize)) {
          type = 'SELL';
          patternName = 'Round Number Rejection (Short)';
          reasons.push('Failed to break RN up', 'Reversed 2 ticks');
        } else if (currentPrice >= roundNumber + (2 * tickSize)) {
          type = 'BUY';
          patternName = 'Round Number Rejection (Long)';
          reasons.push('Failed to break RN down', 'Reversed 2 ticks');
        }
      }
    }

    if (!type) return { signal: null, reason: 'No numerical signal' };

    this.roundNumberHit = null;

    const sl = type === 'BUY' ? currentPrice - (cfg.stopLossPips * tickSize) : currentPrice + (cfg.stopLossPips * tickSize);
    const tp = type === 'BUY' ? currentPrice + (cfg.takeProfitPips * tickSize) : currentPrice - (cfg.takeProfitPips * tickSize);

    const signal = {
      type,
      entry: currentPrice,
      sl,
      tp1: tp,
      score: 3,
      reasons,
      confidence: 85,
      timestamp: now,
      pattern: patternName,
      strategy: 'NUMERICAL',
      indicators: { 
        momentumUp, 
        momentumDown, 
        roundNumber,
        rsi: this.indicators.rsi?.toFixed(1),
        emaFast: this.indicators.emaFast?.toFixed(0),
        emaSlow: this.indicators.emaSlow?.toFixed(0),
        atr: this.indicators.atr?.toFixed(0)
      }
    };

    return { signal, reason: 'Numerical signal OK' };
  }

  // ==========================================
  // 6. HST STRATEGY (Hull + SuperTrend)
  // ==========================================
  analyzeHST(priceHistory: any[], currentPrice: number) {
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.low ?? p.price);
    const price = currentPrice || closes[closes.length - 1];

    const hstCfg = this.config.strategy?.hst || { 
      hmaLength: 55, 
      stPeriod: 10, 
      stMultiplier: 3,
      requireCloseAboveHMA: true,
      mode: 'NORMAL'
    };

    const regime = this.indicators.regime || this.detectMarketRegime(highs, lows, closes);
    
    let hmaLength = hstCfg.hmaLength || 55;
    let stPeriod = hstCfg.stPeriod || 10;
    let stMultiplier = hstCfg.stMultiplier || 3;

    // Dynamic adjustment based on regime and mode
    if (hstCfg.mode === 'AGGRESSIVE') {
      stMultiplier *= 0.85; 
      hmaLength = Math.round(hmaLength * 0.75);
    } else if (hstCfg.mode === 'PRECISION') {
      stMultiplier *= 1.15;
      hmaLength = Math.round(hmaLength * 1.25);
    }

    // Regime based adjustments
    if (regime === 'RANGING') {
      stMultiplier *= 1.2; // Be more careful in range
    } else if (regime === 'TRENDING') {
      stMultiplier *= 0.95; // Be more aggressive in trend
    }

    // We need enough data
    if (closes.length < hmaLength + 10 || closes.length < stPeriod * 2) {
      return { signal: null, reason: 'Not enough data for HST' };
    }

    // 1. Calculate HMA
    const hmaValues = this.calculateHMA(closes, hmaLength);
    if (!hmaValues || hmaValues.length < 3) return { signal: null, reason: 'HMA not ready' };
    
    const currentHMA = hmaValues[hmaValues.length - 1];
    const prevHMA = hmaValues[hmaValues.length - 2];
    const prevPrevHMA = hmaValues[hmaValues.length - 3];
    
    const hmaSlope = currentHMA - prevHMA;
    const prevHmaSlope = prevHMA - prevPrevHMA;
    
    // Smooth slope to avoid micro-whipsaws
    const isHmaTrendingUp = hmaSlope > 0 && prevHmaSlope > -0.5; // Allow slight flat before up
    const isHmaTrendingDown = hmaSlope < 0 && prevHmaSlope < 0.5; // Allow slight flat before down

    // 2. Calculate SuperTrend
    const stValues = this.calculateSuperTrend(highs, lows, closes, stPeriod, stMultiplier);
    if (!stValues || stValues.length < 3) return { signal: null, reason: 'SuperTrend not ready' };

    const currentST = stValues[stValues.length - 1];
    const prevST = stValues[stValues.length - 2];
    
    // 3. Calculate RSI for momentum confirmation (Noise Filter)
    const rsi = this.calculateRSI(closes, 14);
    
    // 4. Calculate ATR for volatility filter
    const atr = this.calculateATR(highs, lows, closes, 14);
    const atrPercent = (atr / price) * 100;
    
    // 5. Calculate MACD for additional confirmation
    const macd = this.calculateMACD(closes, 12, 26, 9);
    const isMacdBullish = macd ? macd.histogram > 0 : false;
    const isMacdBearish = macd ? macd.histogram < 0 : false;
    
    // Update indicators for dashboard
    this.indicators.hma = currentHMA;
    this.indicators.st = currentST.value;
    this.indicators.stDir = currentST.direction;
    
    let type: 'BUY' | 'SELL' | null = null;
    let reasons: string[] = [];
    let score = 0;

    // Entry Rules
    const hmaTurnsPositive = prevHmaSlope <= 0 && hmaSlope > 0;
    const hmaTurnsNegative = prevHmaSlope >= 0 && hmaSlope < 0;
    
    const isBullishST = currentST.direction === 1;
    const isBearishST = currentST.direction === -1;
    
    const justCrossedSTUp = prevST.direction === -1 && currentST.direction === 1;
    const justCrossedSTDown = prevST.direction === 1 && currentST.direction === -1;

    // Volatility Filter: Don't trade if market is completely dead
    if (atrPercent < 0.005 && hstCfg.mode !== 'AGGRESSIVE') {
      return { signal: null, reason: 'Volatility too low for HST' };
    }

    // Long Entry
    if (isBullishST && price > currentST.value) {
      // Require price to be above HMA for longs (unless aggressive)
      const hmaCondition = isHmaTrendingUp && (!hstCfg.requireCloseAboveHMA || price > currentHMA);
      
      // RSI Filter: Don't buy if already overbought
      const rsiCondition = rsi > 45 && rsi < 70;
      
      if (hmaCondition && rsiCondition) {
        if (hmaTurnsPositive || justCrossedSTUp) {
          type = 'BUY';
          score = hstCfg.mode === 'PRECISION' ? 3 : (hstCfg.mode === 'NORMAL' ? 2 : 1);
          reasons.push('SuperTrend Bullish', hmaTurnsPositive ? 'HMA Turned Up' : 'ST Breakout', `RSI: ${Math.round(rsi)}`);
          
          if (isMacdBullish) {
            score += 1;
            reasons.push('MACD Bullish Confirmation');
          }
        } else if (hstCfg.mode === 'AGGRESSIVE' && isHmaTrendingUp && rsi > 50) {
          // Pullback entry in aggressive mode
          const prevClose = closes[closes.length - 2];
          if (prevClose < currentHMA && price > currentHMA) {
            type = 'BUY';
            score = 1;
            reasons.push('HMA Pullback Recovery');
          }
        }
      }
    }

    // Short Entry
    if (isBearishST && price < currentST.value) {
      // Require price to be below HMA for shorts (unless aggressive)
      const hmaCondition = isHmaTrendingDown && (!hstCfg.requireCloseAboveHMA || price < currentHMA);
      
      // RSI Filter: Don't sell if already oversold
      const rsiCondition = rsi < 55 && rsi > 30;
      
      if (hmaCondition && rsiCondition) {
        if (hmaTurnsNegative || justCrossedSTDown) {
          type = 'SELL';
          score = hstCfg.mode === 'PRECISION' ? 3 : (hstCfg.mode === 'NORMAL' ? 2 : 1);
          reasons.push('SuperTrend Bearish', hmaTurnsNegative ? 'HMA Turned Down' : 'ST Breakout', `RSI: ${Math.round(rsi)}`);
          
          if (isMacdBearish) {
            score += 1;
            reasons.push('MACD Bearish Confirmation');
          }
        } else if (hstCfg.mode === 'AGGRESSIVE' && isHmaTrendingDown && rsi < 50) {
          // Pullback entry in aggressive mode
          const prevClose = closes[closes.length - 2];
          if (prevClose > currentHMA && price < currentHMA) {
            type = 'SELL';
            score = 1;
            reasons.push('HMA Pullback Recovery');
          }
        }
      }
    }

    // Range Filter: In PRECISION or NORMAL mode, don't trade if RANGING
    if ((hstCfg.mode === 'PRECISION' || hstCfg.mode === 'NORMAL') && regime === 'RANGING' && type) {
      return { signal: null, reason: 'Skipped: Ranging market (Noise Filter)' };
    }

    // NORMAL mode now requires at least 3 score (meaning it needs MACD confirmation)
    const requiredScore = hstCfg.mode === 'PRECISION' ? 4 : (hstCfg.mode === 'NORMAL' ? 3 : 1);
    
    if (!type || score < requiredScore) {
      return { signal: null, reason: `Score ${score} too low (Need ${requiredScore})` };
    }

    const signal = this.createSignal(type, price, score, reasons, atr, 'HST');
    
    return { signal, reason: 'HST signal OK' };
  }

  detectMarketRegime(highs: number[], lows: number[], closes: number[]) {
    if (closes.length < 30) return 'UNKNOWN';
    
    const adx = this.calculateADX(highs, lows, closes, 14);
    this.indicators.adx = adx;

    if (adx > 25) return 'TRENDING';
    if (adx < 20) return 'RANGING';
    
    // Secondary check: Bollinger Band width or price consolidation
    const sma = this.calculateSMA(closes, 20);
    let sumSq = 0;
    const last20 = closes.slice(-20);
    for (const p of last20) sumSq += Math.pow(p - sma, 2);
    const stdDev = Math.sqrt(sumSq / 20);
    const bbWidth = (stdDev * 4) / sma * 100;

    if (bbWidth < 0.1) return 'RANGING'; // Very tight range
    
    return 'NORMAL';
  }

  calculateADX(highs: number[], lows: number[], closes: number[], period: number = 14) {
    if (closes.length < period * 2) return 20;

    let tr: number[] = [];
    let dmPlus: number[] = [];
    let dmMinus: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      const h = highs[i];
      const l = lows[i];
      const ph = highs[i - 1];
      const pl = lows[i - 1];
      const pc = closes[i - 1];

      const trVal = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      tr.push(trVal);

      const moveUp = h - ph;
      const moveDown = pl - l;

      if (moveUp > moveDown && moveUp > 0) dmPlus.push(moveUp);
      else dmPlus.push(0);

      if (moveDown > moveUp && moveDown > 0) dmMinus.push(moveDown);
      else dmMinus.push(0);
    }

    const smoothTR = this.calculateEMA(tr, period);
    const smoothPlus = this.calculateEMA(dmPlus, period);
    const smoothMinus = this.calculateEMA(dmMinus, period);

    const diPlus = 100 * (smoothPlus / smoothTR);
    const diMinus = 100 * (smoothMinus / smoothTR);

    const dx = 100 * Math.abs(diPlus - diMinus) / (diPlus + diMinus);
    
    // This is a simplification, real ADX is smoothed DX
    return dx || 20;
  }

  // ==========================================
  // UTILS
  // ==========================================
  createSignal(type: 'BUY' | 'SELL', price: number, score: number, reasons: string[], atr: number, strategyName: string) {
    const market = this.config.market || {};
    const tickSize = Number(market.tickSize ?? 1);
    
    // Smart SL/TP based on ATR (Volatility)
    // If ATR is not provided or too small, fallback to ticks
    const currentAtr = atr || this.indicators.atr || (price * 0.0005);
    
    // Standard: SL = 1.5 * ATR, TP = SL * RiskReward
    const tt = this.config.targetsTicks || {};
    const minStopTicks = Number(tt.stopTicks ?? 12);
    const minTpTicks = Number(tt.tpTicks ?? 18);
    
    const rr = Number(this.config.strategy?.riskRewardRatio || 1.5);
    
    let slDist = currentAtr * 1.2; // Slightly tighter SL
    let tpDist = slDist * rr;

    // Ensure we don't go below minimum ticks
    slDist = Math.max(slDist, minStopTicks * tickSize);
    tpDist = Math.max(tpDist, minTpTicks * tickSize);
    
    // Cap maximum distance to prevent "very far" targets during spikes
    const maxDist = price * 0.01; // Max 1% move for a single trade
    slDist = Math.min(slDist, maxDist);
    tpDist = Math.min(tpDist, maxDist * 2);

    const isBuy = type === 'BUY';
    let sl = isBuy ? price - slDist : price + slDist;
    let tp1 = isBuy ? price + tpDist : price - tpDist;

    // Final safety fallback
    if (isNaN(sl) || sl === 0) sl = isBuy ? price - (10 * tickSize) : price + (10 * tickSize);
    if (isNaN(tp1) || tp1 === 0) tp1 = isBuy ? price + (15 * tickSize) : price - (15 * tickSize);

    return {
      type,
      entry: price,
      sl: Math.round(sl),
      tp1: Math.round(tp1),
      score,
      reasons,
      confidence: 50 + (score * 15),
      timestamp: Date.now(),
      strategy: strategyName,
      indicators: {
        rsi: this.indicators.rsi?.toFixed(1),
        emaFast: this.indicators.emaFast?.toFixed(0),
        emaSlow: this.indicators.emaSlow?.toFixed(0),
        atr: currentAtr.toFixed(0),
      }
    };
  }

  findSwings(highs: number[], lows: number[], length: number) {
    const swingHighs = [];
    const swingLows = [];
    
    for (let i = length; i < highs.length - length; i++) {
      let isHigh = true;
      let isLow = true;
      
      for (let j = 1; j <= length; j++) {
        if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) isHigh = false;
        if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) isLow = false;
      }
      
      if (isHigh) swingHighs.push({ index: i, price: highs[i] });
      if (isLow) swingLows.push({ index: i, price: lows[i] });
    }
    
    return { highs: swingHighs, lows: swingLows };
  }

  calculateIndicators(closes: number[], highs: number[], lows: number[], volumes: number[]) {
    const cfg = this.config.strategy?.indicators || this.config.strategy || {};
    
    // Always calculate RSI and ATR for the dashboard
    this.indicators.rsi = this.calculateRSI(closes, cfg.rsi?.period || 14);
    this.indicators.atr = this.calculateATR(highs, lows, closes, cfg.atr?.period || 14);
    
    if (cfg.ema?.enabled !== false) {
      this.indicators.emaFast = this.calculateEMA(closes, cfg.ema?.fast || 9);
      this.indicators.emaSlow = this.calculateEMA(closes, cfg.ema?.slow || 21);
    }
  }

  calculateRSI(prices: number[], period: number = 14) {
    if (!prices || prices.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    
    // Calculate initial average gain and loss
    for (let i = prices.length - period; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculateSMA(prices: number[], period: number) {
    if (!prices || prices.length < period) return 0;
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  calculateEMA(prices: number[], period: number) {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  calculateMACD(prices: number[], fast: number, slow: number, signal: number) {
    if (prices.length < slow + signal) return null;
    
    const emaFastArr = [];
    const emaSlowArr = [];
    
    let currentEmaFast = this.calculateSMA(prices.slice(0, fast), fast);
    let currentEmaSlow = this.calculateSMA(prices.slice(0, slow), slow);
    
    const kFast = 2 / (fast + 1);
    const kSlow = 2 / (slow + 1);
    
    for (let i = slow; i < prices.length; i++) {
      currentEmaFast = prices[i] * kFast + currentEmaFast * (1 - kFast);
      currentEmaSlow = prices[i] * kSlow + currentEmaSlow * (1 - kSlow);
      emaFastArr.push(currentEmaFast);
      emaSlowArr.push(currentEmaSlow);
    }
    
    const macdLine = emaFastArr.map((f, i) => f - emaSlowArr[i]);
    const signalLine = this.calculateEMA(macdLine, signal);
    const histogram = macdLine[macdLine.length - 1] - signalLine;
    
    return {
      macd: macdLine[macdLine.length - 1],
      signal: signalLine,
      histogram
    };
  }

  calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14) {
    if (!closes || closes.length < 2) return (closes?.[0] || 0) * 0.002;
    const trs: number[] = [];
    for (let i = Math.max(1, closes.length - period); i < closes.length; i++) {
      const high = highs[i] ?? closes[i];
      const low = lows[i] ?? closes[i];
      const prevClose = closes[i - 1];
      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);
      trs.push(Math.max(tr1, tr2, tr3));
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  calculateWMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    const slice = prices.slice(-period);
    let sum = 0;
    let weightSum = 0;
    for (let i = 0; i < period; i++) {
      const weight = i + 1;
      sum += slice[i] * weight;
      weightSum += weight;
    }
    return sum / weightSum;
  }

  calculateHMA(prices: number[], period: number): number[] {
    if (prices.length < period) return [];
    
    const halfPeriod = Math.floor(period / 2);
    const sqrtPeriod = Math.floor(Math.sqrt(period));
    
    const rawHMA: number[] = [];
    // We need to calculate raw HMA for at least sqrtPeriod candles
    for (let i = prices.length - sqrtPeriod * 2; i <= prices.length; i++) {
      if (i < period) continue;
      const currentSlice = prices.slice(0, i);
      const wmaHalf = this.calculateWMA(currentSlice, halfPeriod);
      const wmaFull = this.calculateWMA(currentSlice, period);
      rawHMA.push(2 * wmaHalf - wmaFull);
    }
    
    const hma: number[] = [];
    for (let i = sqrtPeriod; i <= rawHMA.length; i++) {
      hma.push(this.calculateWMA(rawHMA.slice(0, i), sqrtPeriod));
    }
    
    return hma;
  }

  calculateSuperTrend(highs: number[], lows: number[], closes: number[], period: number, multiplier: number) {
    if (closes.length < period) return [];
    
    const st: { value: number, direction: number }[] = [];
    let prevFinalUpperBand = 0;
    let prevFinalLowerBand = 0;
    let prevDirection = 1;
    
    for (let i = period; i < closes.length; i++) {
      const currentClose = closes[i];
      const prevClose = closes[i - 1];
      
      // Calculate True Range for this candle
      const tr1 = highs[i] - lows[i];
      const tr2 = Math.abs(highs[i] - prevClose);
      const tr3 = Math.abs(lows[i] - prevClose);
      const tr = Math.max(tr1, tr2, tr3);
      
      // Approximate ATR (simple average for speed, ideally should be RMA)
      let atrSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const jTr1 = highs[j] - lows[j];
        const jTr2 = Math.abs(highs[j] - closes[j-1]);
        const jTr3 = Math.abs(lows[j] - closes[j-1]);
        atrSum += Math.max(jTr1, jTr2, jTr3);
      }
      const atr = atrSum / period;
      
      const basicUpperBand = ((highs[i] + lows[i]) / 2) + (multiplier * atr);
      const basicLowerBand = ((highs[i] + lows[i]) / 2) - (multiplier * atr);
      
      let finalUpperBand = basicUpperBand;
      let finalLowerBand = basicLowerBand;
      
      if (basicUpperBand < prevFinalUpperBand || prevClose > prevFinalUpperBand) {
        finalUpperBand = basicUpperBand;
      } else {
        finalUpperBand = prevFinalUpperBand;
      }
      
      if (basicLowerBand > prevFinalLowerBand || prevClose < prevFinalLowerBand) {
        finalLowerBand = basicLowerBand;
      } else {
        finalLowerBand = prevFinalLowerBand;
      }
      
      let direction = prevDirection;
      if (prevDirection === 1 && currentClose < finalLowerBand) {
        direction = -1;
      } else if (prevDirection === -1 && currentClose > finalUpperBand) {
        direction = 1;
      }
      
      const value = direction === 1 ? finalLowerBand : finalUpperBand;
      
      st.push({ value, direction });
      
      prevFinalUpperBand = finalUpperBand;
      prevFinalLowerBand = finalLowerBand;
      prevDirection = direction;
    }
    
    return st;
  }
}
