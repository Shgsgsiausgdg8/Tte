export const defaultConfig = {
  source: 'SIM', // 'SIM' or 'API'
  api: {
    activeAccountId: 'demo_default',
    accounts: {
      'demo_default': {
        name: 'FarazGold Demo',
        type: 'demo',
        baseUrl: 'https://demo.farazgold.com',
        wsUrl: 'wss://demo.farazgold.com/ws/',
        sessionid: '',
        csrftoken: '',
        bearerToken: ''
      },
      'real_default': {
        name: 'FarazGold Real',
        type: 'real',
        baseUrl: 'https://farazgold.com',
        wsUrl: 'wss://farazgold.com/ws/',
        sessionid: '',
        csrftoken: '',
        bearerToken: ''
      }
    }
  },
  trade: {
    minUnits: 1,
    maxUnits: 5,
    leverage: 1
  },
  risk: {
    maxOpenPositions: 2,
    maxRiskTomanPerTrade: 420000,
    dailyLossLimitToman: 2000000,
    maxTradeAgeMinutes: 60,
    minBalanceToTrade: 250000
  },
  market: {
    symbol: 'mazane',
    tickSize: 1000,
    tickValueToman: 23000
  },
  timeframe: {
    label: '1 Minute',
    value: 60
  },
  strategy: {
    hmaPeriod: 21,
    rsiPeriod: 14,
    atrPeriod: 14,
    superTrendPeriod: 10,
    superTrendMultiplier: 3,
    tradeCooldown: 8,
    antiArbitrage: {
      enabled: true,
      maxLatencyMs: 500,
      maxSpreadTicks: 15
    },
    numerical: {
      rsiOverbought: 70,
      rsiOversold: 30,
      spreadThreshold: 18
    }
  },
  targetsTicks: {
    stopTicks: 10,
    tpTicks: 15,
    breakEven: {
      enabled: true,
      activationTicks: 10,
      offsetTicks: 2
    },
    trailing: {
      enabled: false,
      activationTicks: 15,
      callbackTicks: 5
    },
    reversal: {
      enabled: true,
      minOppositeSignalScore: 2,
      triggerLossTicks: 6
    }
  },
  telegram: {
    enabled: false,
    botToken: '',
    chatId: ''
  },
  rubika: {
    enabled: false,
    botToken: '',
    chatId: ''
  },
  dataRecorder: {
    enabled: true,
    maxDays: 7,
    saveIntervalMs: 60000
  },
  autoTune: {
    enabled: true,
    intervalMs: 3600000, // 1 hour
    minTrades: 5,
    maxWaitBars: 10,
    surgicalOptimization: true,
    maximizeBigWins: true,
    optimizeDrawdownQuality: true
  }
};
