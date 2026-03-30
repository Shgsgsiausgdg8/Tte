export const config = {
  // ==========================================
  // 🔐 Authentication
  // ==========================================
  auth: {
    csrftoken: process.env.FARAZGOLD_CSRF || 'GTiZlvd8jNoMuko3nkjjU0lhC8m6Yy3m',
    sessionid: process.env.FARAZGOLD_SESSION || 'njmnqc7hfkeyayowprwheqc73lvp98as',
    baseUrl: process.env.FARAZGOLD_BASEURL || 'https://demo.farazgold.com',
    wsUrl: process.env.FARAZGOLD_WSURL || 'wss://demo.farazgold.com/room/api/get-bars-ws/?symbol=mazane&resolution=1&history=300',
    wsAutoDiscover: true,
  },

  // ==========================================
  // ⚠️ Risk Management
  // ==========================================
  risk: {
    riskPerTrade: 2,
    maxOpenPositions: 2,
    maxDailyRisk: 8, // Percent
    minBalanceToTrade: 250000,
    maxRiskTomanPerTrade: 1000000,
    maxLeverage: 1,
    stopTradingOnMaxDailyLoss: true,
    antiArbitrage: {
      enabled: true,
      minHoldTimeSeconds: 30
    }
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
    },
    steppedRiskFree: {
      enabled: true,
      steps: [
        { triggerPct: 30, movePct: -50 }, // At 30% of TP, reduce risk by 50%
        { triggerPct: 60, movePct: 0 },   // At 60% of TP, move to Entry (Risk-Free)
        { triggerPct: 85, movePct: 25 }   // At 85% of TP, lock 25% of profit
      ]
    }
  },

  // ==========================================
  // ⏱️ Timeframe Settings
  // ==========================================
  timeframe: {
    value: 60, // in seconds (e.g., 1, 2, 5, 60, 300, 3600)
    label: '1m'
  },

  // ==========================================
  // 🤖 Strategy Settings
  // ==========================================
  activeStrategy: 'SCALP' as 'SCALP' | 'QUANT' | 'TREND' | 'FAST' | 'NUMERICAL' | 'HST' | 'PINBAR' | 'MTF_PATTERN' | 'ICHIMOKU_MTF' | 'ICHIMOKU_HARAMI',
  strategy: {
    enabled: true,
    highQualityMode: false,
    enableStrengthScaling: false,
    entry: {
      maxDistanceFromSlowEmaPercent: 0.5
    },
    tradeCooldown: 8,
    minSignalScore: 1,
    highQuality: {
      autoScaleVolume: false,
      volumeMultiplier: 1.5, // Increase volume for HQ signals
      tp1Percent: 60, // Target 60% of ATR for TP1
      tp2Percent: 120, // Target 120% of ATR for TP2
      trailing: {
        enabled: true,
        activateAfterTicks: 10,
        trailTicks: 5
      },
      breakEven: {
        enabled: true,
        triggerPercent: 40, // Move to BE early
        bufferTicks: 1
      }
    },
    pyramiding: {
      enabled: false,
      profitTicksTrigger: 5
    },
    antiSpam: {
      enabled: true,
      minMinutesBetweenSameSideSignals: 1
    },
    filters: {
      maxPositions: 3,
      maxTradesPer10Min: 2,
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
    },
    hst: {
      hmaLength: 55,
      stPeriod: 10,
      stMultiplier: 3,
      requireCloseAboveHMA: true,
      mode: 'NORMAL'
    },
    pinbar: {
      enabled: true,
      bodyRatio: 0.4,
      wickRatio: 2.5,
      requireTrend: true,
      trendPeriod: 10,
      confirmationRequired: false,
      maxSlippageTicks: 2,
      useVolumeFilter: false,
      minVolumeRatio: 1.5,
      minScore: 2
    },
    mtfPatterns: {
      enabled: true,
      higherTF: '5m',
      lowerTF: '1m',
      supportResistance: {
        swingBars: 2,
        clusterBinSize: 10,
        mergeThreshold: 50,
        proximityThreshold: 50
      },
      patterns: {
        pinBar: true,
        engulfing: true,
        doji: true,
        hammer: true,
        starPatterns: true,
        insideBar: true
      },
      minScore: 3,
      useVolume: false
    },
    ichimoku: {
      enabled: true,
      timeframes: {
        higher: '5m',
        lower: '1m'
      },
      periods: {
        tenkan: 9,
        kijun: 26,
        senkouB: 52
      },
      useClassicSR: true,
      useClusters: true,
      useRoundNumbers: true,
      mergeThreshold: 30,
      proximityThreshold: 40,
      minScore: 4,
      trendFilter: {
        requireCloudConfirmation: true,
        minTrendScore: 6,
        allowNeutral: false
      },
      patterns: {
        pinBar: true,
        engulfing: true,
        hammer: true,
        starPatterns: true,
        doji: false,
        insideBar: true
      }
    },
    ichimokuHarami: {
      enabled: true,
      timeframes: {
        higher: '5m',
        lower: '1m'
      },
      levels: {
        ichimoku: {
          kijun: true,
          tenkan: true,
          senkouA: true,
          senkouB: true,
          cloudEdges: true
        },
        classic: {
          swingPoints: true,
          clusters: true,
          roundNumbers: true
        },
        mergeThreshold: 25,
        proximityThreshold: 40
      },
      patterns: {
        harami: {
          enabled: true,
          minStrength: 3,
          requireVolume: false
        },
        piercing: {
          enabled: true,
          minPenetration: 50,
          requireGap: true
        },
        darkCloud: {
          enabled: true,
          minPenetration: 50,
          requireGap: true
        }
      },
      trendFilter: {
        enabled: true,
        minTrendScore: 5,
        allowNeutral: false,
        requireCloudConfirmation: true
      },
      risk: {
        minScore: 8,
        pierceingRR: 2.5,
        darkCloudRR: 2.5,
        haramiRR: 2.2,
        maxSpread: 2
      }
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
    autoApply: true,
    maximizeBigWins: false
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
    chatId: '', // Single or comma-separated
    quickGuide: '• ورود: زمانی که قیمت نزدیک به Entry است وارد معامله شوید.\n• تارگت و حد ضرر را دقیق تنظیم کنید تا از ریسک اضافی جلوگیری شود.\n• اگر امتیاز بالا باشد، احتمال موفقیت سیگنال بالاتر است.',
    logEnabled: false
  },

  // ==========================================
  // 📱 Rubika
  // ==========================================
  rubika: {
    enabled: false,
    botToken: '',
    chatId: '', // Single or comma-separated
    logEnabled: false
  },

  // ==========================================
  // 🧪 API Source (for UI)
  // ==========================================
  api: {
    useRealAccount: false,
    demo: {
      wsUrl: 'wss://demo.farazgold.com/ws/',
      baseUrl: 'https://demo.farazgold.com',
      csrftoken: 'GTiZlvd8jNoMuko3nkjjU0lhC8m6Yy3m',
      sessionid: 'njmnqc7hfkeyayowprwheqc73lvp98as',
      accessToken: '',
      refreshToken: ''
    },
    real: {
      wsUrl: 'wss://farazgold.com/ws/',
      baseUrl: 'https://farazgold.com',
      csrftoken: '',
      sessionid: '',
      accessToken: '',
      refreshToken: ''
    }
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
