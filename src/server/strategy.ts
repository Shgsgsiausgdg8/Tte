export class Strategy {
  config: any;
  lastSignalTime: number = 0;
  lastSignalType: string | null = null;
  lastSameSideSignalTime: number = 0;
  indicators: {
    rsi: number | null;
    atr: number | null;
    emaFast: number | null;
    emaSlow: number | null;
    adx: number | null;
    stochK: number | null;
    stochD: number | null;
    volSMA: number | null;
    macd: { macd: number, signal: number, histogram: number } | null;
    bb: { upper: number, lower: number, mid: number } | null;
    hma: number | null;
    st: number | null;
    stDir: number | null;
    hmaFast: number | null;
    hmaSlow: number | null;
    tenkan: number | null;
    kijun: number | null;
    regime: string;
  } = {
    rsi: null,
    atr: null,
    emaFast: null,
    emaSlow: null,
    adx: null,
    stochK: null,
    stochD: null,
    volSMA: null,
    macd: null,
    bb: null,
    hma: null,
    st: null,
    stDir: null,
    hmaFast: null,
    hmaSlow: null,
    tenkan: null,
    kijun: null,
    regime: 'RANGE',
  };
  signals: any[] = [];
  minSignalScore: number;
  cooldown: number;
  highQualityMode: boolean;
  tickHistory: { price: number, time: number }[] = [];
  roundNumberHit: { price: number, time: number } | null = null;

  constructor(config: any) {
    this.config = config;
    this.minSignalScore = config.strategy?.minSignalScore || 1;
    this.cooldown = (config.strategy?.tradeCooldown || 10) * 1000;
    this.highQualityMode = config.strategy?.highQualityMode || false;
  }

  getMTFStatus(priceHistory: any[], mtfHistory?: any[]) {
    if (!this.config.strategy?.mtf?.enabled) return null;
    const history5 = mtfHistory && mtfHistory.length >= 20 ? mtfHistory : this.aggregateTo5Min(priceHistory);
    if (history5.length < 20) return { status: 'WAITING', trend: 'UNKNOWN' };
    
    const closes5 = history5.map(p => p.price);
    const emaFast5 = this.calculateEMA(closes5, 20);
    const emaSlow5 = this.calculateEMA(closes5, 50);
    const trend5 = emaFast5 > emaSlow5 ? 'BUY' : 'SELL';
    
    return {
      status: 'CONFIRMED',
      trend: trend5,
      timeframe: '5m'
    };
  }

  analyze(priceHistory: any[], openPositionsCount: number, currentPrice: number, dryRun: boolean = false, mtfHistory?: any[]) {
    if (!Array.isArray(priceHistory) || priceHistory.length < 50) {
      return { signal: null, reason: `Waiting for data... (${priceHistory?.length || 0}/50)` };
    }

    const now = Date.now();

    // Adjust parameters for High Quality Mode
    let effectiveMinScore = this.minSignalScore;
    let effectiveCooldown = this.cooldown;

    if (this.highQualityMode) {
      // Significantly increase requirements
      effectiveMinScore = Math.max(effectiveMinScore + 3, 5); // Require at least score 5
      effectiveCooldown = Math.max(effectiveCooldown, 60 * 60 * 1000); // At least 1 hour cooldown between signals
    }

    if (!dryRun && now - this.lastSignalTime < effectiveCooldown) {
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
      result = this.analyzeScalp(priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'QUANT') {
      result = this.analyzeQuant(priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'TREND') {
      result = this.analyzeTrend(priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'FAST') {
      result = this.analyzeFast(priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'NUMERICAL') {
      result = this.analyzeNumerical(currentPrice);
    } else if (activeStrategy === 'HST') {
      result = this.analyzeHST(priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'PINBAR') {
      result = this.analyzePinBar(priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'MTF_PATTERN') {
      const priceHistory5min = mtfHistory && mtfHistory.length >= 20 ? mtfHistory : this.aggregateTo5Min(priceHistory);
      result = this.analyzeMTFPatterns(priceHistory5min, priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'ICHIMOKU_MTF') {
      const priceHistory5min = mtfHistory && mtfHistory.length >= 20 ? mtfHistory : this.aggregateTo5Min(priceHistory);
      result = this.analyzeIchimokuMTF(priceHistory5min, priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'ICHIMOKU_HARAMI') {
      const priceHistory5min = mtfHistory && mtfHistory.length >= 20 ? mtfHistory : this.aggregateTo5Min(priceHistory);
      result = this.analyzeIchimokuHaramiMTF(priceHistory5min, priceHistory, currentPrice, effectiveMinScore);
    } else if (activeStrategy === 'HMAMACD') {
      result = this.analyzeHMAMACD(priceHistory, currentPrice, effectiveMinScore);
    }

    if (result?.signal && !dryRun) {
      // 1. Real Multi-Timeframe Confirmation
      if (this.config.strategy?.mtf?.enabled) {
        const history5 = mtfHistory && mtfHistory.length >= 20 ? mtfHistory : this.aggregateTo5Min(priceHistory);
        if (history5.length >= 20) {
          const closes5 = history5.map(p => p.price);
          const emaFast5 = this.calculateEMA(closes5, 20);
          const emaSlow5 = this.calculateEMA(closes5, 50);
          const trend5 = emaFast5 > emaSlow5 ? 'BUY' : 'SELL';
          
          if (result.signal.type !== trend5) {
            return { signal: null, reason: `MTF Trend Mismatch (1m: ${result.signal.type}, 5m: ${trend5})` };
          }
        }
      }

      // 2. Pullback Entry Flag
      if (this.config.strategy?.pullback?.enabled) {
        result.signal.isPullback = true;
        result.signal.pullbackConfig = this.config.strategy.pullback;
      }

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
  analyzeScalp(priceHistory: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.price);
    const volumes = priceHistory.map(p => p.volume ?? 0);
    const price = currentPrice || closes[closes.length - 1];

    this.calculateIndicators(closes, highs, lows, volumes);

    const ind = this.indicators;
    const scalpCfg = this.config.strategy?.scalp || {};
    const scalpMode = scalpCfg.mode || 'NORMAL';
    
    const rsi = this.calculateRSI(closes, scalpCfg.rsiPeriod || 14);
    const emaFast = this.calculateEMA(closes, scalpCfg.emaFast || 9);
    const emaSlow = this.calculateEMA(closes, scalpCfg.emaSlow || 21);
    const atr = this.calculateATR(highs, lows, closes, 14);

    const cfg = {
      rsi: {
        oversold: scalpCfg.rsiOversold || 40,
        overbought: scalpCfg.rsiOverbought || 60
      }
    };

    if (rsi === null || emaFast === null || emaSlow === null) return { signal: null, reason: 'Indicators not ready' };

    const atrPercent = (atr / price) * 100;
    const minAtrPercent = Number(scalpCfg.minAtrPercent ?? 0.005);
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

    let maxDistPct = Number(scalpCfg.maxDistanceFromSlowEmaPercent ?? 0.08);
    let requiredScore = effectiveMinScore;
    
    // Adjust logic based on mode
    if (scalpMode === 'PRECISION') {
      maxDistPct = 0.05; // Stricter distance
      requiredScore = Math.max(effectiveMinScore, 4); // Require more confirmations
    } else if (scalpMode === 'AGGRESSIVE') {
      maxDistPct = 0.15; // Looser distance
      requiredScore = Math.max(1, effectiveMinScore - 1); // Require fewer confirmations
    }

    const maxDist = (maxDistPct / 100);

    // Stricter distance check from slow EMA to avoid buying at the top or selling at the bottom
    const distToSlowEma = Math.abs(price - emaSlow) / emaSlow;
    const nearSlowForBuy = distToSlowEma <= maxDist;
    const nearSlowForSell = distToSlowEma <= maxDist;

    // Require stronger RSI levels for entry
    const rsiOversold = cfg.rsi.oversold;
    const rsiOverbought = cfg.rsi.overbought;

    // Additional filters to reduce fake signals
    const adx = this.indicators.adx || 0;
    const volSMA = this.indicators.volSMA || 0;
    const currentVol = volumes[volumes.length - 1] || 0;
    const stochK = this.indicators.stochK || 50;
    const stochD = this.indicators.stochD || 50;
    const macd = this.indicators.macd;
    const bb = this.indicators.bb;
    
    // 1. Volume Confirmation (Volume should be higher than average)
    const volumeConfirmed = currentVol > volSMA * (scalpCfg.volMultiplier || 1.1);
    
    // 2. Trend Strength (ADX > 20)
    const trendStrong = adx > (scalpCfg.adxThreshold || 20);
    
    // 3. Stochastic Confirmation
    const stochBuy = stochK < (scalpCfg.stochOversold || 30) && stochK > stochD;
    const stochSell = stochK > (scalpCfg.stochOverbought || 70) && stochK < stochD;

    // 4. MACD Confirmation
    const macdBuy = macd && macd.histogram > 0 && macd.macd > macd.signal;
    const macdSell = macd && macd.histogram < 0 && macd.macd < macd.signal;

    // 5. Bollinger Bands Confirmation
    const bbBuy = bb && price < bb.mid; // Buy in lower half
    const bbSell = bb && price > bb.mid; // Sell in upper half

    // 6. Candlestick Patterns
    const patterns = this.detectPatterns(priceHistory.slice(-5));
    const bullishPattern = patterns.some(p => p.type === 'BULLISH');
    const bearishPattern = patterns.some(p => p.type === 'BEARISH');

    // 7. MTF Trend Check (5m trend)
    const mtf = this.getMTFStatus(priceHistory);
    const mtfConfirmed = !mtf || mtf.status !== 'CONFIRMED' || mtf.trend === (trendUp ? 'BUY' : 'SELL');

    if (trendUp && nearSlowForBuy) {
      // Base signal: RSI Pullback
      if (rsi <= rsiOversold) {
        type = 'BUY';
        score += 2;
        reasons.push(`RSI Pullback (${rsi.toFixed(1)})`);
      }
      
      // Momentum Reversal
      if (!type && rsi < 55 && momentumUp && price >= emaFast && closes[closes.length - 2] < emaFast) {
        type = 'BUY';
        score += 1;
        reasons.push('Momentum Reversal (Crossed Fast EMA)');
      }
      
      // EMA Cross Up
      if (!type && emaFast > emaSlow && closes[closes.length - 2] <= emaSlow && rsi > 40 && rsi < 60) {
        type = 'BUY';
        score += 1;
        reasons.push('EMA Cross Up Confirmation');
      }

      if (type) {
        reasons.push('Trend Up (EMA Fast > Slow)');
        if (momentumUp) { score += 1; reasons.push('Green Candle'); }
        
        // Add scores for new filters if enabled
        if (scalpCfg.useVolumeFilter && volumeConfirmed) { score += 1; reasons.push('Volume Confirmation'); }
        if (scalpCfg.useAdxFilter && trendStrong) { score += 1; reasons.push(`Trend Strength (ADX: ${adx.toFixed(0)})`); }
        if (scalpCfg.useStochFilter && stochBuy) { score += 1; reasons.push('Stochastic Oversold Cross'); }
        if (scalpCfg.useMacdFilter && macdBuy) { score += 1; reasons.push('MACD Momentum Up'); }
        if (scalpCfg.useBbFilter && bbBuy) { score += 1; reasons.push('BB Lower Half'); }
        if (scalpCfg.useCandleFilter && bullishPattern) { score += 1; reasons.push('Bullish Candle Pattern'); }
        
        if (scalpCfg.useMtfFilter) {
          if (mtfConfirmed) { score += 1; reasons.push('MTF Trend Alignment (5m)'); }
          else { score -= 2; reasons.push('MTF Trend Conflict (5m)'); }
        }
      }
    } else if (trendDown && nearSlowForSell) {
      // Base signal: RSI Pullback
      if (rsi >= rsiOverbought) {
        type = 'SELL';
        score += 2;
        reasons.push(`RSI Pullback (${rsi.toFixed(1)})`);
      }
      
      // Momentum Reversal
      if (!type && rsi > 45 && momentumDown && price <= emaFast && closes[closes.length - 2] > emaFast) {
        type = 'SELL';
        score += 1;
        reasons.push('Momentum Reversal (Crossed Fast EMA)');
      }
      
      // EMA Cross Down
      if (!type && emaFast < emaSlow && closes[closes.length - 2] >= emaSlow && rsi > 40 && rsi < 60) {
        type = 'SELL';
        score += 1;
        reasons.push('EMA Cross Down Confirmation');
      }

      if (type) {
        reasons.push('Trend Down (EMA Fast < Slow)');
        if (momentumDown) { score += 1; reasons.push('Red Candle'); }
        
        // Add scores for new filters if enabled
        if (scalpCfg.useVolumeFilter && volumeConfirmed) { score += 1; reasons.push('Volume Confirmation'); }
        if (scalpCfg.useAdxFilter && trendStrong) { score += 1; reasons.push(`Trend Strength (ADX: ${adx.toFixed(0)})`); }
        if (scalpCfg.useStochFilter && stochSell) { score += 1; reasons.push('Stochastic Overbought Cross'); }
        if (scalpCfg.useMacdFilter && macdSell) { score += 1; reasons.push('MACD Momentum Down'); }
        if (scalpCfg.useBbFilter && bbSell) { score += 1; reasons.push('BB Upper Half'); }
        if (scalpCfg.useCandleFilter && bearishPattern) { score += 1; reasons.push('Bearish Candle Pattern'); }

        if (scalpCfg.useMtfFilter) {
          if (mtfConfirmed) { score += 1; reasons.push('MTF Trend Alignment (5m)'); }
          else { score -= 2; reasons.push('MTF Trend Conflict (5m)'); }
        }
      }
    }

    // Stricter filtering: If volume is very low and trend is weak, reject
    if (type && !volumeConfirmed && !trendStrong && score < requiredScore + 2) {
      if (scalpMode !== 'AGGRESSIVE') {
        return { signal: null, reason: 'Low volume and weak trend' };
      }
    }

    if (scalpMode === 'PRECISION') {
      if (!volumeConfirmed) return { signal: null, reason: 'PRECISION Mode: Volume not confirming' };
      if (!trendStrong) return { signal: null, reason: 'PRECISION Mode: Trend not strong enough' };
      if (type === 'BUY' && !macdBuy) return { signal: null, reason: 'PRECISION Mode: MACD not confirming BUY' };
      if (type === 'SELL' && !macdSell) return { signal: null, reason: 'PRECISION Mode: MACD not confirming SELL' };
      if (!mtfConfirmed) return { signal: null, reason: 'PRECISION Mode: MTF Trend not aligned' };
    }

    if (!type || score < requiredScore) return { signal: null, reason: `Score too low (${score}/${requiredScore})` };

    // Additional High Quality Filters
    if (this.highQualityMode) {
      const rsi = this.indicators.rsi || 50;
      const adx = this.indicators.adx || 0;
      
      // 1. Trend Strength Filter (ADX > 25)
      if (adx < 25) return { signal: null, reason: 'HQ Mode: Trend too weak (ADX < 25)' };
      
      // 2. RSI Extreme Filter
      if (type === 'BUY' && rsi > 45) return { signal: null, reason: 'HQ Mode: RSI not oversold enough for BUY' };
      if (type === 'SELL' && rsi < 55) return { signal: null, reason: 'HQ Mode: RSI not overbought enough for SELL' };
      
      // 3. Volatility Filter (ATR must be significant)
      const atr = this.indicators.atr || 0;
      const atrPercent = (atr / currentPrice) * 100;
      if (atrPercent < 0.015) return { signal: null, reason: 'HQ Mode: Volatility too low' };
    }

    return { signal: this.createSignal(type, price, score, reasons, atr, 'SCALP'), reason: 'Signal OK' };
  }

  // ==========================================
  // 2. QUANT STRATEGY (Price Action & Patterns)
  // ==========================================
  analyzeQuant(priceHistory: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
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

    if (score < effectiveMinScore) return { signal: null, reason: `Score too low (${score}/${effectiveMinScore})` };

    // Additional High Quality Filters
    if (this.highQualityMode) {
      const adx = this.indicators.adx || 0;
      if (adx < 25) return { signal: null, reason: 'HQ Mode: Trend too weak (ADX < 25)' };
      if (type === 'BUY' && rsi > 45) return { signal: null, reason: 'HQ Mode: RSI not oversold enough' };
      if (type === 'SELL' && rsi < 55) return { signal: null, reason: 'HQ Mode: RSI not overbought enough' };
    }

    const signal = {
      type,
      entry: price,
      sl,
      tp1: tp,
      tp2: type === 'BUY' ? price + (tp - price) * 1.8 : price - (price - tp) * 1.8,
      tp3: type === 'BUY' ? price + (tp - price) * 3.0 : price - (price - tp) * 3.0,
      score,
      strength: score >= 5 ? 'STRONG' : (score >= 3 ? 'NORMAL' : 'WEAK'),
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
  analyzeTrend(priceHistory: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
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

    if (score < effectiveMinScore) return { signal: null, reason: `Score too low (${score}/${effectiveMinScore})` };

    // Additional High Quality Filters
    if (this.highQualityMode) {
      const adx = this.indicators.adx || 0;
      if (adx < 30) return { signal: null, reason: 'HQ Mode: Trend too weak for Trend Strategy (ADX < 30)' };
      const rsi = this.indicators.rsi || 50;
      if (type === 'BUY' && rsi > 50) return { signal: null, reason: 'HQ Mode: RSI too high for Trend BUY' };
      if (type === 'SELL' && rsi < 50) return { signal: null, reason: 'HQ Mode: RSI too low for Trend SELL' };
    }

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
      tp2: type === 'BUY' ? price + tpDist * 1.8 : price - tpDist * 1.8,
      tp3: type === 'BUY' ? price + tpDist * 3.0 : price - tpDist * 3.0,
      score,
      strength: score >= 5 ? 'STRONG' : (score >= 3 ? 'NORMAL' : 'WEAK'),
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
  analyzeFast(priceHistory: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.price);
    const price = currentPrice || closes[closes.length - 1];

    const fastCfg = this.config.strategy?.fast || {
      emaFast: 5,
      emaSlow: 13,
      rsiPeriod: 7,
      rsiOversold: 40,
      rsiOverbought: 60
    };

    // Very short periods for fast reaction
    const rsi = this.calculateRSI(closes, fastCfg.rsiPeriod || 7);
    const emaFast = this.calculateEMA(closes, fastCfg.emaFast || 5);
    const emaSlow = this.calculateEMA(closes, fastCfg.emaSlow || 13);
    
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2] || lastClose;
    const momentum = lastClose - prevClose;

    let type: 'BUY' | 'SELL' | null = null;
    let reasons: string[] = [];
    let score = 0;

    // Aggressive Buy
    if (price > emaFast && emaFast > emaSlow) {
      if (rsi < (fastCfg.rsiOversold || 40) && momentum > 0) { // Stricter RSI
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
      if (rsi > (fastCfg.rsiOverbought || 60) && momentum < 0) { // Stricter RSI
        type = 'SELL';
        score = 2;
        reasons.push('Fast EMA Cross', 'RSI Overbought Pullback');
      } else if (rsi > 45 && momentum < 0 && lastClose < emaFast && prevClose >= emaFast) { // Require cross
        type = 'SELL';
        score = 1;
        reasons.push('Fast Momentum Breakout');
      }
    }

    if (!type || score < Math.max(2, effectiveMinScore)) return { signal: null, reason: `No fast signal (Score < ${Math.max(2, effectiveMinScore)})` };

    // Additional High Quality Filters
    if (this.highQualityMode) {
      const adx = this.indicators.adx || 0;
      if (adx < 20) return { signal: null, reason: 'HQ Mode: Trend too weak for Fast Strategy (ADX < 20)' };
      if (type === 'BUY' && rsi > 40) return { signal: null, reason: 'HQ Mode: RSI too high for Fast BUY' };
      if (type === 'SELL' && rsi < 60) return { signal: null, reason: 'HQ Mode: RSI too low for Fast SELL' };
    }

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

    const tickSize = Number(this.config.market?.tickSize ?? 1);
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

    // Additional High Quality Filters
    const hqResult = this.applyHighQualityFilters(type, currentPrice, 3);
    if (hqResult.filtered) return { signal: null, reason: hqResult.reason };

    this.roundNumberHit = null;

    const atr = this.indicators.atr || (currentPrice * 0.0005);
    const signal = this.createSignal(type, currentPrice, 3, reasons, atr, 'NUMERICAL');
    signal.pattern = patternName;
    
    // Override SL/TP if numerical config has specific pips
    if (cfg.stopLossPips) {
      signal.sl = type === 'BUY' ? currentPrice - (cfg.stopLossPips * tickSize) : currentPrice + (cfg.stopLossPips * tickSize);
    }
    if (cfg.takeProfitPips) {
      signal.tp1 = type === 'BUY' ? currentPrice + (cfg.takeProfitPips * tickSize) : currentPrice - (cfg.takeProfitPips * tickSize);
      // Re-calculate TP2/TP3 based on new TP1
      const tpDist = Math.abs(signal.tp1 - currentPrice);
      signal.tp2 = type === 'BUY' ? currentPrice + (tpDist * 1.8) : currentPrice - (tpDist * 1.8);
      signal.tp3 = type === 'BUY' ? currentPrice + (tpDist * 3.0) : currentPrice - (tpDist * 3.0);
    }

    return { signal, reason: 'Numerical signal OK' };
  }

  // ==========================================
  // 6. HST STRATEGY (Hull + SuperTrend)
  // ==========================================
  analyzeHST(priceHistory: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.price);
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

    // Additional High Quality Filters
    const hqResult = this.applyHighQualityFilters(type, price, score);
    if (hqResult.filtered) return { signal: null, reason: hqResult.reason };

    const signal = this.createSignal(type, price, score, reasons, atr, 'HST');
    
    return { signal, reason: 'HST signal OK' };
  }

  analyzeHMAMACD(priceHistory: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
    const closes = priceHistory.map(p => p.price);
    const highs = priceHistory.map(p => p.high ?? p.price);
    const lows = priceHistory.map(p => p.low ?? p.price);
    const price = currentPrice || closes[closes.length - 1];

    const cfg = this.config.strategy?.hmamacd || {
      hmaFast: 9,
      hmaSlow: 21,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      distanceFilter: 0.005, // 0.5% max distance from MA
      minCandleStrength: 0.001 // 0.1% min candle body
    };

    if (closes.length < Math.max(cfg.hmaSlow, cfg.macdSlow + cfg.macdSignal) + 5) {
      return { signal: null, reason: 'Not enough data for HMA-MACD' };
    }

    // 1. Calculate HMAs
    const hmaFastValues = this.calculateHMA(closes, cfg.hmaFast);
    const hmaSlowValues = this.calculateHMA(closes, cfg.hmaSlow);

    if (hmaFastValues.length < 2 || hmaSlowValues.length < 2) {
      return { signal: null, reason: 'HMAs not ready' };
    }

    const currentHmaFast = hmaFastValues[hmaFastValues.length - 1];
    const prevHmaFast = hmaFastValues[hmaFastValues.length - 2];
    const currentHmaSlow = hmaSlowValues[hmaSlowValues.length - 1];
    const prevHmaSlow = hmaSlowValues[hmaSlowValues.length - 2];

    // 2. Calculate MACD
    // We need current and previous MACD to detect cross
    const macdCurrent = this.calculateMACD(closes, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
    const macdPrev = this.calculateMACD(closes.slice(0, -1), cfg.macdFast, cfg.macdSlow, cfg.macdSignal);

    if (!macdCurrent || !macdPrev) {
      return { signal: null, reason: 'MACD not ready' };
    }

    // 3. Local High/Low (Optional precision)
    const lookback = 10;
    const localHigh = Math.max(...highs.slice(-lookback));
    const localLow = Math.min(...lows.slice(-lookback));
    const isNearHigh = price >= localHigh * 0.9995;
    const isNearLow = price <= localLow * 1.0005;

    // 4. Candle Strength (Filter)
    const currentOpen = priceHistory[priceHistory.length - 1].open;
    const candleBody = Math.abs(price - currentOpen);
    const candleStrength = candleBody / currentOpen;
    const isStrongCandle = candleStrength >= (cfg.minCandleStrength || 0.0005);

    // 5. Distance Filter
    const distanceFromFastMA = Math.abs(price - currentHmaFast) / currentHmaFast;
    const isTooFar = distanceFromFastMA > (cfg.distanceFilter || 0.01);

    // Update indicators for dashboard
    this.indicators.hmaFast = currentHmaFast;
    this.indicators.hmaSlow = currentHmaSlow;
    this.indicators.macd = macdCurrent;

    let type: 'BUY' | 'SELL' | null = null;
    let reasons: string[] = [];
    let score = 0;

    // BUY LOGIC
    const hmaCrossUp = prevHmaFast <= prevHmaSlow && currentHmaFast > currentHmaSlow;
    const macdCrossUp = macdPrev.macd <= macdPrev.signal && macdCurrent.macd > macdCurrent.signal;
    const macdHistPositive = macdCurrent.histogram > 0;

    if (hmaCrossUp && macdCrossUp && macdHistPositive) {
      if (isTooFar) return { signal: null, reason: 'Price too far from HMA' };
      if (!isStrongCandle) return { signal: null, reason: 'Candle too weak' };

      type = 'BUY';
      score = 2;
      reasons.push('HMA Cross Up', 'MACD Cross Up', 'MACD Histogram Positive');
      if (isNearLow) {
        score += 1;
        reasons.push('Near Local Low');
      }
    }

    // SELL LOGIC
    const hmaCrossDown = prevHmaFast >= prevHmaSlow && currentHmaFast < currentHmaSlow;
    const macdCrossDown = macdPrev.macd >= macdPrev.signal && macdCurrent.macd < macdCurrent.signal;
    const macdHistNegative = macdCurrent.histogram < 0;

    if (hmaCrossDown && macdCrossDown && macdHistNegative) {
      if (isTooFar) return { signal: null, reason: 'Price too far from HMA' };
      if (!isStrongCandle) return { signal: null, reason: 'Candle too weak' };

      type = 'SELL';
      score = 2;
      reasons.push('HMA Cross Down', 'MACD Cross Down', 'MACD Histogram Negative');
      if (isNearHigh) {
        score += 1;
        reasons.push('Near Local High');
      }
    }

    // EXIT LOGIC (For open positions)
    // This is handled by the bot's checkExitConditions which calls analyze with dryRun=true usually,
    // but we can also return an EXIT signal if needed.
    // However, the bot usually handles SL/TP and strategy-based exit separately.

    if (type && score >= effectiveMinScore) {
      return {
        signal: {
          type,
          price,
          score,
          reasons,
          timestamp: Date.now()
        }
      };
    }

    return { signal: null, reason: 'No HMA-MACD criteria met' };
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

  calculateBollingerBands(prices: number[], period: number = 20, multiplier: number = 2) {
    if (prices.length < period) return null;
    const mid = this.calculateSMA(prices, period);
    const slice = prices.slice(-period);
    const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
      upper: mid + multiplier * stdDev,
      lower: mid - multiplier * stdDev,
      mid
    };
  }

  detectPatterns(bars: any[]) {
    if (bars.length < 2) return [];
    const patterns = [];
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];

    const lastOpen = last.open ?? last.price;
    const lastClose = last.price;
    const lastHigh = last.high ?? last.price;
    const lastLow = last.low ?? last.price;

    const prevOpen = prev.open ?? prev.price;
    const prevClose = prev.price;

    const lastBody = Math.abs(lastClose - lastOpen);
    const prevBody = Math.abs(prevClose - prevOpen);

    // Bullish Engulfing
    if (prevClose < prevOpen && lastClose > lastOpen && lastClose > prevOpen && lastOpen < prevClose) {
      patterns.push({ name: 'Bullish Engulfing', type: 'BULLISH' });
    }

    // Bearish Engulfing
    if (prevClose > prevOpen && lastClose < lastOpen && lastClose < prevOpen && lastOpen > prevClose) {
      patterns.push({ name: 'Bearish Engulfing', type: 'BEARISH' });
    }

    // Pin Bar
    const totalRange = lastHigh - lastLow;
    const upperWick = lastHigh - Math.max(lastOpen, lastClose);
    const lowerWick = Math.min(lastOpen, lastClose) - lastLow;

    if (totalRange > 0) {
      if (lowerWick > totalRange * 0.6 && lastBody < totalRange * 0.3) {
        patterns.push({ name: 'Bullish Pin Bar', type: 'BULLISH' });
      }
      if (upperWick > totalRange * 0.6 && lastBody < totalRange * 0.3) {
        patterns.push({ name: 'Bearish Pin Bar', type: 'BEARISH' });
      }
    }

    return patterns;
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
  applyHighQualityFilters(type: 'BUY' | 'SELL' | null, currentPrice: number, score: number) {
    if (!this.highQualityMode || !type) return { filtered: false };

    const rsi = this.indicators.rsi || 50;
    const adx = this.indicators.adx || 0;
    const atr = this.indicators.atr || 0;
    const atrPercent = (atr / currentPrice) * 100;

    // 1. Trend Strength Filter (ADX > 25)
    if (adx < 25) return { filtered: true, reason: 'HQ Mode: Trend too weak (ADX < 25)' };

    // 2. RSI Extreme Filter
    if (type === 'BUY' && rsi > 45) return { filtered: true, reason: 'HQ Mode: RSI not oversold enough for BUY' };
    if (type === 'SELL' && rsi < 55) return { filtered: true, reason: 'HQ Mode: RSI not overbought enough for SELL' };

    // 3. Volatility Filter (ATR must be significant)
    if (atrPercent < 0.015) return { filtered: true, reason: 'HQ Mode: Volatility too low (ATR < 1.5%)' };

    return { filtered: false };
  }

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
    
    // Multiple TPs
    let tp2 = isBuy ? price + (tpDist * 1.8) : price - (tpDist * 1.8);
    let tp3 = isBuy ? price + (tpDist * 3.0) : price - (tpDist * 3.0);

    // Final safety fallback
    const minRequiredDist = (market.tickSize || 1) * 10;
    if (isNaN(sl) || sl === 0) sl = isBuy ? price - minRequiredDist : price + minRequiredDist;
    if (isNaN(tp1) || tp1 === 0) tp1 = isBuy ? price + minRequiredDist : price - minRequiredDist;
    if (isNaN(tp2) || tp2 === 0) tp2 = isBuy ? price + (minRequiredDist * 2) : price - (minRequiredDist * 2);
    if (isNaN(tp3) || tp3 === 0) tp3 = isBuy ? price + (minRequiredDist * 4) : price - (minRequiredDist * 4);

    // Ensure they are not too close to entry (at least 5 ticks)
    const minTicks = (market.tickSize || 1) * 5;
    if (isBuy) {
      if (sl >= price - minTicks) sl = price - minTicks;
      if (tp1 <= price + minTicks) tp1 = price + minTicks;
    } else {
      if (sl <= price + minTicks) sl = price + minTicks;
      if (tp1 >= price - minTicks) tp1 = price - minTicks;
    }

    return {
      type,
      entry: price,
      sl: Math.round(sl),
      tp1: Math.round(tp1),
      tp2: Math.round(tp2),
      tp3: Math.round(tp3),
      score,
      strength: score >= 5 ? 'STRONG' : (score >= 3 ? 'NORMAL' : 'WEAK'),
      reasons,
      confidence: 50 + (score * 15),
      timestamp: Date.now(),
      strategy: strategyName,
      pattern: null as string | null,
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
    this.indicators.adx = this.calculateADX(highs, lows, closes, 14);
    this.indicators.macd = this.calculateMACD(closes, 12, 26, 9);
    this.indicators.bb = this.calculateBollingerBands(closes, 20, 2);
    
    const stoch = this.calculateStochastic(highs, lows, closes, 14, 3, 3);
    this.indicators.stochK = stoch.k;
    this.indicators.stochD = stoch.d;
    
    this.indicators.volSMA = this.calculateSMA(volumes, 20);
    
    if (cfg.ema?.enabled !== false) {
      this.indicators.emaFast = this.calculateEMA(closes, cfg.ema?.fast || 9);
      this.indicators.emaSlow = this.calculateEMA(closes, cfg.ema?.slow || 21);
    }
  }

  calculateStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number = 14, dPeriod: number = 3, slowing: number = 3) {
    if (closes.length < kPeriod + slowing + dPeriod) return { k: 50, d: 50 };
    
    const kValues: number[] = [];
    
    for (let i = closes.length - (dPeriod + slowing); i < closes.length; i++) {
      const sliceHighs = highs.slice(i - kPeriod + 1, i + 1);
      const sliceLows = lows.slice(i - kPeriod + 1, i + 1);
      
      const highestHigh = Math.max(...sliceHighs);
      const lowestLow = Math.min(...sliceLows);
      
      if (highestHigh === lowestLow) {
        kValues.push(50);
      } else {
        const k = ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
        kValues.push(k);
      }
    }
    
    // Smooth K
    const smoothedK = this.calculateSMA(kValues, slowing);
    
    // Calculate D (SMA of smoothed K)
    // For simplicity in this implementation, we'll just return the last smoothed K and its SMA
    const dValues: number[] = [];
    for (let i = kValues.length - dPeriod; i <= kValues.length; i++) {
        if (i < slowing) continue;
        dValues.push(this.calculateSMA(kValues.slice(0, i), slowing));
    }
    
    const k = smoothedK;
    const d = this.calculateSMA(dValues, dPeriod);
    
    return { k, d };
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
    if (closes.length < period + 1) return [];
    
    const st: { value: number, direction: number }[] = [];
    
    // Calculate True Range
    const trs: number[] = [0];
    for (let i = 1; i < closes.length; i++) {
      const h = highs[i];
      const l = lows[i];
      const pc = closes[i - 1];
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }

    // Calculate ATR using RMA (Smoothed Moving Average)
    const atrs: number[] = new Array(closes.length).fill(0);
    let sumTr = 0;
    for (let i = 1; i <= period; i++) sumTr += trs[i];
    atrs[period] = sumTr / period;

    for (let i = period + 1; i < closes.length; i++) {
      atrs[i] = (atrs[i - 1] * (period - 1) + trs[i]) / period;
    }

    let prevFinalUpperBand = 0;
    let prevFinalLowerBand = 0;
    let prevDirection = 1;
    
    for (let i = period; i < closes.length; i++) {
      const currentClose = closes[i];
      const prevClose = closes[i - 1];
      const atr = atrs[i];
      
      const basicUpperBand = ((highs[i] + lows[i]) / 2) + (multiplier * atr);
      const basicLowerBand = ((highs[i] + lows[i]) / 2) - (multiplier * atr);
      
      let finalUpperBand = basicUpperBand;
      let finalLowerBand = basicLowerBand;
      
      if (i > period) {
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

  // ==========================================
  // HELPER: Aggregate 1m to 5m
  // ==========================================
  aggregateTo5Min(priceHistory1min: any[]) {
    const history5min: any[] = [];
    let current5MinBar: any = null;
    
    for (const bar of priceHistory1min) {
      const time = bar.time || Date.now();
      const time5min = Math.floor(time / (5 * 60 * 1000)) * (5 * 60 * 1000);
      
      if (!current5MinBar || current5MinBar.time !== time5min) {
        if (current5MinBar) history5min.push(current5MinBar);
        current5MinBar = {
          time: time5min,
          open: bar.open ?? bar.price,
          high: bar.high ?? bar.price,
          low: bar.low ?? bar.price,
          close: bar.price,
          price: bar.price,
          volume: bar.volume || 0
        };
      } else {
        current5MinBar.high = Math.max(current5MinBar.high, bar.high ?? bar.price);
        current5MinBar.low = Math.min(current5MinBar.low, bar.low ?? bar.price);
        current5MinBar.close = bar.price;
        current5MinBar.price = bar.price;
        current5MinBar.volume += (bar.volume || 0);
      }
    }
    if (current5MinBar) history5min.push(current5MinBar);
    return history5min;
  }

  // ==========================================
  // HELPER: Aggregate 1m to 15m
  // ==========================================
  aggregateTo15Min(priceHistory1min: any[]) {
    const history15min: any[] = [];
    let current15MinBar: any = null;
    
    for (const bar of priceHistory1min) {
      const time = bar.time || Date.now();
      const time15min = Math.floor(time / (15 * 60 * 1000)) * (15 * 60 * 1000);
      
      if (!current15MinBar || current15MinBar.time !== time15min) {
        if (current15MinBar) history15min.push(current15MinBar);
        current15MinBar = {
          time: time15min,
          open: bar.open ?? bar.price,
          high: bar.high ?? bar.price,
          low: bar.low ?? bar.price,
          close: bar.price,
          price: bar.price,
          volume: bar.volume || 0
        };
      } else {
        current15MinBar.high = Math.max(current15MinBar.high, bar.high ?? bar.price);
        current15MinBar.low = Math.min(current15MinBar.low, bar.low ?? bar.price);
        current15MinBar.close = bar.price;
        current15MinBar.price = bar.price;
        current15MinBar.volume += (bar.volume || 0);
      }
    }
    if (current15MinBar) history15min.push(current15MinBar);
    return history15min;
  }

  // ==========================================
  // 7. PIN BAR STRATEGY (Price Action Reversal)
  // ==========================================
  analyzePinBar(priceHistory: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
      const closes = priceHistory.map(p => p.price);
      const highs = priceHistory.map(p => p.high ?? p.price);
      const lows = priceHistory.map(p => p.low ?? p.price);
      const opens = priceHistory.map(p => p.open ?? p.price);
      
      const price = currentPrice || closes[closes.length - 1];
      
      const pinCfg = this.config.strategy?.pinbar || {
          bodyRatio: 0.4,
          wickRatio: 2.5,
          requireTrend: true,
          trendPeriod: 10,
          confirmationRequired: false,
          maxSlippageTicks: 2,
          useVolumeFilter: false,
          minVolumeRatio: 1.5
      };

      if (priceHistory.length < pinCfg.trendPeriod + 5) {
          return { signal: null, reason: 'Not enough data for Pin Bar' };
      }

      const atr = this.calculateATR(highs, lows, closes, 14);
      const volumeMA = this.calculateSMA(priceHistory.map(p => p.volume || 0), 10);
      const lastVolume = priceHistory[priceHistory.length - 1]?.volume || 0;
      const trend = this.detectTrend(closes, pinCfg.trendPeriod);
      
      let type: 'BUY' | 'SELL' | null = null;
      let reasons = [];
      let score = 0;
      let patternName = '';
      let entryPrice = price;
      let sl = 0;
      let tp = 0;

      const lastCandle = {
          open: opens[opens.length - 1],
          high: highs[highs.length - 1],
          low: lows[lows.length - 1],
          close: closes[closes.length - 1]
      };

      const candleRange = lastCandle.high - lastCandle.low;
      const bodySize = Math.abs(lastCandle.close - lastCandle.open);
      const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
      const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
      const bodyToRangeRatio = bodySize / (candleRange || 1);
      const volumeOk = !pinCfg.useVolumeFilter || (lastVolume >= volumeMA * pinCfg.minVolumeRatio);

      // Bullish Pin Bar
      if (bodyToRangeRatio <= pinCfg.bodyRatio && volumeOk) {
          if (lowerWick > bodySize * pinCfg.wickRatio && upperWick <= bodySize * 0.3) {
              if (!pinCfg.requireTrend || trend.direction === 'DOWN') {
                  type = 'BUY';
                  patternName = 'Bullish Pin Bar';
                  score = 2;
                  reasons.push('Long lower wick', 'Small body');
                  
                  if (trend.direction === 'DOWN') {
                      score += 1;
                      reasons.push('Prior downtrend');
                  }
                  if (lowerWick > bodySize * 4) {
                      score += 1;
                      reasons.push('Very long wick');
                  }
                  if (lastCandle.close > lastCandle.open) {
                      score += 1;
                      reasons.push('Bullish close');
                  }
                  
                  sl = lastCandle.low - (pinCfg.maxSlippageTicks * (this.config.market?.tickSize || 1));
                  const risk = Math.abs(price - sl);
                  tp = price + (risk * (this.config.strategy?.quant?.riskRewardRatio || 2));
                  entryPrice = Math.min(price, lastCandle.close + (pinCfg.maxSlippageTicks * (this.config.market?.tickSize || 1)));
              }
          }
      }
      
      // Bearish Pin Bar
      if (!type && bodyToRangeRatio <= pinCfg.bodyRatio && volumeOk) {
          if (upperWick > bodySize * pinCfg.wickRatio && lowerWick <= bodySize * 0.3) {
              if (!pinCfg.requireTrend || trend.direction === 'UP') {
                  type = 'SELL';
                  patternName = 'Bearish Pin Bar';
                  score = 2;
                  reasons.push('Long upper wick', 'Small body');
                  
                  if (trend.direction === 'UP') {
                      score += 1;
                      reasons.push('Prior uptrend');
                  }
                  if (upperWick > bodySize * 4) {
                      score += 1;
                      reasons.push('Very long wick');
                  }
                  if (lastCandle.close < lastCandle.open) {
                      score += 1;
                      reasons.push('Bearish close');
                  }
                  
                  sl = lastCandle.high + (pinCfg.maxSlippageTicks * (this.config.market?.tickSize || 1));
                  const risk = Math.abs(sl - price);
                  tp = price - (risk * (this.config.strategy?.quant?.riskRewardRatio || 2));
                  entryPrice = Math.max(price, lastCandle.close - (pinCfg.maxSlippageTicks * (this.config.market?.tickSize || 1)));
              }
          }
      }

      if (!type || score < (this.minSignalScore || 2)) {
          return { signal: null, reason: `Pin bar score too low: ${score}` };
      }

      // Additional High Quality Filters
      const hqResult = this.applyHighQualityFilters(type, price, score);
      if (hqResult.filtered) return { signal: null, reason: hqResult.reason };

      const signal = {
          type,
          entry: Math.round(entryPrice),
          sl: Math.round(sl),
          tp1: Math.round(tp),
          score,
          reasons,
          confidence: Math.min(100, 50 + (score * 12)),
          timestamp: Date.now(),
          pattern: patternName,
          strategy: 'PINBAR',
          indicators: {
              bodyRatio: bodyToRangeRatio.toFixed(2),
              upperWick: upperWick.toFixed(0),
              lowerWick: lowerWick.toFixed(0),
              trend: trend.direction,
              atr: atr.toFixed(0),
              volume: lastVolume > volumeMA ? 'HIGH' : 'NORMAL'
          },
          entryZone: {
              from: type === 'BUY' ? lastCandle.low : lastCandle.high - (pinCfg.maxSlippageTicks * (this.config.market?.tickSize || 1)),
              to: type === 'BUY' ? lastCandle.close + (pinCfg.maxSlippageTicks * (this.config.market?.tickSize || 1)) : lastCandle.close - (pinCfg.maxSlippageTicks * (this.config.market?.tickSize || 1))
          }
      };

      return { signal, reason: 'Pin bar detected' };
  }

  // ==========================================
  // 8. MTF SUPPORT/RESISTANCE + CANDLE PATTERNS
  // ==========================================
  analyzeMTFPatterns(priceHistory5min: any[], priceHistory1min: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
      const mtfCfg = this.config.strategy?.mtfPattern || {
          proximityThreshold: 50,
          swingLeftRight: 2,
          clusterBinSize: 10
      };

      const supports = [];
      const resistances = [];
      
      const highs5 = priceHistory5min.map(p => p.high ?? p.price);
      const lows5 = priceHistory5min.map(p => p.low ?? p.price);
      const closes5 = priceHistory5min.map(p => p.price);
      
      const swingPoints = this.findSwingPoints(highs5, lows5, mtfCfg.swingLeftRight || 2);
      const priceClusters = this.findPriceClusters(priceHistory5min, mtfCfg.clusterBinSize || 10);
      const roundLevels = this.findRoundLevels(currentPrice, 1000);
      
      const allLevels = [
          ...swingPoints.supportLevels.map(price => ({ price, type: 'Swing Low', strength: 2 })),
          ...swingPoints.resistanceLevels.map(price => ({ price, type: 'Swing High', strength: 2 })),
          ...priceClusters.map(cluster => ({ price: cluster.price, type: 'Cluster', strength: cluster.strength })),
          ...roundLevels.map(price => ({ price, type: 'Round Number', strength: 1.5 }))
      ];
      
      const mergedLevels = this.mergeNearbyLevels(allLevels, 50);
      const sortedLevels = mergedLevels.sort((a, b) => a.price - b.price);
      const patterns = this.detectCandlePatterns(priceHistory1min);
      
      const currentPrice1min = currentPrice || priceHistory1min[priceHistory1min.length - 1]?.price;
      const tickSize = this.config.market?.tickSize || 1;
      const proximityThreshold = mtfCfg.proximityThreshold || 50;
      
      let bestSignal: any = null;
      let bestScore = 0;
      
      for (const level of sortedLevels) {
          const distance = Math.abs(currentPrice1min - level.price);
          
          if (distance <= proximityThreshold) {
              if (currentPrice1min >= level.price - proximityThreshold && 
                  currentPrice1min <= level.price + proximityThreshold) {

                  if (this.isSupportLevel(level, currentPrice1min)) {
                      const bullishPatterns = this.findBullishPatterns(patterns, priceHistory1min);
                      
                      for (const pattern of bullishPatterns) {
                          const signalScore = this.calculateSignalScore(level, pattern, 'BUY', currentPrice1min);
                          
                          if (signalScore > bestScore) {
                              bestScore = signalScore;
                              bestSignal = {
                                  type: 'BUY',
                                  entry: currentPrice1min,
                                  level: level.price,
                                  pattern: pattern,
                                  score: signalScore,
                                  reasons: [
                                      `Support at ${level.price} (${level.type})`,
                                      `Bullish ${pattern.name} at 1min`,
                                      ...pattern.reasons
                                  ],
                                  sl: level.price - (tickSize * 15),
                                  tp1: this.calculateTP(level, 'BUY', currentPrice1min),
                                  confidence: Math.min(100, 60 + (signalScore * 5))
                              };
                          }
                      }
                  }
                  
                  if (this.isResistanceLevel(level, currentPrice1min)) {
                      const bearishPatterns = this.findBearishPatterns(patterns, priceHistory1min);
                      
                      for (const pattern of bearishPatterns) {
                          const signalScore = this.calculateSignalScore(level, pattern, 'SELL', currentPrice1min);
                          
                          if (signalScore > bestScore) {
                              bestScore = signalScore;
                              bestSignal = {
                                  type: 'SELL',
                                  entry: currentPrice1min,
                                  level: level.price,
                                  pattern: pattern,
                                  score: signalScore,
                                  reasons: [
                                      `Resistance at ${level.price} (${level.type})`,
                                      `Bearish ${pattern.name} at 1min`,
                                      ...pattern.reasons
                                  ],
                                  sl: level.price + (tickSize * 15),
                                  tp1: this.calculateTP(level, 'SELL', currentPrice1min),
                                  confidence: Math.min(100, 60 + (signalScore * 5))
                              };
                          }
                      }
                  }
              }
          }
      }
      
      if (!bestSignal || bestScore < 3) {
          return { signal: null, reason: 'No strong signal at key levels' };
      }
      
      // Additional High Quality Filters
      const hqResult = this.applyHighQualityFilters(bestSignal.type, currentPrice1min, bestScore);
      if (hqResult.filtered) return { signal: null, reason: hqResult.reason };

      return {
          signal: {
              ...bestSignal,
              timestamp: Date.now(),
              strategy: 'MTF_PATTERN',
              indicators: {
                  nearestLevel: bestSignal.level,
                  levelType: bestSignal.level.type,
                  patternName: bestSignal.pattern.name,
                  supportLevels: supports.slice(-3).map(s => s.price),
                  resistanceLevels: resistances.slice(-3).map(r => r.price)
              }
          },
          reason: 'Pattern at key level detected'
      };
  }

  // ==========================================
  // 9. ICHIMOKU CLOUD + S/R + CANDLE PATTERNS
  // ==========================================
  analyzeIchimokuMTF(priceHistory5min: any[], priceHistory1min: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
      const ichiCfg = this.config.strategy?.ichimokuMtf || {
          proximityThreshold: 40,
          swingLeftRight: 3,
          clusterBinSize: 20,
          tenkanPeriod: 9,
          kijunPeriod: 26,
          senkouBPeriod: 52
      };

      const ichimoku = this.calculateIchimoku(
          priceHistory5min, 
          ichiCfg.tenkanPeriod || 9, 
          ichiCfg.kijunPeriod || 26, 
          ichiCfg.senkouBPeriod || 52
      );
      if (!ichimoku) return { signal: null, reason: 'Ichimoku data not ready' };

      const closes5 = priceHistory5min.map(p => p.price);
      const highs5 = priceHistory5min.map(p => p.high ?? p.price);
      const lows5 = priceHistory5min.map(p => p.low ?? p.price);
      const currentPrice5 = closes5[closes5.length - 1];
      
      const keyLevels = [];
      
      keyLevels.push(
          { price: ichimoku.kijun, type: 'Kijun-sen', strength: 4, description: 'Base Line - Dynamic S/R' },
          { price: ichimoku.tenkan, type: 'Tenkan-sen', strength: 3, description: 'Conversion Line - Short-term momentum' },
          { price: ichimoku.senkouA, type: 'Senkou Span A', strength: 4, description: 'Cloud Edge - Major Support/Resistance' },
          { price: ichimoku.senkouB, type: 'Senkou Span B', strength: 5, description: 'Cloud Edge - Strong Support/Resistance' },
          { price: ichimoku.chikou, type: 'Chikou Span', strength: 3, description: 'Lagging Line - Confirmation' }
      );
      
      const swingPoints = this.findSwingPoints(highs5, lows5, ichiCfg.swingLeftRight || 3);
      const priceClusters = this.findPriceClusters(priceHistory5min, ichiCfg.clusterBinSize || 20);
      const roundLevels = this.findRoundLevels(currentPrice5, 1000);
      
      const allLevels = [
          ...keyLevels,
          ...swingPoints.supportLevels.map(price => ({ price, type: 'Swing Low', strength: 2 })),
          ...swingPoints.resistanceLevels.map(price => ({ price, type: 'Swing High', strength: 2 })),
          ...priceClusters,
          ...roundLevels.map(price => ({ price, type: 'Round Number', strength: 1.5 }))
      ];
      
      const mergedLevels = this.mergeNearbyLevels(allLevels, 30);
      const patterns = this.detectCandlePatterns(priceHistory1min);
      const trendAnalysis = this.analyzeIchimokuTrend(ichimoku, currentPrice5, priceHistory5min);
      
      const currentPrice1min = currentPrice || priceHistory1min[priceHistory1min.length - 1]?.price;
      const tickSize = this.config.market?.tickSize || 1;
      const proximityThreshold = ichiCfg.proximityThreshold || 40;
      
      let bestSignal: any = null;
      let bestScore = 0;
      
      for (const level of mergedLevels) {
          const distance = Math.abs(currentPrice1min - level.price);
          
          if (distance <= proximityThreshold) {
              const isSupport = this.isIchimokuSupport(level, currentPrice1min, trendAnalysis);
              const isResistance = this.isIchimokuResistance(level, currentPrice1min, trendAnalysis);
              
              if (isSupport) {
                  const bullishPatterns = this.findBullishPatterns(patterns, priceHistory1min);
                  
                  for (const pattern of bullishPatterns) {
                      const signalScore = this.calculateIchimokuScore(
                          level, pattern, 'BUY', trendAnalysis, distance
                      );
                      
                      if (signalScore > bestScore) {
                          bestScore = signalScore;
                          bestSignal = this.createIchimokuSignal(
                              'BUY', level, pattern, currentPrice1min, 
                              trendAnalysis, signalScore, distance
                          );
                      }
                  }
              }
              
              if (isResistance) {
                  const bearishPatterns = this.findBearishPatterns(patterns, priceHistory1min);
                  
                  for (const pattern of bearishPatterns) {
                      const signalScore = this.calculateIchimokuScore(
                          level, pattern, 'SELL', trendAnalysis, distance
                      );
                      
                      if (signalScore > bestScore) {
                          bestScore = signalScore;
                          bestSignal = this.createIchimokuSignal(
                              'SELL', level, pattern, currentPrice1min, 
                              trendAnalysis, signalScore, distance
                          );
                      }
                  }
              }
          }
      }
      
      if (!bestSignal || bestScore < 4) {
          return { 
              signal: null, 
              reason: `No strong signal at Ichimoku levels. Best score: ${bestScore}`,
              trend: trendAnalysis?.summary
          };
      }
      
      return bestSignal;
  }

  // ==========================================
  // 10. ICHIMOKU + HARAMI + S/R (Black Cloud & Harami)
  // ==========================================
  analyzeIchimokuHaramiMTF(priceHistory5min: any[], priceHistory1min: any[], currentPrice: number, effectiveMinScore: number = this.minSignalScore) {
      const haramiCfg = this.config.strategy?.ichimokuHarami || {
          proximityThreshold: 40,
          minScore: 8,
          tenkanPeriod: 9,
          kijunPeriod: 26,
          senkouBPeriod: 52
      };

      const ichimoku = this.calculateIchimoku(
          priceHistory5min,
          haramiCfg.tenkanPeriod || 9,
          haramiCfg.kijunPeriod || 26,
          haramiCfg.senkouBPeriod || 52
      );
      if (!ichimoku) {
          return { signal: null, reason: 'Ichimoku data not ready' };
      }
      
      const keyLevels = this.identifyKeyLevels(priceHistory5min, ichimoku);
      const haramiPatterns = this.detectHaramiPatterns(priceHistory1min);
      const piercingPatterns = this.detectPiercingPatterns(priceHistory1min);
      const darkCloudPatterns = this.detectDarkCloudPatterns(priceHistory1min);
      const trendAnalysis = this.analyzeIchimokuTrend(ichimoku, currentPrice, priceHistory5min);
      
      const currentPrice1min = currentPrice || priceHistory1min[priceHistory1min.length - 1]?.price;
      const tickSize = this.config.market?.tickSize || 1;
      const proximityThreshold = haramiCfg.proximityThreshold || 40;
      
      let signals = [];
      
      for (const level of keyLevels) {
          const distance = Math.abs(currentPrice1min - level.price);
          
          if (distance <= proximityThreshold) {
              const isSupport = this.isIchimokuSupport(level, currentPrice1min, trendAnalysis);
              const isResistance = this.isIchimokuResistance(level, currentPrice1min, trendAnalysis);
              
              for (const harami of haramiPatterns) {
                  if (isSupport && harami.type === 'BULLISH') {
                      const signal = this.createHaramiSignal(
                          'BUY', level, harami, currentPrice1min, 
                          trendAnalysis, distance
                      );
                      signals.push(signal);
                  }
                  
                  if (isResistance && harami.type === 'BEARISH') {
                      const signal = this.createHaramiSignal(
                          'SELL', level, harami, currentPrice1min, 
                          trendAnalysis, distance
                      );
                      signals.push(signal);
                  }
              }
              
              if (isSupport) {
                  for (const piercing of piercingPatterns) {
                      const signal = this.createPiercingSignal(
                          'BUY', level, piercing, currentPrice1min,
                          trendAnalysis, distance
                      );
                      signals.push(signal);
                  }
              }
              
              if (isResistance) {
                  for (const darkCloud of darkCloudPatterns) {
                      const signal = this.createDarkCloudSignal(
                          'SELL', level, darkCloud, currentPrice1min,
                          trendAnalysis, distance
                      );
                      signals.push(signal);
                  }
              }
          }
      }
      
      if (signals.length === 0) {
          return { 
              signal: null, 
              reason: 'No pattern at key levels',
              trend: trendAnalysis?.summary
          };
      }
      
      signals.sort((a, b) => b.score - a.score);
      const bestSignal = signals[0];
      
      if (bestSignal.score < (haramiCfg.minScore || 8)) {
          return {
              signal: null,
              reason: `Signal score too low: ${bestSignal.score}`,
              bestSignal: bestSignal
          };
      }
      
      return bestSignal;
  }

  // ==========================================
  // توابع کمکی ایچیموکو
  // ==========================================

  calculateIchimoku(priceHistory: any[], tenkanPeriod: number = 9, kijunPeriod: number = 26, senkouBPeriod: number = 52) {
      if (priceHistory.length < Math.max(tenkanPeriod, kijunPeriod, senkouBPeriod)) {
          return null;
      }
      
      const highs = priceHistory.map(p => p.high ?? p.price);
      const lows = priceHistory.map(p => p.low ?? p.price);
      const closes = priceHistory.map(p => p.price);
      
      const tenkanHigh = Math.max(...highs.slice(-tenkanPeriod));
      const tenkanLow = Math.min(...lows.slice(-tenkanPeriod));
      const tenkan = (tenkanHigh + tenkanLow) / 2;
      
      const kijunHigh = Math.max(...highs.slice(-kijunPeriod));
      const kijunLow = Math.min(...lows.slice(-kijunPeriod));
      const kijun = (kijunHigh + kijunLow) / 2;
      
      const senkouA = (tenkan + kijun) / 2;
      
      const senkouBHigh = Math.max(...highs.slice(-senkouBPeriod));
      const senkouBLow = Math.min(...lows.slice(-senkouBPeriod));
      const senkouB = (senkouBHigh + senkouBLow) / 2;
      
      const chikouIndex = Math.max(0, closes.length - 26);
      const chikou = closes[chikouIndex] || closes[0];
      
      const cloud = {
          top: Math.max(senkouA, senkouB),
          bottom: Math.min(senkouA, senkouB),
          color: senkouA > senkouB ? 'GREEN' : 'RED'
      };
      
      return {
          tenkan,
          kijun,
          senkouA,
          senkouB,
          chikou,
          cloud,
          tkCross: {
              value: tenkan - kijun,
              type: tenkan > kijun ? 'BULLISH' : (tenkan < kijun ? 'BEARISH' : 'NEUTRAL')
          }
      };
  }

  analyzeIchimokuTrend(ichimoku: any, currentPrice: number, priceHistory: any[]) {
      if (!ichimoku) return null;
      
      const closes = priceHistory.map(p => p.price);
      
      let priceVsCloud = 'INSIDE';
      if (currentPrice > ichimoku.cloud.top) priceVsCloud = 'ABOVE';
      else if (currentPrice < ichimoku.cloud.bottom) priceVsCloud = 'BELOW';
      
      const cloudTrend = ichimoku.cloud.color;
      const chikouVsPrice = ichimoku.chikou > currentPrice ? 'ABOVE' : 'BELOW';
      const tkTrend = ichimoku.tkCross.type;
      
      let trendScore = 5;
      let trendDirection = 'NEUTRAL';
      const reasons = [];
      
      if (priceVsCloud === 'ABOVE' && cloudTrend === 'GREEN' && tkTrend === 'BULLISH') {
          trendDirection = 'STRONG_BULLISH';
          trendScore = 9;
          reasons.push('Price above green cloud');
          reasons.push('TK Cross bullish');
      }
      else if (priceVsCloud === 'ABOVE' && cloudTrend === 'GREEN') {
          trendDirection = 'BULLISH';
          trendScore = 7;
          reasons.push('Price above green cloud');
      }
      else if (priceVsCloud === 'ABOVE' && tkTrend === 'BULLISH') {
          trendDirection = 'BULLISH';
          trendScore = 6;
          reasons.push('Price above cloud, TK bullish');
      }
      else if (priceVsCloud === 'BELOW' && cloudTrend === 'RED' && tkTrend === 'BEARISH') {
          trendDirection = 'STRONG_BEARISH';
          trendScore = 9;
          reasons.push('Price below red cloud');
          reasons.push('TK Cross bearish');
      }
      else if (priceVsCloud === 'BELOW' && cloudTrend === 'RED') {
          trendDirection = 'BEARISH';
          trendScore = 7;
          reasons.push('Price below red cloud');
      }
      else if (priceVsCloud === 'BELOW' && tkTrend === 'BEARISH') {
          trendDirection = 'BEARISH';
          trendScore = 6;
          reasons.push('Price below cloud, TK bearish');
      }
      else if (priceVsCloud === 'INSIDE') {
          trendDirection = 'NEUTRAL';
          trendScore = 4;
          reasons.push('Price inside cloud');
      }
      
      if (trendDirection.includes('BULLISH') && chikouVsPrice === 'ABOVE') {
          trendScore += 1;
          reasons.push('Chikou confirms');
      }
      else if (trendDirection.includes('BEARISH') && chikouVsPrice === 'BELOW') {
          trendScore += 1;
          reasons.push('Chikou confirms');
      }
      
      return {
          direction: trendDirection,
          score: trendScore,
          reasons,
          priceVsCloud,
          cloudTrend,
          tkTrend,
          chikouVsPrice,
          summary: `${trendDirection} (Score: ${trendScore.toFixed(1)}) - ${reasons.join(', ')}`
      };
  }

  isIchimokuSupport(level: any, currentPrice: number, trendAnalysis: any) {
      if (level.type.includes('Kijun') || level.type.includes('Tenkan') || 
          level.type.includes('Senkou')) {
          
          if (trendAnalysis?.direction.includes('BULLISH')) {
              return currentPrice >= level.price - 10;
          }
          
          if (trendAnalysis?.direction.includes('BEARISH')) {
              return false;
          }
      }
      
      const supportTypes = ['Swing Low', 'Cluster', 'Round Number'];
      return supportTypes.includes(level.type) && currentPrice >= level.price;
  }

  isIchimokuResistance(level: any, currentPrice: number, trendAnalysis: any) {
      if (level.type.includes('Kijun') || level.type.includes('Tenkan') || 
          level.type.includes('Senkou')) {
          
          if (trendAnalysis?.direction.includes('BEARISH')) {
              return currentPrice <= level.price + 10;
          }
          
          if (trendAnalysis?.direction.includes('BULLISH')) {
              return false;
          }
      }
      
      const resistanceTypes = ['Swing High', 'Cluster', 'Round Number'];
      return resistanceTypes.includes(level.type) && currentPrice <= level.price;
  }

  calculateIchimokuScore(level: any, pattern: any, direction: string, trendAnalysis: any, distance: number) {
      let score = 0;
      
      score += level.strength * 1.5;
      score += pattern.strength * 1.2;
      
      if (direction === 'BUY' && trendAnalysis?.direction.includes('BULLISH')) {
          score += 3;
      } else if (direction === 'SELL' && trendAnalysis?.direction.includes('BEARISH')) {
          score += 3;
      } else if (direction === 'BUY' && trendAnalysis?.direction === 'NEUTRAL') {
          score += 1;
      } else if (direction === 'SELL' && trendAnalysis?.direction === 'NEUTRAL') {
          score += 1;
      }
      
      if (distance < 10) score += 3;
      else if (distance < 20) score += 2;
      else if (distance < 30) score += 1;
      
      if (level.type === 'Kijun-sen') score += 2;
      if (level.type === 'Senkou Span B') score += 2;
      if (level.type === 'Senkou Span A') score += 1;
      
      if ((direction === 'BUY' && pattern.type === 'BULLISH') ||
          (direction === 'SELL' && pattern.type === 'BEARISH')) {
          score += 2;
      }
      
      return score;
  }

  createIchimokuSignal(direction: string, level: any, pattern: any, currentPrice: number, trendAnalysis: any, score: number, distance: number) {
      const tickSize = this.config.market?.tickSize || 1;
      const atr = this.indicators.atr || currentPrice * 0.001;
      
      let slDistance = atr * 1.5;
      if (level.type.includes('Kijun') || level.type.includes('Senkou')) {
          slDistance = atr * 1.2;
      }
      
      const sl = direction === 'BUY' 
          ? Math.min(level.price - tickSize * 10, currentPrice - slDistance)
          : Math.max(level.price + tickSize * 10, currentPrice + slDistance);
      
      const risk = Math.abs(currentPrice - sl);
      const tp = direction === 'BUY' 
          ? currentPrice + (risk * 2)
          : currentPrice - (risk * 2);
      
      return {
          signal: {
              type: direction,
              entry: currentPrice,
              sl: Math.round(sl),
              tp1: Math.round(tp),
              score,
              reasons: [
                  `${level.type} at ${level.price}`,
                  `${pattern.name} on 1min`,
                  ...(trendAnalysis?.reasons || []).slice(0, 2),
                  ...pattern.reasons
              ],
              confidence: Math.min(100, 60 + (score * 3)),
              timestamp: Date.now(),
              strategy: 'ICHIMOKU_MTF',
              pattern: pattern.name,
              level: {
                  price: level.price,
                  type: level.type,
                  strength: level.strength
              },
              trend: trendAnalysis?.direction,
              distanceToLevel: distance,
              indicators: {
                  tenkan: this.indicators.tenkan,
                  kijun: this.indicators.kijun,
                  cloudTop: trendAnalysis?.cloudTop,
                  cloudBottom: trendAnalysis?.cloudBottom,
                  cloudColor: trendAnalysis?.cloudTrend
              }
          },
          reason: `Ichimoku ${level.type} + ${pattern.name}`,
          score
      };
  }

  // ==========================================
  // توابع الگوهای هارامی، نافذ و ابر سیاه
  // ==========================================

  detectHaramiPatterns(priceHistory: any[]) {
      const patterns = [];
      
      if (priceHistory.length < 2) return patterns;
      
      const candles = priceHistory.slice(-2).map(c => ({
          open: c.open ?? c.price,
          high: c.high ?? c.price,
          low: c.low ?? c.price,
          close: c.price,
          volume: c.volume || 0
      }));
      
      const [candle1, candle2] = candles;
      
      const body1 = Math.abs(candle1.close - candle1.open);
      const body2 = Math.abs(candle2.close - candle2.open);
      
      // Bullish Harami
      const isCandle1Bearish = candle1.close < candle1.open;
      const isCandle2Bullish = candle2.close > candle2.open;
      const isCandle2Inside = candle2.open > candle1.open && candle2.open < candle1.close &&
                             candle2.close > candle1.open && candle2.close < candle1.close;
      
      if (isCandle1Bearish && isCandle2Bullish && isCandle2Inside) {
          let strength = 3;
          
          if (body2 < body1 * 0.3) strength += 1;
          if (candle2.low > candle1.low + body1 * 0.1) strength += 1;
          
          patterns.push({
              name: 'Bullish Harami',
              type: 'BULLISH',
              strength: Math.min(5, strength),
              reasons: [
                  'Bullish Harami pattern',
                  'Small candle inside large bearish candle',
                  'Potential reversal'
              ],
              confirmation: {
                  requireBreak: candle1.high,
                  stopLoss: candle1.low - (candle1.high - candle1.low) * 0.1
              }
          });
      }
      
      // Bearish Harami
      const isCandle1Bullish = candle1.close > candle1.open;
      const isCandle2Bearish = candle2.close < candle2.open;
      const isCandle2InsideBearish = candle2.open < candle1.open && candle2.open > candle1.close &&
                                    candle2.close < candle1.open && candle2.close > candle1.close;
      
      if (isCandle1Bullish && isCandle2Bearish && isCandle2InsideBearish) {
          let strength = 3;
          
          if (body2 < body1 * 0.3) strength += 1;
          if (candle2.high < candle1.high - body1 * 0.1) strength += 1;
          
          patterns.push({
              name: 'Bearish Harami',
              type: 'BEARISH',
              strength: Math.min(5, strength),
              reasons: [
                  'Bearish Harami pattern',
                  'Small candle inside large bullish candle',
                  'Potential reversal'
              ],
              confirmation: {
                  requireBreak: candle1.low,
                  stopLoss: candle1.high + (candle1.high - candle1.low) * 0.1
              }
          });
      }
      
      return patterns;
  }

  detectPiercingPatterns(priceHistory: any[]) {
      const patterns = [];
      
      if (priceHistory.length < 2) return patterns;
      
      const candles = priceHistory.slice(-2).map(c => ({
          open: c.open ?? c.price,
          high: c.high ?? c.price,
          low: c.low ?? c.price,
          close: c.price
      }));
      
      const [candle1, candle2] = candles;
      
      const isCandle1Bearish = candle1.close < candle1.open;
      const isCandle2Bullish = candle2.close > candle2.open;
      const opensBelow = candle2.open < candle1.low;
      
      if (isCandle1Bearish && isCandle2Bullish && opensBelow) {
          const body1 = candle1.open - candle1.close;
          const penetration = candle2.close - candle1.close;
          
          if (penetration > body1 * 0.5) {
              let strength = 4;
              
              if (penetration > body1 * 0.7) strength += 1;
              if (candle2.close > (candle1.open + candle1.close) / 2) strength += 1;
              
              patterns.push({
                  name: 'Piercing Line',
                  type: 'BULLISH',
                  strength: Math.min(5, strength),
                  penetration: (penetration / body1 * 100).toFixed(0) + '%',
                  reasons: [
                      'Piercing line pattern',
                      `Penetrated ${(penetration / body1 * 100).toFixed(0)}% of first candle`,
                      'Strong bullish reversal'
                  ],
                  confirmation: {
                      requireBreak: candle1.open,
                      stopLoss: candle2.low - (candle2.high - candle2.low) * 0.2
                  }
              });
          }
      }
      
      return patterns;
  }

  detectDarkCloudPatterns(priceHistory: any[]) {
      const patterns = [];
      
      if (priceHistory.length < 2) return patterns;
      
      const candles = priceHistory.slice(-2).map(c => ({
          open: c.open ?? c.price,
          high: c.high ?? c.price,
          low: c.low ?? c.price,
          close: c.price
      }));
      
      const [candle1, candle2] = candles;
      
      const isCandle1Bullish = candle1.close > candle1.open;
      const isCandle2Bearish = candle2.close < candle2.open;
      const opensAbove = candle2.open > candle1.high;
      
      if (isCandle1Bullish && isCandle2Bearish && opensAbove) {
          const body1 = candle1.close - candle1.open;
          const penetration = candle1.close - candle2.close;
          
          if (penetration > body1 * 0.5) {
              let strength = 4;
              
              if (penetration > body1 * 0.7) strength += 1;
              if (candle2.close < (candle1.open + candle1.close) / 2) strength += 1;
              
              patterns.push({
                  name: 'Dark Cloud Cover',
                  type: 'BEARISH',
                  strength: Math.min(5, strength),
                  penetration: (penetration / body1 * 100).toFixed(0) + '%',
                  reasons: [
                      'Dark cloud cover pattern',
                      `Penetrated ${(penetration / body1 * 100).toFixed(0)}% of first candle`,
                      'Strong bearish reversal'
                  ],
                  confirmation: {
                      requireBreak: candle1.open,
                      stopLoss: candle2.high + (candle2.high - candle2.low) * 0.2
                  }
              });
          }
      }
      
      return patterns;
  }

  identifyKeyLevels(priceHistory: any[], ichimoku: any) {
      const highs = priceHistory.map(p => p.high ?? p.price);
      const lows = priceHistory.map(p => p.low ?? p.price);
      
      const keyLevels = [];
      
      if (ichimoku) {
          keyLevels.push(
              { price: ichimoku.kijun, type: 'Kijun-sen', strength: 4, source: 'ichimoku' },
              { price: ichimoku.tenkan, type: 'Tenkan-sen', strength: 3, source: 'ichimoku' },
              { price: ichimoku.senkouA, type: 'Senkou Span A', strength: 4, source: 'ichimoku' },
              { price: ichimoku.senkouB, type: 'Senkou Span B', strength: 5, source: 'ichimoku' }
          );
          
          keyLevels.push(
              { price: ichimoku.cloud.top, type: 'Cloud Top', strength: 4, source: 'ichimoku' },
              { price: ichimoku.cloud.bottom, type: 'Cloud Bottom', strength: 4, source: 'ichimoku' }
          );
      }
      
      const swingPoints = this.findSwingPoints(highs, lows, 3);
      swingPoints.supportLevels.forEach(price => {
          keyLevels.push({ price, type: 'Swing Low', strength: 2, source: 'classic' });
      });
      swingPoints.resistanceLevels.forEach(price => {
          keyLevels.push({ price, type: 'Swing High', strength: 2, source: 'classic' });
      });
      
      const clusters = this.findPriceClusters(priceHistory, 15);
      clusters.forEach(cluster => {
          keyLevels.push({
              price: cluster.price,
              type: 'Price Cluster',
              strength: cluster.strength,
              source: 'cluster'
          });
      });

      const lastPrice = priceHistory[priceHistory.length - 1]?.price || 0;
      const roundLevels = this.findRoundLevels(lastPrice, 1000, 5000);
      roundLevels.forEach(price => {
          keyLevels.push({ price, type: 'Round Number', strength: 1.5, source: 'round' });
      });
      
      return this.mergeNearbyLevels(keyLevels, 25);
  }

  createHaramiSignal(direction: string, level: any, pattern: any, currentPrice: number, trendAnalysis: any, distance: number) {
      const tickSize = this.config.market?.tickSize || 1;
      const atr = this.indicators.atr || currentPrice * 0.001;
      
      let score = pattern.strength * 2;
      score += level.strength * 1.5;
      
      if (direction === 'BUY' && trendAnalysis?.direction.includes('BULLISH')) score += 3;
      if (direction === 'SELL' && trendAnalysis?.direction.includes('BEARISH')) score += 3;
      
      if (distance < 15) score += 2;
      else if (distance < 25) score += 1;
      
      let sl = direction === 'BUY'
          ? Math.min(level.price - tickSize * 12, pattern.confirmation.stopLoss)
          : Math.max(level.price + tickSize * 12, pattern.confirmation.stopLoss);
      
      const risk = Math.abs(currentPrice - sl);
      const tp = direction === 'BUY'
          ? currentPrice + (risk * 2.2)
          : currentPrice - (risk * 2.2);
      
      return {
          signal: {
              type: direction,
              entry: currentPrice,
              sl: Math.round(sl),
              tp1: Math.round(tp),
              score: Math.min(20, score),
              reasons: [
                  `${level.type} at ${level.price}`,
                  pattern.name,
                  `Distance: ${distance.toFixed(0)} units`,
                  ...(trendAnalysis?.reasons || []).slice(0, 1),
                  ...pattern.reasons
              ],
              confidence: Math.min(100, 65 + (score * 1.5)),
              timestamp: Date.now(),
              strategy: 'ICHIMOKU_HARAMI',
              pattern: pattern.name,
              level: {
                  price: level.price,
                  type: level.type,
                  strength: level.strength
              },
              trend: trendAnalysis?.direction,
              confirmationLevel: pattern.confirmation.requireBreak,
              indicators: {
                  tenkan: this.indicators.tenkan,
                  kijun: this.indicators.kijun,
                  cloudColor: trendAnalysis?.cloudTrend
              }
          },
          score: score
      };
  }

  createPiercingSignal(direction: string, level: any, pattern: any, currentPrice: number, trendAnalysis: any, distance: number) {
      const tickSize = this.config.market?.tickSize || 1;
      const atr = this.indicators.atr || currentPrice * 0.001;
      
      let score = pattern.strength * 2.2;
      score += level.strength * 1.5;
      
      if (trendAnalysis?.direction.includes('BULLISH')) score += 3.5;
      
      if (distance < 20) score += 1.5;
      if (pattern.penetration > '70%') score += 1;
      
      const sl = level.price - tickSize * 15;
      const risk = Math.abs(currentPrice - sl);
      const tp = currentPrice + (risk * 2.5);
      
      return {
          signal: {
              type: 'BUY',
              entry: currentPrice,
              sl: Math.round(sl),
              tp1: Math.round(tp),
              score: Math.min(20, score),
              reasons: [
                  `${level.type} at ${level.price}`,
                  `Piercing Line (${pattern.penetration} penetration)`,
                  'Strong bullish reversal pattern',
                  ...(trendAnalysis?.reasons || []).slice(0, 1)
              ],
              confidence: Math.min(100, 70 + (score * 1.2)),
              timestamp: Date.now(),
              strategy: 'PIERCING_SR',
              pattern: 'Piercing Line',
              level: level,
              penetration: pattern.penetration
          },
          score: score
      };
  }

  createDarkCloudSignal(direction: string, level: any, pattern: any, currentPrice: number, trendAnalysis: any, distance: number) {
      const tickSize = this.config.market?.tickSize || 1;
      const atr = this.indicators.atr || currentPrice * 0.001;
      
      let score = pattern.strength * 2.2;
      score += level.strength * 1.5;
      
      if (trendAnalysis?.direction.includes('BEARISH')) score += 3.5;
      
      if (distance < 20) score += 1.5;
      if (pattern.penetration > '70%') score += 1;
      
      const sl = level.price + tickSize * 15;
      const risk = Math.abs(sl - currentPrice);
      const tp = currentPrice - (risk * 2.5);
      
      return {
          signal: {
              type: 'SELL',
              entry: currentPrice,
              sl: Math.round(sl),
              tp1: Math.round(tp),
              score: Math.min(20, score),
              reasons: [
                  `${level.type} at ${level.price}`,
                  `Dark Cloud Cover (${pattern.penetration} penetration)`,
                  'Strong bearish reversal pattern',
                  ...(trendAnalysis?.reasons || []).slice(0, 1)
              ],
              confidence: Math.min(100, 70 + (score * 1.2)),
              timestamp: Date.now(),
              strategy: 'DARKCLOUD_SR',
              pattern: 'Dark Cloud Cover',
              level: level,
              penetration: pattern.penetration
          },
          score: score
      };
  }

  // ==========================================
  // توابع کمکی عمومی
  // ==========================================

  detectTrend(prices: number[], period: number) {
      if (prices.length < period) {
          return { direction: 'NONE', strength: 0, slope: 0 };
      }
      
      const slice = prices.slice(-period);
      const sma = this.calculateSMA(slice, period)[period - 1] || slice[slice.length - 1];
      const currentPrice = slice[slice.length - 1];
      
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (let i = 0; i < period; i++) {
          sumX += i;
          sumY += slice[i];
          sumXY += i * slice[i];
          sumX2 += i * i;
      }
      
      const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
      
      let direction = 'NONE';
      if (slope > 0.1) direction = 'UP';
      else if (slope < -0.1) direction = 'DOWN';
      
      const distance = Math.abs(currentPrice - sma) / sma;
      const strength = Math.min(100, distance * 1000);
      
      return { direction, strength, slope };
  }

  findSwingPoints(highs: number[], lows: number[], leftRightBars = 2) {
      const supportLevels = [];
      const resistanceLevels = [];
      
      for (let i = leftRightBars; i < highs.length - leftRightBars; i++) {
          let isSwingHigh = true;
          for (let j = 1; j <= leftRightBars; j++) {
              if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) {
                  isSwingHigh = false;
                  break;
              }
          }
          if (isSwingHigh) {
              resistanceLevels.push(highs[i]);
          }
          
          let isSwingLow = true;
          for (let j = 1; j <= leftRightBars; j++) {
              if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) {
                  isSwingLow = false;
                  break;
              }
          }
          if (isSwingLow) {
              supportLevels.push(lows[i]);
          }
      }
      
      return { supportLevels, resistanceLevels };
  }

  findPriceClusters(priceHistory: any[], binSize = 10) {
      const clusters = [];
      const priceMap = new Map();
      
      for (const candle of priceHistory) {
          const price = candle.price;
          const bin = Math.round(price / binSize) * binSize;
          
          if (!priceMap.has(bin)) {
              priceMap.set(bin, { count: 0, touches: 0 });
          }
          
          priceMap.get(bin).count++;
          
          if (Math.abs(price - bin) <= 2) {
              priceMap.get(bin).touches++;
          }
      }
      
      for (const [price, data] of priceMap.entries()) {
          if (data.count >= 3) {
              clusters.push({
                  price,
                  strength: Math.min(5, Math.floor(data.touches / 2) + 1),
                  touches: data.touches
              });
          }
      }
      
      return clusters.sort((a, b) => b.strength - a.strength).slice(0, 10);
  }

  findRoundLevels(currentPrice: number, step = 1000, range = 5000) {
      const levels = [];
      const baseLevel = Math.round(currentPrice / step) * step;
      
      for (let i = -3; i <= 3; i++) {
          levels.push(baseLevel + (i * step));
      }
      
      return levels;
  }

  mergeNearbyLevels(levels: any[], threshold: number) {
      const merged: any[] = [];
      const sorted = levels.sort((a, b) => a.price - b.price);
      
      for (const level of sorted) {
          const existing = merged.find(m => Math.abs(m.price - level.price) <= threshold);
          
          if (existing) {
              existing.price = (existing.price + level.price) / 2;
              existing.strength = (existing.strength + level.strength) / 2;
              existing.types = [...(existing.types || [existing.type]), level.type];
          } else {
              merged.push({ ...level, types: [level.type] });
          }
      }
      
      return merged;
  }

  detectCandlePatterns(priceHistory1min: any[]) {
      const patterns = [];
      
      if (priceHistory1min.length < 5) return patterns;
      
      const candles = priceHistory1min.slice(-5).map(c => ({
          open: c.open ?? c.price,
          high: c.high ?? c.price,
          low: c.low ?? c.price,
          close: c.price
      }));
      
      const pinBar = this.detectPinBar(candles[candles.length - 1]);
      if (pinBar) patterns.push(pinBar);
      
      if (candles.length >= 2) {
          const engulfing = this.detectEngulfing(candles[candles.length - 2], candles[candles.length - 1]);
          if (engulfing) patterns.push(engulfing);
      }
      
      const doji = this.detectDoji(candles[candles.length - 1]);
      if (doji) patterns.push(doji);
      
      const hammer = this.detectHammer(candles[candles.length - 1]);
      if (hammer) patterns.push(hammer);
      
      if (candles.length >= 3) {
          const star = this.detectStarPattern(candles.slice(-3));
          if (star) patterns.push(star);
      }
      
      if (candles.length >= 2) {
          const insideBar = this.detectInsideBar(candles[candles.length - 2], candles[candles.length - 1]);
          if (insideBar) patterns.push(insideBar);
      }
      
      return patterns;
  }

  detectPinBar(candle: any) {
      const body = Math.abs(candle.close - candle.open);
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const range = candle.high - candle.low;
      
      if (range === 0) return null;
      
      const bodyRatio = body / range;
      
      if (lowerWick > body * 2.5 && upperWick < body * 0.3 && bodyRatio < 0.4) {
          return {
              name: 'Bullish Pin Bar',
              type: 'BULLISH',
              strength: 3,
              reasons: ['Long lower wick', 'Small body']
          };
      }
      
      if (upperWick > body * 2.5 && lowerWick < body * 0.3 && bodyRatio < 0.4) {
          return {
              name: 'Bearish Pin Bar',
              type: 'BEARISH',
              strength: 3,
              reasons: ['Long upper wick', 'Small body']
          };
      }
      
      return null;
  }

  detectEngulfing(prevCandle: any, currCandle: any) {
      const prevBullish = prevCandle.close > prevCandle.open;
      const prevBearish = prevCandle.close < prevCandle.open;
      
      if (prevBearish && currCandle.close > currCandle.open) {
          if (currCandle.open < prevCandle.close && currCandle.close > prevCandle.open) {
              return {
                  name: 'Bullish Engulfing',
                  type: 'BULLISH',
                  strength: 4,
                  reasons: ['Engulfed previous candle', 'Strong reversal']
              };
          }
      }
      
      if (prevBullish && currCandle.close < currCandle.open) {
          if (currCandle.open > prevCandle.close && currCandle.close < prevCandle.open) {
              return {
                  name: 'Bearish Engulfing',
                  type: 'BEARISH',
                  strength: 4,
                  reasons: ['Engulfed previous candle', 'Strong reversal']
              };
          }
      }
      
      return null;
  }

  detectDoji(candle: any) {
      const body = Math.abs(candle.close - candle.open);
      const range = candle.high - candle.low;
      
      if (range > 0 && body / range < 0.1) {
          return {
              name: 'Doji',
              type: 'NEUTRAL',
              strength: 2,
              reasons: ['Indecision', 'Potential reversal']
          };
      }
      
      return null;
  }

  detectHammer(candle: any) {
      const body = Math.abs(candle.close - candle.open);
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const range = candle.high - candle.low;
      
      if (range === 0) return null;
      
      const bodyRatio = body / range;
      
      if (lowerWick > body * 2 && upperWick < body * 0.2 && bodyRatio < 0.3) {
          return {
              name: 'Hammer',
              type: 'BULLISH',
              strength: 3,
              reasons: ['Rejection of lower prices', 'Bullish reversal']
          };
      }
      
      if (upperWick > body * 2 && lowerWick < body * 0.2 && bodyRatio < 0.3) {
          return {
              name: 'Shooting Star',
              type: 'BEARISH',
              strength: 3,
              reasons: ['Rejection of higher prices', 'Bearish reversal']
          };
      }
      
      return null;
  }

  detectStarPattern(threeCandles: any[]) {
      if (threeCandles.length < 3) return null;
      
      const [c1, c2, c3] = threeCandles;
      
      const c1Bearish = c1.close < c1.open;
      const c2Small = Math.abs(c2.close - c2.open) < (c1.high - c1.low) * 0.3;
      const c3Bullish = c3.close > c3.open && c3.close > (c1.open + c1.close) / 2;
      
      if (c1Bearish && c2Small && c3Bullish) {
          return {
              name: 'Morning Star',
              type: 'BULLISH',
              strength: 5,
              reasons: ['Three-candle reversal', 'Strong bullish signal']
          };
      }
      
      const c1Bullish = c1.close > c1.open;
      const c3Bearish = c3.close < c3.open && c3.close < (c1.open + c1.close) / 2;
      
      if (c1Bullish && c2Small && c3Bearish) {
          return {
              name: 'Evening Star',
              type: 'BEARISH',
              strength: 5,
              reasons: ['Three-candle reversal', 'Strong bearish signal']
          };
      }
      
      return null;
  }

  detectInsideBar(motherCandle: any, insideCandle: any) {
      const insideHigh = insideCandle.high <= motherCandle.high;
      const insideLow = insideCandle.low >= motherCandle.low;
      
      if (insideHigh && insideLow) {
          return {
              name: 'Inside Bar',
              type: 'NEUTRAL',
              strength: 2,
              reasons: ['Consolidation', 'Breakout pending']
          };
      }
      
      return null;
  }

  findBullishPatterns(patterns: any[], priceHistory: any[]) {
      return patterns.filter(p => p.type === 'BULLISH');
  }

  findBearishPatterns(patterns: any[], priceHistory: any[]) {
      return patterns.filter(p => p.type === 'BEARISH');
  }

  isSupportLevel(level: any, currentPrice: number) {
      const supportTypes = ['Swing Low', 'Cluster', 'Round Number'];
      return supportTypes.includes(level.type) && currentPrice >= level.price;
  }

  isResistanceLevel(level: any, currentPrice: number) {
      const resistanceTypes = ['Swing High', 'Cluster', 'Round Number'];
      return resistanceTypes.includes(level.type) && currentPrice <= level.price;
  }

  calculateSignalScore(level: any, pattern: any, direction: string, currentPrice: number) {
      let score = 0;
      
      score += level.strength || 2;
      score += pattern.strength || 2;
      
      const distance = Math.abs(currentPrice - level.price);
      if (distance < 10) score += 2;
      else if (distance < 25) score += 1;
      
      if ((direction === 'BUY' && pattern.type === 'BULLISH') ||
          (direction === 'SELL' && pattern.type === 'BEARISH')) {
          score += 2;
      }
      
      return score;
  }

  calculateTP(level: any, direction: string, entryPrice: number) {
      const tickSize = this.config.market?.tickSize || 1;
      const rr = this.config.strategy?.quant?.riskRewardRatio || 2;
      
      if (direction === 'BUY') {
          const risk = entryPrice - (level.price - tickSize * 10);
          return entryPrice + (risk * rr);
      } else {
          const risk = (level.price + tickSize * 10) - entryPrice;
          return entryPrice - (risk * rr);
      }
  }
}
