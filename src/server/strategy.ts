export class Strategy {
  config: any;
  lastSignalTime: number = 0;
  lastSignalType: string | null = null;
  lastSameSideSignalTime: number = 0;
  indicators: any = {};
  signals: any[] = [];
  minSignalScore: number;
  cooldown: number;

  constructor(config: any) {
    this.config = config;
    this.minSignalScore = config.strategy?.minSignalScore || 1;
    this.cooldown = (config.strategy?.tradeCooldown || 10) * 1000;
  }

  analyze(priceHistory: any[], openPositionsCount: number, currentPrice: number) {
    if (!Array.isArray(priceHistory) || priceHistory.length < 50) {
      return { signal: null, reason: `Waiting for data... (${priceHistory?.length || 0}/50)` };
    }

    const now = Date.now();

    if (now - this.lastSignalTime < this.cooldown) {
      return { signal: null, reason: 'Cooldown active' };
    }

    if (openPositionsCount >= (this.config.strategy?.filters?.maxPositions ?? 999)) {
      return { signal: null, reason: 'Max positions reached' };
    }

    const activeStrategy = this.config.activeStrategy || 'SCALP';
    let result: any = null;

    if (activeStrategy === 'SCALP') {
      result = this.analyzeScalp(priceHistory, currentPrice);
    } else if (activeStrategy === 'QUANT') {
      result = this.analyzeQuant(priceHistory, currentPrice);
    } else if (activeStrategy === 'TREND') {
      result = this.analyzeTrend(priceHistory, currentPrice);
    } else if (activeStrategy === 'FAST') {
      result = this.analyzeFast(priceHistory, currentPrice);
    }

    if (result?.signal) {
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

    const nearSlowForBuy = true; // Relaxed for more trades
    const nearSlowForSell = true; // Relaxed for more trades

    if (trendUp && nearSlowForBuy) {
      if (rsi <= (cfg.rsi?.oversold || 45)) {
        type = 'BUY';
        score += 2;
        reasons.push(`RSI Pullback (${rsi.toFixed(1)})`);
      }
      if (!type && rsi < 60 && momentumUp && price >= emaFast) {
        type = 'BUY';
        score += 1;
        reasons.push('Momentum Reversal');
      }
      // Aggressive EMA cross
      if (!type && emaFast > emaSlow && closes[closes.length - 2] <= emaSlow) {
        type = 'BUY';
        score += 1;
        reasons.push('EMA Cross Up');
      }
      if (type) {
        reasons.push('Trend Up (EMA Fast > Slow)');
        if (momentumUp) { score += 1; reasons.push('Green Candle'); }
      }
    } else if (trendDown && nearSlowForSell) {
      if (rsi >= (cfg.rsi?.overbought || 55)) {
        type = 'SELL';
        score += 2;
        reasons.push(`RSI Pullback (${rsi.toFixed(1)})`);
      }
      if (!type && rsi > 40 && momentumDown && price <= emaFast) {
        type = 'SELL';
        score += 1;
        reasons.push('Momentum Reversal');
      }
      // Aggressive EMA cross
      if (!type && emaFast < emaSlow && closes[closes.length - 2] >= emaSlow) {
        type = 'SELL';
        score += 1;
        reasons.push('EMA Cross Down');
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

    const qCfg = this.config.strategy?.quant || { maFast: 50, maSlow: 200, swingLength: 5, patternTolerancePct: 0.05 };
    
    const ma50 = this.calculateSMA(closes, qCfg.maFast || 50);
    const ma200 = this.calculateSMA(closes, qCfg.maSlow || 200);
    
    if (!ma50 || !ma200) return { signal: null, reason: 'MAs not ready' };

    const trendUp = ma50 > ma200;
    const trendDown = ma50 < ma200;
    
    // Find Swings
    const swings = this.findSwings(highs, lows, qCfg.swingLength || 5);
    if (swings.highs.length < 2 || swings.lows.length < 2) return { signal: null, reason: 'Not enough swings' };

    let type: 'BUY' | 'SELL' | null = null;
    let reasons: string[] = [];
    let score = 0;
    let patternName = '';
    let sl = 0;
    let tp = 0;

    const tol = (qCfg.patternTolerancePct || 0.05) / 100;
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
      if (rsi < 45 && momentum > 0) {
        type = 'BUY';
        score = 2;
        reasons.push('Fast EMA Cross', 'RSI Oversold Pullback');
      } else if (rsi < 60 && momentum > 0 && lastClose > emaFast) {
        type = 'BUY';
        score = 1;
        reasons.push('Fast Momentum');
      }
    } 
    // Aggressive Sell
    else if (price < emaFast && emaFast < emaSlow) {
      if (rsi > 55 && momentum < 0) {
        type = 'SELL';
        score = 2;
        reasons.push('Fast EMA Cross', 'RSI Overbought Pullback');
      } else if (rsi > 40 && momentum < 0 && lastClose < emaFast) {
        type = 'SELL';
        score = 1;
        reasons.push('Fast Momentum');
      }
    }

    if (!type || score < 1) return { signal: null, reason: 'No fast signal' };

    const atr = this.calculateATR(highs, lows, closes, 7);
    const signal = this.createSignal(type, price, score, reasons, atr, 'FAST');
    
    return { signal, reason: 'Fast signal OK' };
  }

  // ==========================================
  // UTILS
  // ==========================================
  createSignal(type: 'BUY' | 'SELL', price: number, score: number, reasons: string[], atr: number, strategyName: string) {
    const market = this.config.market || {};
    const tt = this.config.targetsTicks || {};

    const tickSize = Number(market.tickSize ?? 1);
    const tickValue = Number(market.tickValueToman ?? 23000);
    const spreadTicks = Number(market.spreadTicks ?? 2);

    const baseStopTicks = Number(tt.stopTicks ?? 12);
    const baseTpTicks = Number(tt.tpTicks ?? Math.round(baseStopTicks * 1.5));

    const maxRiskToman = Number(this.config.risk?.maxRiskTomanPerTrade ?? 1000000);
    const maxStopTicksByRisk = Math.max(2, Math.floor(maxRiskToman / tickValue));
    const stopTicks = Math.max(2, Math.min(baseStopTicks, maxStopTicksByRisk));
    const tpTicks = Math.max(3, baseTpTicks);

    const isBuy = type === 'BUY';
    const m = isBuy ? 1 : -1;

    const slTicks = stopTicks + spreadTicks;
    const tp1Ticks = tpTicks + spreadTicks;

    const sl = price - (slTicks * tickSize * m);
    const tp1 = price + (tp1Ticks * tickSize * m);

    return {
      type,
      entry: price,
      sl,
      tp1,
      score,
      reasons,
      confidence: 50 + (score * 15),
      timestamp: Date.now(),
      strategy: strategyName,
      indicators: {
        rsi: this.indicators.rsi?.toFixed(1),
        emaFast: this.indicators.emaFast?.toFixed(0),
        emaSlow: this.indicators.emaSlow?.toFixed(0),
        atr: this.indicators.atr?.toFixed(0),
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
    if (cfg.rsi?.enabled) this.indicators.rsi = this.calculateRSI(closes, cfg.rsi.period);
    if (cfg.ema?.enabled) {
      this.indicators.emaFast = this.calculateEMA(closes, cfg.ema.fast);
      this.indicators.emaSlow = this.calculateEMA(closes, cfg.ema.slow);
    }
    if (cfg.atr?.enabled) this.indicators.atr = this.calculateATR(highs, lows, closes, cfg.atr.period);
    else this.indicators.atr = this.calculateATR(highs, lows, closes, 14); // Default ATR
  }

  calculateRSI(prices: number[], period: number = 14) {
    if (!prices || prices.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
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
}
