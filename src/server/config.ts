export const config = {
  // ==========================================
  // 🔐 Authentication
  // ==========================================
  auth: {
    csrftoken: process.env.FARAZGOLD_CSRF || 'GTiZlvd8jNoMuko3nkjjU0lhC8m6Yy3m',
    sessionid: process.env.FARAZGOLD_SESSION || 'njmnqc7hfkeyayowprwheqc73lvp98as',
    baseUrl: process.env.FARAZGOLD_BASEURL || 'https://demo.farazgold.com',
    wsUrl: process.env.FARAZGOLD_WSURL || 'wss://demo.farazgold.com/ws/',
    wsAutoDiscover: true,
  },

  // ==========================================
  // ⚠️ Risk Management
  // ==========================================
  risk: {
    riskPerTrade: 2,
    maxOpenPositions: 2,
    maxDailyRisk: 8, // Percent
    minBalanceToTrade: 100000,
    maxRiskTomanPerTrade: 1000000,
    maxLeverage: 1,
    stopTradingOnMaxDailyLoss: true
  },

  // ==========================================
  // 🧮 Market Settings (Tick-based)
  // ==========================================
  market: {
    tickValueToman: 23000,
    tickSize: 1,
    spreadTicks: 2
  },

  // ==========================================
  // 🧾 Trade Units
  // ==========================================
  trade: {
    minUnits: 1,
    maxUnits: 1
  },

  // ==========================================
  // 🎯 Targets & Stops (Tick-based)
  // ==========================================
  targetsTicks: {
    stopTicks: 12,
    tpTicks: 18,
    trailing: {
      enabled: true,
      activateAfterTicks: 8,
      trailTicks: 4
    },
    reversal: {
      enabled: true,
      triggerLossTicks: 6,
      minOppositeSignalScore: 2
    }
  },

  // ==========================================
  // 🎯 Targets & Stops (Legacy/Percent)
  // ==========================================
  targets: {
    tp1Percent: 0.3,
    tp2Percent: 0.6,
    tp3Percent: 1.0,
    stopLossPercent: 0.4,
    trailingStop: {
      enabled: true,
      activationPercent: 0.5,
      trailPercent: 0.2,
      aggressiveAfterTP1: true
    },
    partialClose: {
      enabled: true,
      tp1ClosePercent: 50,
      tp2ClosePercent: 30,
      tp3ClosePercent: 20
    },
    breakEven: {
      enabled: true,
      bufferTicks: 1
    }
  },

  // ==========================================
  // 🤖 Strategy Settings
  // ==========================================
  activeStrategy: 'SCALP' as 'SCALP' | 'QUANT' | 'TREND',
  strategy: {
    enabled: true,
    entry: {
      maxDistanceFromSlowEmaPercent: 0.08
    },
    tradeCooldown: 8,
    minSignalScore: 1,
    antiSpam: {
      enabled: true,
      minMinutesBetweenSameSideSignals: 1
    },
    filters: {
      maxPositions: 3,
      minVolatility: 0,
      maxVolatility: 1000,
      minAtrPercent: 0.005
    },
    indicators: {
      rsi: {
        enabled: true,
        period: 5,
        oversold: 40,
        overbought: 60
      },
      ema: {
        enabled: true,
        fast: 3,
        slow: 8
      },
      atr: {
        enabled: true,
        period: 5
      },
      volume: {
        enabled: false
      }
    },
    quant: {
      maFast: 50,
      maSlow: 200,
      riskRewardRatio: 2,
      swingLength: 5,
      patternTolerancePct: 0.05
    },
    trend: {
      maFast: 20,
      maSlow: 50,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9
    }
  },

  // ==========================================
  // 📊 WebSocket Settings
  // ==========================================
  websocket: {
    reconnectDelay: 3000,
    maxReconnectDelay: 30000,
    maxReconnectAttempts: Infinity,
    pingInterval: 15000,
    pongTimeout: 10000,
    connectionTimeout: 15000,
    handshakeTimeout: 10000,
    maxPayload: 10485760,
    perMessageDeflate: false,
    sendAppPing: true,
    keepaliveMode: 'appPing', // 'none', 'wsPing', 'appPing'
    idleDisconnectSeconds: 180
  },

  // ==========================================
  // 🧠 Auto-Tune & Recording
  // ==========================================
  dataRecorder: {
    enabled: true,
    dir: './logs',
    marketFile: 'market.jsonl',
    signalFile: 'signals.jsonl',
    tradeFile: 'trades.jsonl',
    flushEvery: 1
  },

  autoTune: {
    enabled: true,
    scheduleHours: 24,
    iterations: 80,
    marketFile: './logs/market.jsonl',
    bestParamsFile: './logs/best_params.json',
    runOnStart: false,
    autoApply: true
  },

  // ==========================================
  // 🔔 Notifications
  // ==========================================
  notifications: {
    enabled: true,
    onSignal: true,
    onTrade: true,
    onClose: true,
    onError: true
  },

  // ==========================================
  // 📝 Logging
  // ==========================================
  logging: {
    level: 'info',
    showTrades: true,
    showPnL: true,
    showPortfolio: true,
    showSignals: true,
    saveToFile: true,
    logFile: './logs/trading.log'
  },

  // ==========================================
  // 🌍 Telegram
  // ==========================================
  telegram: {
    enabled: false,
    botToken: '',
    chatId: ''
  },

  // ==========================================
  // 🧪 API Source (for UI)
  // ==========================================
  api: {
    wsUrl: 'wss://demo.farazgold.com/ws/',
    baseUrl: 'https://demo.farazgold.com',
    csrftoken: 'GTiZlvd8jNoMuko3nkjjU0lhC8m6Yy3m',
    sessionid: 'njmnqc7hfkeyayowprwheqc73lvp98as'
  },

  // ==========================================
  // 🎮 Simulation Settings
  // ==========================================
  simulation: {
    volatility: 5000,
    basePrice: 18500000,
    trend: 0
  },

  source: 'SIMULATED' as 'SIMULATED' | 'API'
};
