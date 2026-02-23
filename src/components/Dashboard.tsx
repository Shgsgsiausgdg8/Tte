import React, { useState, useEffect } from 'react';
import Chart from 'react-apexcharts';
import { Activity, TrendingUp, TrendingDown, AlertCircle, Clock, Power, ShieldCheck, Settings, Send, Save, X, ChevronRight, Terminal, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('fa-IR', { style: 'currency', currency: 'IRR', maximumFractionDigits: 0 }).format(price * 10).replace('ریال', 'تومان');
};

export default function Dashboard() {
  const [botState, setBotState] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const showSettingsRef = React.useRef(showSettings);
  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    console.log("Connecting to WS:", wsUrl);
    
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WS Connected");
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INIT' || msg.type === 'UPDATE') {
          setBotState(msg.data);
          // Only update settings from server if modal is closed
          if (!showSettingsRef.current) {
            setSettings(msg.data.settings);
          }
          setHistory(prev => {
            const newHistory = [...prev, { time: new Date().toLocaleTimeString('fa-IR'), price: msg.data.price }];
            return newHistory.slice(-50);
          });
        }
      } catch (e) {
        console.error("WS Message Error:", e);
      }
    };

    ws.onerror = (err) => {
      console.error("WS Error:", err);
      setError("اتصال به سرور ربات برقرار نشد. در حال تلاش مجدد...");
    };

    ws.onclose = () => {
      console.log("WS Closed");
      setTimeout(() => {
        // Simple reconnection logic could go here
      }, 3000);
    };

    // Timeout for loading state
    const timeout = setTimeout(() => {
      if (!botState) {
        setError("سرور در حال راه‌اندازی است، لطفاً کمی صبر کنید یا صفحه را رفرش کنید.");
      }
    }, 10000);

    return () => {
      ws.close();
      clearTimeout(timeout);
    };
  }, [botState === null]);

  const toggleTrading = async () => {
    await fetch('/api/bot/toggle', { method: 'POST' });
  };

  const manualTrade = async (action: 'BUY' | 'SELL') => {
    await fetch('/api/bot/manual-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
  };

  const closeAllTrades = async () => {
    await fetch('/api/bot/close-all', { method: 'POST' });
  };

  const saveSettings = async () => {
    await fetch('/api/bot/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    setShowSettings(false);
  };

  if (error && !botState) return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-6 text-center">
      <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
      <h2 className="text-xl font-bold text-white mb-2">خطا در اتصال</h2>
      <p className="text-slate-400 text-sm max-w-md">{error}</p>
      <button onClick={() => window.location.reload()} className="mt-6 px-6 py-2 bg-white/5 rounded-xl text-sm hover:bg-white/10 transition-all">تلاش مجدد</button>
    </div>
  );

  if (!botState) return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <motion.div 
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full"
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#050505] text-slate-200 font-sans selection:bg-emerald-500/30 overflow-x-hidden">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-xl px-4 sm:px-8 py-4 sm:py-5 flex flex-col sm:flex-row items-center justify-between sticky top-0 z-40 gap-4 sm:gap-0">
        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
          <div className="flex items-center gap-4">
            <motion.div 
              whileHover={{ rotate: 180 }}
              className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20"
            >
              <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </motion.div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black tracking-tighter text-white">FARAZ <span className="text-emerald-500">GOLD</span></h1>
              <p className="text-[8px] sm:text-[10px] text-slate-500 font-mono uppercase tracking-[0.2em]">ربات اسکالپر الگوریتمیک - نسخه ۴.۳</p>
            </div>
          </div>
          
          <div className="flex sm:hidden items-center gap-3">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 bg-white/5 rounded-xl text-slate-400 hover:text-white transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={toggleTrading}
              className={`p-2 rounded-xl transition-all ${botState.isTrading ? 'bg-rose-500/20 text-rose-500' : 'bg-emerald-500/20 text-emerald-500'}`}
            >
              <Power className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-center sm:justify-end">
          <div className="hidden sm:flex items-center gap-4 border-r border-white/10 pr-6 mr-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-mono uppercase">تلگرام</span>
              <button 
                onClick={() => {
                  const newSettings = { ...botState.settings, telegram: { ...botState.settings.telegram, enabled: !botState.settings.telegram?.enabled } };
                  fetch('/api/bot/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSettings) });
                }}
                className={`w-8 h-4 rounded-full transition-colors relative ${botState.settings?.telegram?.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
              >
                <motion.div animate={{ x: botState.settings?.telegram?.enabled ? 16 : 2 }} className="w-3 h-3 bg-white rounded-full absolute top-0.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-mono uppercase">Trailing</span>
              <button 
                onClick={() => {
                  const newSettings = { ...botState.settings, targetsTicks: { ...botState.settings.targetsTicks, trailing: { ...botState.settings.targetsTicks?.trailing, enabled: !botState.settings.targetsTicks?.trailing?.enabled } } };
                  fetch('/api/bot/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSettings) });
                }}
                className={`w-8 h-4 rounded-full transition-colors relative ${botState.settings?.targetsTicks?.trailing?.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
              >
                <motion.div animate={{ x: botState.settings?.targetsTicks?.trailing?.enabled ? 16 : 2 }} className="w-3 h-3 bg-white rounded-full absolute top-0.5" />
              </button>
            </div>
          </div>
          <div className="hidden md:block text-right">
            <select 
              value={botState.settings?.activeStrategy || 'SCALP'}
              onChange={(e) => {
                const newSettings = { ...botState.settings, activeStrategy: e.target.value };
                fetch('/api/bot/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(newSettings)
                });
              }}
              className="bg-white/5 border border-white/5 rounded-xl px-3 py-1.5 text-xs text-emerald-500 font-bold outline-none cursor-pointer"
            >
              <option value="SCALP">استراتژی اسکالپ</option>
              <option value="FAST">استراتژی فوق سریع</option>
              <option value="QUANT">استراتژی کوانت</option>
              <option value="TREND">استراتژی ترند</option>
            </select>
          </div>
          <div className="hidden md:block text-right">
            <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-1">موجودی حساب</p>
            <p className="text-xl font-black font-mono text-white">
              {botState.portfolio ? formatPrice(botState.portfolio.balance) : '---'}
            </p>
          </div>
          <div className="hidden md:block text-right">
            <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mb-1">عملکرد امروز</p>
            <p className={`text-xl font-black font-mono ${botState.dailyPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {botState.dailyPnL >= 0 ? '+' : ''}{formatPrice(botState.dailyPnL)}
            </p>
          </div>
          
          <div className="flex items-center gap-2 bg-white/5 p-1.5 rounded-2xl border border-white/5">
            <button 
              onClick={async () => {
                if (window.confirm('آیا از ریست کردن آمار امروز اطمینان دارید؟')) {
                  await fetch('/api/bot/reset-stats', { method: 'POST' });
                }
              }}
              title="ریست آمار"
              className="p-2.5 rounded-xl hover:bg-white/5 transition-colors text-slate-400 hover:text-white"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2.5 rounded-xl hover:bg-white/5 transition-colors text-slate-400 hover:text-white"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={toggleTrading}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-all ${botState.isTrading ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'}`}
            >
              <Power className="w-4 h-4" />
              <span className="hidden sm:inline">{botState.isTrading ? 'فعال' : 'متوقف'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-8 max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8" dir="rtl">
        {/* Main Chart Section */}
        <div className="lg:col-span-8 space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            {[
              { label: 'قیمت لحظه‌ای', value: formatPrice(botState.price), icon: TrendingUp, color: 'text-white' },
              { label: 'شاخص RSI', value: botState.indicators?.rsi ? botState.indicators.rsi.toFixed(2) : '---', icon: Activity, color: botState.indicators?.rsi > 60 ? 'text-rose-500' : botState.indicators?.rsi < 40 ? 'text-emerald-500' : 'text-white' },
              { label: 'معاملات فعال', value: botState.openPositions.length, icon: ShieldCheck, color: 'text-emerald-500' }
            ].map((stat, i) => (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                key={i} 
                className="bg-[#0f0f0f] border border-white/5 rounded-2xl sm:rounded-3xl p-5 sm:p-6 hover:border-emerald-500/30 transition-colors group"
              >
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <p className="text-[9px] sm:text-[10px] text-slate-500 font-mono uppercase tracking-widest">{stat.label}</p>
                  <stat.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600 group-hover:text-emerald-500 transition-colors" />
                </div>
                <p className={`text-2xl sm:text-3xl font-black font-mono tracking-tighter ${stat.color}`}>{stat.value}</p>
              </motion.div>
            ))}
          </div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#0f0f0f] border border-white/5 rounded-2xl sm:rounded-[2.5rem] p-4 sm:p-8 h-[400px] sm:h-[550px] shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 sm:mb-8 gap-4 sm:gap-0">
              <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${botState.marketStatus === 'OPEN' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                {botState.marketStatus === 'OPEN' ? 'تغییرات قیمت در لحظه (زنده)' : 'بازار در حال حاضر بسته است'}
              </h2>
              <div className="flex items-center gap-4">
                {botState.marketAnalysis && (
                  <div className="hidden sm:flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                    <span className="text-[9px] text-slate-500">وضعیت بازار:</span>
                    <span className={`text-[10px] font-bold ${botState.marketAnalysis.color}`}>{botState.marketAnalysis.trend}</span>
                  </div>
                )}
                <div className="flex gap-2 w-full sm:w-auto justify-end" dir="ltr">
                  {['1M', '5M', '15M'].map(t => (
                    <button key={t} className={`px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] font-bold transition-all ${t === '1M' ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>{t}</button>
                  ))}
                </div>
              </div>
            </div>
            
            {botState.marketAnalysis && (
              <div className="sm:hidden mb-4 bg-white/5 p-3 rounded-xl border border-white/5 text-[10px] text-slate-400">
                <span className="font-bold text-slate-300">تحلیل:</span> {botState.marketAnalysis.analysis}
              </div>
            )}
            
            <div className="h-[280px] sm:h-[400px] w-full" dir="ltr">
              <Chart
                options={{
                  chart: {
                    type: 'candlestick',
                    background: 'transparent',
                    toolbar: { show: false },
                    animations: { enabled: false }
                  },
                  theme: { mode: 'dark' },
                  plotOptions: {
                    candlestick: {
                      colors: {
                        upward: '#10b981',
                        downward: '#f43f5e'
                      },
                      wick: {
                        useFillColor: true
                      }
                    }
                  },
                  xaxis: {
                    type: 'datetime',
                    labels: {
                      style: { colors: '#64748b', fontFamily: 'monospace' },
                      datetimeUTC: false,
                    },
                    axisBorder: { show: false },
                    axisTicks: { show: false }
                  },
                  yaxis: {
                    tooltip: { enabled: true },
                    labels: {
                      style: { colors: '#64748b', fontFamily: 'monospace' },
                      formatter: (val) => val.toLocaleString('fa-IR')
                    }
                  },
                  grid: {
                    borderColor: '#1e293b',
                    strokeDashArray: 4,
                  },
                  tooltip: {
                    theme: 'dark',
                    x: { format: 'HH:mm' }
                  }
                }}
                series={[{
                  name: 'قیمت',
                  data: botState.candles || []
                }]}
                type="candlestick"
                height="100%"
                width="100%"
              />
            </div>
            {botState.marketAnalysis && (
              <div className="hidden sm:block absolute bottom-6 left-8 bg-[#0a0a0a]/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 max-w-md shadow-2xl">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-emerald-500" />
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">تحلیل هوشمند بازار</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{botState.marketAnalysis.analysis}</p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Sidebar Section */}
        <div className="lg:col-span-4 space-y-6 sm:space-y-8">
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-[#0f0f0f] border border-white/5 rounded-2xl sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl"
          >
            <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] mb-6 sm:mb-8 flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
              پوزیشن‌های باز
            </h2>
            <div className="space-y-4">
              <AnimatePresence>
                {botState.openPositions.map((pos: any) => (
                  <motion.div 
                    key={pos.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="bg-white/5 border border-white/5 rounded-2xl sm:rounded-3xl p-4 sm:p-5 relative group overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-3xl rounded-full -mr-12 -mt-12" />
                    <div className="flex justify-between items-center mb-3 sm:mb-4">
                      <div className="flex flex-col">
                        <span className={`text-[9px] sm:text-[10px] font-black px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full w-fit ${pos.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>
                          {pos.type}
                        </span>
                        <span className="text-[8px] sm:text-[9px] text-slate-400 mt-1 font-mono uppercase">{pos.pattern || 'EMA CROSS'}</span>
                      </div>
                      <span className="text-[9px] sm:text-[10px] text-slate-500 font-mono">{new Date(pos.entryTime).toLocaleTimeString('fa-IR')}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-mono mb-1">ورود</p>
                        <p className="text-xs sm:text-sm font-bold font-mono text-white">{formatPrice(pos.entry)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-mono mb-1">حد سود / ضرر</p>
                        <p className="text-[9px] sm:text-[10px] font-bold font-mono text-emerald-500">{formatPrice(pos.tp1 || pos.tp)}</p>
                        <p className="text-[9px] sm:text-[10px] font-bold font-mono text-rose-500">{formatPrice(pos.sl)}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {botState.openPositions.length === 0 && (
                <div className="text-center py-8 sm:py-12">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-slate-600" />
                  </div>
                  <p className="text-slate-500 text-[10px] sm:text-xs font-mono italic">در انتظار سیگنال بازار...</p>
                </div>
              )}
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#0f0f0f] border border-white/5 rounded-2xl sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl"
          >
            <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] mb-6 sm:mb-8 flex items-center gap-3">
              <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
              کنترل دستی و آمار
            </h2>
            
            {/* Manual Trading */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
              <button 
                onClick={() => manualTrade('BUY')}
                className="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-500 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm transition-all"
              >
                خرید دستی (BUY)
              </button>
              <button 
                onClick={() => manualTrade('SELL')}
                className="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-500 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm transition-all"
              >
                فروش دستی (SELL)
              </button>
              <button 
                onClick={closeAllTrades}
                className="col-span-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm transition-all"
              >
                بستن تمام پوزیشن‌ها
              </button>
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="bg-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4">
                <p className="text-[8px] sm:text-[10px] text-slate-500 font-mono uppercase mb-1">تعداد کل معاملات</p>
                <p className="text-lg sm:text-xl font-bold text-white">{botState.totalTrades || 0}</p>
              </div>
              <div className="bg-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4">
                <p className="text-[8px] sm:text-[10px] text-slate-500 font-mono uppercase mb-1">وین ریت (Win Rate)</p>
                <p className="text-lg sm:text-xl font-bold text-emerald-500">
                  {botState.totalTrades > 0 ? Math.round((botState.winningTrades / botState.totalTrades) * 100) : 0}%
                </p>
              </div>
              <div className="bg-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4">
                <p className="text-[8px] sm:text-[10px] text-slate-500 font-mono uppercase mb-1">معاملات سودده</p>
                <p className="text-lg sm:text-xl font-bold text-emerald-500">{botState.winningTrades || 0}</p>
              </div>
              <div className="bg-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4">
                <p className="text-[8px] sm:text-[10px] text-slate-500 font-mono uppercase mb-1">معاملات ضررده</p>
                <p className="text-lg sm:text-xl font-bold text-rose-500">{botState.losingTrades || 0}</p>
              </div>
            </div>
          </motion.div>

          {/* Trade History */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-[#0f0f0f] border border-white/5 rounded-2xl sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl"
          >
            <div className="flex justify-between items-center mb-6 sm:mb-8">
              <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3">
                <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
                تاریخچه معاملات
              </h2>
              <button 
                onClick={() => {
                  const csvContent = "data:text/csv;charset=utf-8," 
                    + "Type,Entry,Exit,PnL,Reason\n"
                    + (botState.closedPositions || []).map((p: any) => `${p.type},${p.entry},${p.exitPrice},${p.pnl},${p.reason}`).join("\n");
                  const encodedUri = encodeURI(csvContent);
                  const link = document.createElement("a");
                  link.setAttribute("href", encodedUri);
                  link.setAttribute("download", "trade_history.csv");
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="text-[9px] sm:text-[10px] bg-white/5 hover:bg-white/10 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-colors"
              >
                دانلود CSV
              </button>
            </div>
            <div className="space-y-3 max-h-[250px] sm:max-h-[300px] overflow-y-auto custom-scrollbar" dir="rtl">
              {(botState.closedPositions || []).slice().reverse().map((pos: any, i: number) => (
                <div key={i} className="flex justify-between items-center bg-white/5 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl">
                  <div className="flex items-center gap-3">
                    <span className={`text-[9px] sm:text-[10px] font-bold px-2 py-0.5 sm:py-1 rounded-md ${pos.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>
                      {pos.type}
                    </span>
                    <span className="text-[10px] sm:text-xs font-mono text-slate-400">{formatPrice(pos.pnl)}</span>
                  </div>
                  <div className="text-left">
                    <span className="text-[9px] sm:text-[10px] text-slate-500">{new Date(pos.exitTime).toLocaleTimeString('fa-IR')}</span>
                  </div>
                </div>
              ))}
              {(!botState.closedPositions || botState.closedPositions.length === 0) && (
                <p className="text-center text-slate-500 text-[10px] sm:text-xs py-4">تاریخچه‌ای موجود نیست</p>
              )}
            </div>
          </motion.div>
        </div>

        {/* Terminal Log Section */}
        <div className="lg:col-span-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-[#0a0a0a] border border-white/5 rounded-2xl sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3">
                <Terminal className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                مانیتورینگ و لاگ سیستم
              </h2>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowLogs(!showLogs)}
                  className={`text-[9px] sm:text-[10px] px-3 py-1.5 rounded-lg transition-colors ${showLogs ? 'bg-emerald-500/20 text-emerald-500' : 'bg-white/5 text-slate-400'}`}
                >
                  {showLogs ? 'روشن' : 'خاموش'}
                </button>
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
              </div>
            </div>
            
            {showLogs && (
              <div className="bg-black/50 rounded-xl p-4 font-mono text-[10px] sm:text-xs h-[200px] overflow-y-auto custom-scrollbar space-y-2 border border-white/5" dir="ltr">
                {(botState.logs || []).slice().reverse().map((log: any) => (
                  <div key={log.id} className="flex gap-3 border-b border-white/5 pb-1 last:border-0">
                    <span className="text-slate-600 shrink-0">[{log.time}]</span>
                    <span className={`font-bold shrink-0 ${
                      log.type === 'ERROR' ? 'text-rose-500' : 
                      log.type === 'SUCCESS' ? 'text-emerald-500' : 
                      log.type === 'SIGNAL' ? 'text-amber-500' : 
                      log.type === 'WS' ? 'text-blue-500' : 
                      'text-slate-400'
                    }`}>
                      [{log.type}]
                    </span>
                    <span className="text-slate-300 break-all">{log.message}</span>
                  </div>
                ))}
                {(!botState.logs || botState.logs.length === 0) && (
                  <div className="text-slate-600 italic">در انتظار دریافت لاگ از سیستم...</div>
                )}
              </div>
            )}
          </motion.div>
        </div>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && settings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0f0f0f] border border-white/10 rounded-2xl sm:rounded-[3rem] p-6 sm:p-10 shadow-3xl overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6 sm:mb-10" dir="rtl">
                <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-4">
                  <Settings className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500" />
                  تنظیمات پیشرفته ربات
                </h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5 sm:w-6 sm:h-6 text-slate-500" />
                </button>
              </div>

              <div className="space-y-6 sm:space-y-8 max-h-[70vh] overflow-y-auto pr-2 sm:pr-4 custom-scrollbar" dir="rtl">
                {/* Data Source Selection */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Activity className="w-4 h-4" /> منبع داده (قیمت)
                  </h3>
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">تایم فریم</label>
                        <select 
                          value={settings.timeframe?.value || 60}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            const label = e.target.options[e.target.selectedIndex].text;
                            setSettings({ ...settings, timeframe: { value: val, label } });
                          }}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm text-slate-200 outline-none focus:border-emerald-500/50 transition-all appearance-none"
                        >
                          <option value="1">۱ ثانیه</option>
                          <option value="2">۲ ثانیه</option>
                          <option value="3">۳ ثانیه</option>
                          <option value="4">۴ ثانیه</option>
                          <option value="5">۵ ثانیه</option>
                          <option value="10">۱۰ ثانیه</option>
                          <option value="15">۱۵ ثانیه</option>
                          <option value="30">۳۰ ثانیه</option>
                          <option value="60">۱ دقیقه</option>
                          <option value="120">۲ دقیقه</option>
                          <option value="180">۳ دقیقه</option>
                          <option value="240">۴ دقیقه</option>
                          <option value="300">۵ دقیقه</option>
                          <option value="900">۱۵ دقیقه</option>
                          <option value="3600">۱ ساعت</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">وضعیت اتصال</label>
                        <div className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm text-emerald-500 flex items-center gap-2">
                          {botState?.isConnected ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              متصل
                            </>
                          ) : (
                            <>
                              <div className="w-2 h-2 rounded-full bg-rose-500" />
                              قطع / در حال اتصال...
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">CSRF Token</label>
                        <input 
                          type="password" 
                          value={settings.api?.csrftoken || ''}
                          onChange={(e) => setSettings({ ...settings, api: { ...settings.api, csrftoken: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Session ID</label>
                        <input 
                          type="password" 
                          value={settings.api?.sessionid || ''}
                          onChange={(e) => setSettings({ ...settings, api: { ...settings.api, sessionid: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </section>



                {/* Risk Management */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <AlertCircle className="w-4 h-4" /> مدیریت ریسک و سرمایه
                  </h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداکثر ریسک هر معامله (تومان)</label>
                      <input 
                        type="number" 
                        value={settings.risk?.maxRiskTomanPerTrade || 1000000}
                        onChange={(e) => setSettings({ ...settings, risk: { ...settings.risk, maxRiskTomanPerTrade: parseInt(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداکثر ضرر روزانه (تومان)</label>
                      <input 
                        type="number" 
                        value={settings.risk?.maxDailyLossToman || 5000000}
                        onChange={(e) => setSettings({ ...settings, risk: { ...settings.risk, maxDailyLossToman: parseInt(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-rose-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداکثر پوزیشن همزمان</label>
                      <input 
                        type="number" 
                        value={settings.risk?.maxOpenPositions || 2}
                        onChange={(e) => setSettings({ ...settings, risk: { ...settings.risk, maxOpenPositions: parseInt(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حد سود پایه (تیک)</label>
                      <input 
                        type="number" 
                        value={settings.targetsTicks?.tpTicks || 18}
                        onChange={(e) => setSettings({ ...settings, targetsTicks: { ...settings.targetsTicks, tpTicks: parseInt(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                </section>

                {/* Telegram Settings */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Send className="w-4 h-4" /> تنظیمات تلگرام
                  </h3>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                      <span className="text-sm font-medium">فعال‌سازی گزارشات تلگرام</span>
                      <button 
                        onClick={() => setSettings({ ...settings, telegram: { ...settings.telegram, enabled: !settings.telegram.enabled } })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.telegram.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      >
                        <motion.div 
                          animate={{ x: settings.telegram.enabled ? 24 : 4 }}
                          className="absolute top-1 w-4 h-4 bg-white rounded-full"
                        />
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">توکن ربات (Bot Token)</label>
                        <input 
                          type="password" 
                          value={settings.telegram.botToken}
                          onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, botToken: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                          placeholder="توکن را اینجا وارد کنید"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">شناسه چت (Chat ID)</label>
                        <input 
                          type="text" 
                          value={settings.telegram.chatId}
                          onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, chatId: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                          placeholder="مثلاً 123456789"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Strategy Selection */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4" /> استراتژی فعال
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { id: 'SCALP', label: 'اسکالپر پرو', desc: 'مبتنی بر RSI و EMA' },
                      { id: 'FAST', label: 'فوق سریع', desc: 'واکنش سریع به نوسان' },
                      { id: 'QUANT', label: 'کوانت', desc: 'پرایس اکشن و الگوها' },
                      { id: 'TREND', label: 'ترند فالووینگ', desc: 'کراس MA و MACD' }
                    ].map(type => (
                      <button
                        key={type.id}
                        onClick={() => setSettings({ ...settings, activeStrategy: type.id })}
                        className={`p-4 rounded-2xl border transition-all text-right ${settings.activeStrategy === type.id ? 'bg-emerald-500/10 border-emerald-500 text-white' : 'bg-white/5 border-white/5 text-slate-500 hover:bg-white/10'}`}
                      >
                        <p className="text-xs font-bold">{type.label}</p>
                        <p className="text-[9px] opacity-60 mt-1">{type.desc}</p>
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4" /> فیلترها و محدودیت‌ها
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداکثر پوزیشن همزمان</label>
                      <input 
                        type="number" 
                        value={settings.strategy?.filters?.maxPositions || 3}
                        onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, filters: { ...settings.strategy?.filters, maxPositions: parseInt(e.target.value) } } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداکثر معامله در ۱۰ دقیقه</label>
                      <input 
                        type="number" 
                        value={settings.strategy?.filters?.maxTradesPer10Min || 2}
                        onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, filters: { ...settings.strategy?.filters, maxTradesPer10Min: parseInt(e.target.value) } } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                      />
                      <p className="text-[8px] text-slate-500 mt-1">برای جلوگیری از اورتریدینگ (Overtrading)</p>
                    </div>
                  </div>
                </section>

                {/* Strategy Parameters */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Activity className="w-4 h-4" /> پارامترهای استراتژی ({settings.activeStrategy === 'SCALP' ? 'اسکالپر' : settings.activeStrategy === 'FAST' ? 'فوق سریع' : settings.activeStrategy === 'QUANT' ? 'کوانت' : 'ترند'})
                  </h3>
                  
                  {settings.activeStrategy === 'SCALP' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">دوره RSI</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.indicators?.rsi?.period || 5}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, indicators: { ...settings.strategy?.indicators, rsi: { ...settings.strategy?.indicators?.rsi, period: parseInt(e.target.value) } } } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">EMA سریع</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.indicators?.ema?.fast || 3}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, indicators: { ...settings.strategy?.indicators, ema: { ...settings.strategy?.indicators?.ema, fast: parseInt(e.target.value) } } } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                  )}

                  {settings.activeStrategy === 'FAST' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      <div className="col-span-1 sm:col-span-2 bg-emerald-500/5 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-emerald-500/20">
                        <p className="text-[9px] sm:text-[10px] text-emerald-500 font-bold mb-1">توضیح استراتژی فوق سریع</p>
                        <p className="text-[10px] sm:text-[11px] text-slate-400">این استراتژی از دوره‌های بسیار کوتاه (EMA 5/13 و RSI 7) برای شناسایی سریع‌ترین نوسانات بازار استفاده می‌کند. مناسب برای بازارهای پر نوسان.</p>
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداقل امتیاز سیگنال</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.minSignalScore || 1}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, minSignalScore: parseInt(e.target.value) } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">کول‌داون (ثانیه)</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.tradeCooldown || 8}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, tradeCooldown: parseInt(e.target.value) } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                  )}

                  {settings.activeStrategy === 'QUANT' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MA سریع (روند)</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.quant?.maFast || 50}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, maFast: parseInt(e.target.value) } } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MA کند (روند)</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.quant?.maSlow || 200}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, maSlow: parseInt(e.target.value) } } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">نسبت ریسک به ریوارد</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={settings.strategy?.quant?.riskRewardRatio || 2}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, riskRewardRatio: parseFloat(e.target.value) } } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">طول سوئینگ (کندل)</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.quant?.swingLength || 5}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, swingLength: parseInt(e.target.value) } } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                  )}

                  {settings.activeStrategy === 'TREND' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MA سریع</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.trend?.maFast || 20}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, trend: { ...settings.strategy?.trend, maFast: parseInt(e.target.value) } } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MA کند</label>
                        <input 
                          type="number" 
                          value={settings.strategy?.trend?.maSlow || 50}
                          onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, trend: { ...settings.strategy?.trend, maSlow: parseInt(e.target.value) } } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <div className="mt-6 sm:mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
                <button 
                  onClick={async () => {
                    if (window.confirm('آیا از راه‌اندازی مجدد ربات اطمینان دارید؟')) {
                      await fetch('/api/bot/restart', { method: 'POST' });
                      setShowSettings(false);
                    }
                  }}
                  className="flex-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-black py-3 sm:py-4 rounded-xl sm:rounded-2xl transition-all flex items-center justify-center gap-3 text-sm sm:text-base border border-rose-500/20"
                >
                  <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
                  راه‌اندازی مجدد موتور
                </button>
                <button 
                  onClick={saveSettings}
                  className="flex-[2] bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3 sm:py-4 rounded-xl sm:rounded-2xl transition-all flex items-center justify-center gap-3 shadow-xl shadow-emerald-500/20 text-sm sm:text-base"
                >
                  <Save className="w-4 h-4 sm:w-5 sm:h-5" />
                  ذخیره تنظیمات
                </button>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-400 py-3 sm:py-4 rounded-xl sm:rounded-2xl transition-all text-sm sm:text-base"
                >
                  انصراف
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
