export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calculateRSI(data: number[], period: number = 14): number[] {
  const rsi = new Array(data.length).fill(50);
  if (data.length <= period) return rsi;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }

    const rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
    rsi[i] = 100 - 100 / (1 + rs);
  }

  return rsi;
}

export function calculateMACD(data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);
  const signalLine = calculateEMA(macdLine, signalPeriod);
  const histogram = macdLine.map((macd, i) => macd - signalLine[i]);

  return { macdLine, signalLine, histogram };
}

export type SignalType = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export function getTradingSignal(candles: Candle[]): { signal: SignalType, confidence: number, reasons: string[] } {
  if (candles.length < 30) return { signal: 'HOLD', confidence: 0, reasons: ['Not enough data'] };

  const closes = candles.map(c => c.close);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const rsi = calculateRSI(closes, 14);
  const { histogram } = calculateMACD(closes);

  const currentEma9 = ema9[ema9.length - 1];
  const currentEma21 = ema21[ema21.length - 1];
  const currentRsi = rsi[rsi.length - 1];
  const currentHist = histogram[histogram.length - 1];
  
  const prevEma9 = ema9[ema9.length - 2];
  const prevEma21 = ema21[ema21.length - 2];

  const reasons: string[] = [];
  let score = 0;

  // Trend
  if (currentEma9 > currentEma21) {
    score += 1;
    reasons.push('EMA 9 is above EMA 21 (Uptrend)');
    if (prevEma9 <= prevEma21) {
      score += 2;
      reasons.push('Bullish EMA Crossover');
    }
  } else {
    score -= 1;
    reasons.push('EMA 9 is below EMA 21 (Downtrend)');
    if (prevEma9 >= prevEma21) {
      score -= 2;
      reasons.push('Bearish EMA Crossover');
    }
  }

  // Momentum (RSI)
  if (currentRsi < 30) {
    score += 2;
    reasons.push('RSI indicates Oversold condition');
  } else if (currentRsi < 45) {
    score += 1;
    reasons.push('RSI is in lower range');
  } else if (currentRsi > 70) {
    score -= 2;
    reasons.push('RSI indicates Overbought condition');
  } else if (currentRsi > 55) {
    score -= 1;
    reasons.push('RSI is in upper range');
  }

  // MACD
  if (currentHist > 0) {
    score += 1;
    reasons.push('MACD Histogram is positive');
  } else {
    score -= 1;
    reasons.push('MACD Histogram is negative');
  }

  let signal: SignalType = 'HOLD';
  let confidence = 0;

  if (score >= 4) {
    signal = 'STRONG_BUY';
    confidence = 90;
  } else if (score >= 2) {
    signal = 'BUY';
    confidence = 70;
  } else if (score <= -4) {
    signal = 'STRONG_SELL';
    confidence = 90;
  } else if (score <= -2) {
    signal = 'SELL';
    confidence = 70;
  } else {
    signal = 'HOLD';
    confidence = 50;
  }

  return { signal, confidence, reasons };
}
