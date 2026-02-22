import { Candle } from './strategy';

export function generateMockData(count: number = 100): Candle[] {
  const data: Candle[] = [];
  let currentPrice = 18500000; // Starting price for Mazaaneh (Toman)
  let time = Date.now() - count * 60000; // 1 minute intervals

  for (let i = 0; i < count; i++) {
    const volatility = currentPrice * 0.001; // 0.1% volatility
    const change = (Math.random() - 0.5) * volatility;
    const open = currentPrice;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.floor(Math.random() * 100) + 10;

    data.push({
      time,
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
    time += 60000;
  }

  return data;
}

export function getNextCandle(lastCandle: Candle): Candle {
  const volatility = lastCandle.close * 0.0005; // 0.05% volatility for new ticks
  const change = (Math.random() - 0.5) * volatility;
  const open = lastCandle.close;
  const close = open + change;
  const high = Math.max(open, close) + Math.random() * volatility * 0.5;
  const low = Math.min(open, close) - Math.random() * volatility * 0.5;
  const volume = Math.floor(Math.random() * 50) + 5;

  return {
    time: lastCandle.time + 60000,
    open,
    high,
    low,
    close,
    volume,
  };
}
