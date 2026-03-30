import React, { useState, useEffect } from 'react';
import Chart from 'react-apexcharts';
import { Activity, TrendingUp, TrendingDown, AlertCircle, Clock, Power, ShieldCheck, Settings, Send, Save, X, ChevronRight, Terminal, RefreshCw, Lock, ShieldAlert, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const formatPrice = (price: number) => {
  if (price === undefined || price === null || isNaN(price)) return '---';
  const isNegative = price < 0;
  const absPrice = Math.abs(price);
  const formatted = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(absPrice);
  return `${isNegative ? '-' : ''}${formatted} تومان`;
};

export default function Dashboard() {
  const [botState, setBotState] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showStrategySettings, setShowStrategySettings] = useState(false);
  const [showCreatePortfolio, setShowCreatePortfolio] = useState(false);
  const [portfolioUnits, setPortfolioUnits] = useState(1);
  const [isCreatingPortfolio, setIsCreatingPortfolio] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAutoTuning, setIsAutoTuning] = useState(false);
  const [autoTuneResults, setAutoTuneResults] = useState<any>(null);

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

    // Fetch initial autotune results
    fetch('/api/bot/autotune/results')
      .then(res => res.json())
      .then(data => {
        if (!data.error) setAutoTuneResults(data);
      })
      .catch(() => {});

    return () => {
      ws.close();
      clearTimeout(timeout);
    };
  }, [botState === null]);

  const toggleTrading = async () => {
    await fetch('/api/bot/toggle', { method: 'POST' });
  };

  const toggleHighQuality = async () => {
    if (!settings) return;
    const newSettings = {
      ...settings,
      strategy: {
        ...settings.strategy,
        highQualityMode: !settings.strategy.highQualityMode
      }
    };
    setSettings(newSettings);
    await fetch('/api/bot/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
  };

  const manualTrade = async (action: 'BUY' | 'SELL') => {
    await fetch('/api/bot/manual-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
  };

  const closeAllTrades = async () => {
    if (window.confirm('آیا از بستن تمام پوزیشن‌ها اطمینان دارید؟')) {
      await fetch('/api/bot/close-all', { method: 'POST' });
    }
  };

  const saveSettings = async () => {
    await fetch('/api/bot/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    setShowSettings(false);
  };

  const runAutoTune = async () => {
    if (isAutoTuning) return;
    setIsAutoTuning(true);
    try {
      const res = await fetch('/api/bot/autotune', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setAutoTuneResults(data.result);
        alert('بهینه‌سازی با موفقیت انجام شد و پارامترهای جدید اعمال شدند.');
      } else {
        alert('خطا در بهینه‌سازی: ' + (data.error || 'خطای ناشناخته'));
      }
    } catch (e) {
      alert('خطا در ارتباط با سرور');
    } finally {
      setIsAutoTuning(false);
    }
  };

  const handleCreatePortfolio = async () => {
    if (portfolioUnits <= 0) return;
    setIsCreatingPortfolio(true);
    try {
      const res = await fetch('/api/bot/create-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: portfolioUnits })
      });
      const data = await res.json();
      if (data.success) {
        setShowCreatePortfolio(false);
      } else {
        alert(data.message || 'خطا در ایجاد پرتفو');
      }
    } catch (e) {
      alert('خطا در ارتباط با سرور');
    } finally {
      setIsCreatingPortfolio(false);
    }
  };

  // Calculate Highs and Lows for Chart Annotations
  const candles = botState?.candles || [];
  const { maxHigh, minLow, maxHighTime, minLowTime } = React.useMemo(() => {
    let maxHigh = -Infinity;
    let minLow = Infinity;
    let maxHighTime = 0;
    let minLowTime = 0;

    candles.forEach((c: any) => {
      const [open, high, low, close] = c.y;
      if (high > maxHigh) { maxHigh = high; maxHighTime = c.x; }
      if (low < minLow) { minLow = low; minLowTime = c.x; }
    });
    return { maxHigh, minLow, maxHighTime, minLowTime };
  }, [candles]);

  const chartAnnotations = React.useMemo(() => {
    const points = [];
    if (maxHigh !== -Infinity && candles.length > 0) {
      points.push({
        x: maxHighTime,
        y: maxHigh,
        marker: { size: 4, fillColor: '#10b981', strokeColor: '#fff', strokeWidth: 2 },
        label: {
          borderColor: '#10b981',
          style: { color: '#fff', background: '#10b981', fontSize: '10px', fontFamily: 'monospace' },
          text: `سقف: ${maxHigh.toLocaleString('fa-IR')}`
        }
      });
    }
    if (minLow !== Infinity && candles.length > 0) {
      points.push({
        x: minLowTime,
        y: minLow,
        marker: { size: 4, fillColor: '#f43f5e', strokeColor: '#fff', strokeWidth: 2 },
        label: {
          borderColor: '#f43f5e',
          style: { color: '#fff', background: '#f43f5e', fontSize: '10px', fontFamily: 'monospace' },
          text: `کف: ${minLow.toLocaleString('fa-IR')}`
        }
      });
    }
    return { points };
  }, [maxHigh, minLow, maxHighTime, minLowTime, candles.length]);

  // Prepare series data
  const seriesData = React.useMemo(() => {
    const series: any[] = [{
      name: 'قیمت',
      type: 'candlestick',
      data: candles
    }];

    if (botState?.settings?.activeStrategy === 'HST') {
      if (botState.hmaLine && botState.hmaLine.length > 0) {
        series.push({
          name: 'HMA',
          type: 'line',
          data: botState.hmaLine
        });
      }
      
      if (botState.stLine && botState.stLine.length > 0) {
        const stUp: any[] = [];
        const stDown: any[] = [];
        botState.stLine.forEach((pt: any) => {
          if (pt.direction === 1) {
            stUp.push({ x: pt.x, y: pt.y });
            stDown.push({ x: pt.x, y: null });
          } else {
            stDown.push({ x: pt.x, y: pt.y });
            stUp.push({ x: pt.x, y: null });
          }
        });
        series.push({ name: 'ST Up', type: 'line', data: stUp });
        series.push({ name: 'ST Down', type: 'line', data: stDown });
      }
    } else if (botState?.settings?.activeStrategy === 'HMAMACD') {
      if (botState.hmaFastLine && botState.hmaFastLine.length > 0) {
        series.push({
          name: 'HMA Fast',
          type: 'line',
          data: botState.hmaFastLine,
          color: '#3b82f6' // Blue
        });
      }
      if (botState.hmaSlowLine && botState.hmaSlowLine.length > 0) {
        series.push({
          name: 'HMA Slow',
          type: 'line',
          data: botState.hmaSlowLine,
          color: '#f59e0b' // Orange
        });
      }
    }
    return series;
  }, [candles, botState?.hmaLine, botState?.stLine, botState?.hmaFastLine, botState?.hmaSlowLine, botState?.settings?.activeStrategy]);

  const chartOptions = React.useMemo(() => ({
    chart: {
      type: 'candlestick' as const,
      background: 'transparent',
      toolbar: { show: false },
      animations: { enabled: false },
      sparkline: { enabled: false },
    },
    theme: { mode: 'dark' as const },
    annotations: chartAnnotations,
    plotOptions: {
      candlestick: {
        colors: { upward: '#10b981', downward: '#f43f5e' },
        wick: { useFillColor: true }
      }
    },
    stroke: {
      width: [1, 2, 2, 2],
      curve: 'smooth' as const
    },
    colors: ['#10b981', '#3b82f6', '#10b981', '#f43f5e'],
    xaxis: {
      type: 'datetime' as const,
      labels: {
        style: { colors: '#64748b', fontFamily: 'monospace' },
        datetimeUTC: false,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false }
    },
    yaxis: {
      tooltip: { enabled: true },
      decimalsInFloat: 0,
      forceNiceScale: true,
      labels: {
        style: { colors: '#64748b', fontFamily: 'monospace' },
        formatter: (val: number) => val.toLocaleString('fa-IR')
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
  }), [chartAnnotations]);

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
              <span className="text-[10px] text-slate-500 font-mono uppercase">اتصال</span>
              <div className="flex gap-0.5">
                {[1, 2, 3].map(i => (
                  <div 
                    key={i} 
                    className={`w-1 h-3 rounded-full ${
                      !botState.isConnected ? 'bg-slate-700' :
                      botState.latency < 500 ? 'bg-emerald-500' :
                      botState.latency < 1500 ? (i <= 2 ? 'bg-amber-500' : 'bg-slate-700') :
                      (i <= 1 ? 'bg-rose-500' : 'bg-slate-700')
                    }`} 
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-mono uppercase">امنیت</span>
              <button 
                onClick={() => {
                  const newSettings = { ...botState.settings, risk: { ...botState.settings.risk, antiArbitrage: { ...botState.settings.risk?.antiArbitrage, enabled: !botState.settings.risk?.antiArbitrage?.enabled } } };
                  fetch('/api/bot/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSettings) });
                }}
                className={`w-8 h-4 rounded-full transition-colors relative ${botState.settings?.risk?.antiArbitrage?.enabled ? 'bg-rose-500' : 'bg-slate-700'}`}
              >
                <motion.div animate={{ x: botState.settings?.risk?.antiArbitrage?.enabled ? 16 : 2 }} className="w-3 h-3 bg-white rounded-full absolute top-0.5" />
              </button>
            </div>
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
              <span className="text-[10px] text-slate-500 font-mono uppercase">پله‌ای</span>
              <button 
                onClick={() => {
                  const newSettings = { ...botState.settings, targets: { ...botState.settings.targets, steppedRiskFree: { ...botState.settings.targets?.steppedRiskFree, enabled: !botState.settings.targets?.steppedRiskFree?.enabled } } };
                  fetch('/api/bot/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSettings) });
                }}
                className={`w-8 h-4 rounded-full transition-colors relative ${botState.settings?.targets?.steppedRiskFree?.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
              >
                <motion.div animate={{ x: botState.settings?.targets?.steppedRiskFree?.enabled ? 16 : 2 }} className="w-3 h-3 bg-white rounded-full absolute top-0.5" />
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
              <option value="NUMERICAL">نوسان‌گیری عددی (مظنه)</option>
              <option value="HST">استراتژی HST</option>
              <option value="PINBAR">پین بار (پرایس اکشن)</option>
              <option value="MTF_PATTERN">الگوهای MTF</option>
              <option value="ICHIMOKU_MTF">ایچیموکو MTF</option>
              <option value="ICHIMOKU_HARAMI">ایچیموکو هارامی</option>
            </select>
          </div>
          <div className="hidden lg:block text-right bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
            <p className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-0.5">موجودی حساب</p>
            <div className="flex items-center gap-3">
              <p className="text-lg font-black font-mono text-white">
                {botState.portfolio ? formatPrice(botState.portfolio.balance) : '---'}
              </p>
              {(!botState.portfolio || !botState.portfolio.has_portfolio) && (
                <button 
                  onClick={() => setShowCreatePortfolio(true)}
                  className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-xs font-bold px-2 py-1 rounded-lg transition-colors"
                >
                  ایجاد پرتفو
                </button>
              )}
            </div>
          </div>
          <div className="hidden lg:block text-right bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
            <p className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-0.5">عملکرد امروز</p>
            <p className={`text-lg font-black font-mono ${botState.dailyPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {botState.dailyPnL > 0 ? '+' : ''}{formatPrice(botState.dailyPnL)}
            </p>
          </div>
          
          <div className="flex items-center gap-2 bg-white/5 p-1.5 rounded-2xl border border-white/5">
            <button 
              onClick={toggleHighQuality}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${settings?.strategy?.highQualityMode ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
              title="حالت سیگنال‌های با کیفیت (تعداد کمتر، دقت بیشتر)"
            >
              <div className="relative">
                <ShieldAlert className="w-4 h-4" />
                {settings?.strategy?.highQualityMode && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full border border-amber-500"
                  />
                )}
              </div>
              <span className="hidden sm:inline">کیفیت بالا</span>
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
          <div className="lg:hidden flex items-center justify-between bg-[#0f0f0f] border border-white/5 rounded-2xl p-4">
            <div>
              <p className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-0.5">موجودی حساب</p>
              <p className="text-lg font-black font-mono text-white">
                {botState.portfolio ? formatPrice(botState.portfolio.balance) : '---'}
              </p>
            </div>
            {(!botState.portfolio || !botState.portfolio.has_portfolio) && (
              <button 
                onClick={() => setShowCreatePortfolio(true)}
                className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-xs font-bold px-3 py-2 rounded-xl transition-colors"
              >
                ایجاد پرتفو
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 sm:gap-6">
            {[
              { label: 'قیمت لحظه‌ای', value: formatPrice(botState.price), icon: TrendingUp, color: 'text-white' },
              { label: 'تاخیر قیمت (ms)', value: botState.latency ? `${botState.latency}ms` : '---', icon: Activity, color: botState.latency > 1000 ? 'text-rose-500' : botState.latency > 500 ? 'text-amber-500' : 'text-emerald-500' },
              { label: 'وضعیت بازار', value: botState.indicators?.regime || '---', icon: Activity, color: botState.indicators?.regime === 'TRENDING' ? 'text-emerald-500' : botState.indicators?.regime === 'RANGING' ? 'text-amber-500' : 'text-white' },
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
                  <div className="hidden sm:flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                      <span className="text-[9px] text-slate-500">وضعیت بازار:</span>
                      <span className={`text-[10px] font-bold ${botState.marketAnalysis.color}`}>{botState.marketAnalysis.trend}</span>
                    </div>
                    {botState.mtfStatus && (
                      <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                        <span className="text-[9px] text-slate-500">تاییدیه MTF:</span>
                        <span className={`text-[10px] font-bold ${botState.mtfStatus.status === 'CONFIRMED' ? (botState.mtfStatus.trend === 'BUY' ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-500'}`}>
                          {botState.mtfStatus.status === 'CONFIRMED' ? (botState.mtfStatus.trend === 'BUY' ? 'صعودی (5m)' : 'نزولی (5m)') : 'در حال تحلیل...'}
                        </span>
                      </div>
                    )}
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
                options={chartOptions}
                series={seriesData}
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
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[8px] sm:text-[9px] text-slate-400 font-mono uppercase">{pos.pattern || 'EMA CROSS'}</span>
                          {pos.strength && (
                            <span className={`text-[7px] sm:text-[8px] px-1.5 py-0.5 rounded-md font-bold flex items-center gap-1 ${
                              pos.strength === 'STRONG' ? 'bg-rose-500/20 text-rose-500' : 
                              pos.strength === 'WEAK' ? 'bg-slate-500/20 text-slate-400' : 
                              'bg-blue-500/20 text-blue-400'
                            }`}>
                              {pos.strength === 'STRONG' ? '🔥 STRONG' : pos.strength === 'WEAK' ? '⚠️ WEAK' : '✨ NORMAL'}
                            </span>
                          )}
                          {pos.isHQ && (
                            <span className="text-[7px] sm:text-[8px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded-md font-bold flex items-center gap-1">
                              <ShieldAlert className="w-2 h-2" />
                              HQ
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] sm:text-[10px] text-slate-500 font-mono">{new Date(pos.entryTime).toLocaleTimeString('fa-IR')}</span>
                        <span className="text-[8px] text-emerald-500 font-bold mt-1">
                          Target: {pos.tp3Hit ? 'TP3' : pos.tp2Hit ? 'TP3' : pos.tp1Hit ? 'TP2' : 'TP1'}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-mono mb-1">ورود</p>
                        <p className="text-xs sm:text-sm font-bold font-mono text-white">{formatPrice(pos.entry)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-mono mb-1">سود/ضرر لحظه‌ای</p>
                        <p className={`text-[10px] sm:text-xs font-bold font-mono ${
                          ((pos.type === 'BUY' ? botState.price - pos.entry : pos.entry - botState.price) / (botState.settings?.market?.tickSize || 1)) * (botState.settings?.market?.tickValueToman || 23000) * (pos.units || 1) >= 0 
                            ? 'text-emerald-500' 
                            : 'text-rose-500'
                        }`}>
                          {formatPrice(
                            ((pos.type === 'BUY' ? botState.price - pos.entry : pos.entry - botState.price) / (botState.settings?.market?.tickSize || 1)) * (botState.settings?.market?.tickValueToman || 23000) * (pos.units || 1)
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <p className="text-[7px] text-slate-500 uppercase mb-1">TP1</p>
                        <p className={`text-[9px] font-bold ${pos.tp1Hit ? 'text-emerald-500' : 'text-slate-400'}`}>{formatPrice(pos.tp1)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[7px] text-slate-500 uppercase mb-1">TP2</p>
                        <p className={`text-[9px] font-bold ${pos.tp2Hit ? 'text-emerald-500' : 'text-slate-400'}`}>{formatPrice(pos.tp2)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[7px] text-slate-500 uppercase mb-1">TP3</p>
                        <p className={`text-[9px] font-bold ${pos.tp3Hit ? 'text-emerald-500' : 'text-slate-400'}`}>{formatPrice(pos.tp3)}</p>
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
                className="bg-slate-800 hover:bg-slate-700 text-white py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm transition-all"
              >
                بستن تمام پوزیشن‌ها
              </button>
              <button 
                onClick={async () => {
                  if (window.confirm('آیا از ریست کردن آمار و تاریخچه اطمینان دارید؟')) {
                    await fetch('/api/bot/reset-stats', { method: 'POST' });
                  }
                }}
                className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-500 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                ریست معاملات
              </button>
            </div>

            {/* Auto-Tune & Backtest Results */}
            <div className="mb-8 p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-3xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-emerald-500" />
                  <h3 className="text-sm font-bold text-white">بهینه‌سازی هوشمند (Auto-Tune)</h3>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                    <span className="text-[9px] text-slate-500">تمرکز بر سود حداکثری:</span>
                    <button 
                      onClick={async () => {
                        const newSettings = { 
                          ...settings, 
                          autoTune: { 
                            ...settings.autoTune, 
                            maximizeBigWins: !settings.autoTune?.maximizeBigWins 
                          } 
                        };
                        setSettings(newSettings);
                        await fetch('/api/bot/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(newSettings)
                        });
                      }}
                      className={`w-8 h-4 rounded-full transition-colors relative ${settings?.autoTune?.maximizeBigWins ? 'bg-emerald-500' : 'bg-slate-700'}`}
                    >
                      <motion.div animate={{ x: settings?.autoTune?.maximizeBigWins ? 16 : 2 }} className="w-3 h-3 bg-white rounded-full absolute top-0.5" />
                    </button>
                  </div>
                  <button 
                    onClick={async () => {
                      if (confirm('آیا مطمئن هستید که می‌خواهید تنظیمات را به حالت قبل از آخرین بهینه‌سازی برگردانید؟')) {
                        const res = await fetch('/api/bot/restore-settings', { method: 'POST' });
                        const data = await res.json();
                        if (data.success) {
                          alert('تنظیمات با موفقیت بازیابی شد.');
                        } else {
                          alert('خطا در بازیابی تنظیمات. شاید بک‌آپی وجود ندارد.');
                        }
                      }
                    }}
                    className="px-4 py-2 rounded-xl text-[10px] font-bold transition-all bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/5 flex items-center gap-2"
                  >
                    <RefreshCw className="w-3 h-3" />
                    بازگشت به تنظیمات قبلی
                  </button>
                  <button 
                    onClick={runAutoTune}
                    disabled={isAutoTuning}
                    className={`px-4 py-2 rounded-xl text-[10px] font-bold transition-all flex items-center gap-2 ${isAutoTuning ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20'}`}
                  >
                    {isAutoTuning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    {isAutoTuning ? 'در حال بهینه‌سازی...' : 'شروع بهینه‌سازی'}
                  </button>
                </div>
              </div>
              
              {autoTuneResults ? (
                <div className="space-y-4">
                  <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20 mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-slate-400 uppercase font-mono">استراتژی پیشنهادی</span>
                      <span className="text-xs font-black text-emerald-500 bg-emerald-500/20 px-2 py-0.5 rounded-lg">{autoTuneResults.bestStrategy || '---'}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      بر اساس تحلیل داده‌های اخیر، استراتژی <span className="text-white font-bold">{autoTuneResults.bestStrategy}</span> بیشترین بازدهی را با پارامترهای فعلی بازار داشته است.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-black/20 p-3 rounded-2xl border border-white/5">
                      <p className="text-[8px] text-slate-500 uppercase mb-1">سود خالص (تیک)</p>
                      <p className="text-sm font-black text-emerald-500">{autoTuneResults.metrics?.netTicks || 0}</p>
                    </div>
                    <div className="bg-black/20 p-3 rounded-2xl border border-white/5">
                      <p className="text-[8px] text-slate-500 uppercase mb-1">ضریب سود (PF)</p>
                      <p className="text-sm font-black text-white">{autoTuneResults.metrics?.profitFactor?.toFixed(2) || 0}</p>
                    </div>
                    <div className="bg-black/20 p-3 rounded-2xl border border-white/5">
                      <p className="text-[8px] text-slate-500 uppercase mb-1">وین ریت (WR)</p>
                      <p className="text-sm font-black text-emerald-500">{Math.round((autoTuneResults.metrics?.winRate || 0) * 100)}%</p>
                    </div>
                  </div>

                  {autoTuneResults.bestHours && (
                    <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                      <p className="text-[10px] text-slate-400 uppercase font-mono mb-3 flex items-center gap-2">
                        <Clock className="w-3 h-3" /> بهترین ساعات ترید (بر اساس سود خالص)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {autoTuneResults.bestHours.map((h: any, idx: number) => (
                          <div key={idx} className="bg-white/5 px-3 py-1.5 rounded-xl border border-white/5 flex flex-col items-center">
                            <span className="text-[10px] font-bold text-white">{h.hour}:00</span>
                            <span className={`text-[8px] ${h.netTicks >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {h.netTicks > 0 ? '+' : ''}{h.netTicks} تیک
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                    <span>آخرین اجرا: {new Date(autoTuneResults.generatedAt).toLocaleString('fa-IR')}</span>
                    <span className="text-emerald-500">امتیاز استراتژی: {autoTuneResults.objectiveScore?.toFixed(1)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 italic text-center py-4">هنوز بهینه‌سازی انجام نشده است. برای پیدا کردن بهترین تنظیمات، دکمه بالا را بزنید.</p>
              )}
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
                    + "Type,Entry,Exit,PnL,Reason,Strategy,BreakEven,TP1,TP2,TP3\n"
                    + (botState.closedPositions || []).map((p: any) => `${p.type},${p.entry},${p.exitPrice},${p.pnl},${p.reason},${p.strategy || 'MANUAL'},${p.details?.breakEven || 'خیر'},${p.details?.tp1 || 'خیر'},${p.details?.tp2 || 'خیر'},${p.details?.tp3 || 'خیر'}`).join("\n");
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
                <div key={i} className="bg-white/5 p-3 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-3">
                      <span className={`text-[9px] sm:text-[10px] font-bold px-2 py-0.5 sm:py-1 rounded-md ${pos.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>
                        {pos.type}
                      </span>
                      <span className={`text-[10px] sm:text-xs font-mono font-bold ${pos.pnl > 0 ? 'text-emerald-500' : pos.pnl < 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                        {pos.pnl > 0 ? '+' : ''}{formatPrice(pos.pnl)}
                      </span>
                    </div>
                    <div className="text-left">
                      <span className="text-[9px] sm:text-[10px] text-slate-500">{new Date(pos.exitTime).toLocaleTimeString('fa-IR')}</span>
                    </div>
                  </div>
                  
                  {pos.details && (
                    <div className="grid grid-cols-4 gap-1 mt-2 pt-2 border-t border-white/5">
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-mono">ریسک‌فری</p>
                        <p className={`text-[9px] font-bold ${pos.details.breakEven === 'فعال شده' ? 'text-emerald-500' : 'text-slate-400'}`}>{pos.details.breakEven}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-mono">تارگت ۱</p>
                        <p className={`text-[9px] font-bold ${pos.details.tp1 === 'تاچ شده' ? 'text-emerald-500' : 'text-slate-400'}`}>{pos.details.tp1}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-mono">تارگت ۲/۳</p>
                        <p className={`text-[9px] font-bold ${pos.details.tp2 === 'تاچ شده' || pos.details.tp3 === 'تاچ شده' ? 'text-emerald-500' : 'text-slate-400'}`}>
                          {pos.details.tp3 === 'تاچ شده' ? 'TP3 ✅' : pos.details.tp2 === 'تاچ شده' ? 'TP2 ✅' : 'خیر'}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-mono">قدرت</p>
                        <p className={`text-[9px] font-bold ${pos.details.strength === 'STRONG' ? 'text-rose-500' : 'text-slate-300'}`}>{pos.details.strength || 'NORMAL'}</p>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex justify-between items-center mt-2 text-[8px] text-slate-600 font-mono">
                    <span>ورود: {formatPrice(pos.entry)}</span>
                    <span>خروج: {formatPrice(pos.exitPrice)}</span>
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
                {/* Account & Data Source Selection */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Lock className="w-4 h-4" /> تنظیمات حساب و اتصال
                  </h3>
                  
                  <div className="bg-white/5 p-5 rounded-3xl border border-white/5 mb-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${settings.api?.useRealAccount ? 'bg-rose-500/20 text-rose-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                          <ShieldAlert className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">حساب واقعی (Real Account)</p>
                          <p className="text-[10px] text-slate-500">فعال‌سازی ترید روی حساب اصلی فرازگلد</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setSettings({ ...settings, api: { ...settings.api, useRealAccount: !settings.api?.useRealAccount } })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.api?.useRealAccount ? 'bg-rose-500' : 'bg-slate-700'}`}
                      >
                        <motion.div 
                          animate={{ x: settings.api?.useRealAccount ? 24 : 4 }}
                          className="absolute top-1 w-4 h-4 bg-white rounded-full"
                        />
                      </button>
                    </div>
                    
                    {settings.api?.useRealAccount && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-4 pt-4 border-t border-white/5"
                      >
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Real Access Token</label>
                            <input 
                              type="password" 
                              value={settings.api?.real?.accessToken || ''}
                              onChange={(e) => setSettings({ ...settings, api: { ...settings.api, real: { ...settings.api.real, accessToken: e.target.value } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-rose-500/50 outline-none transition-all"
                              placeholder="توکن دسترسی ریل"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Real Refresh Token</label>
                            <input 
                              type="password" 
                              value={settings.api?.real?.refreshToken || ''}
                              onChange={(e) => setSettings({ ...settings, api: { ...settings.api, real: { ...settings.api.real, refreshToken: e.target.value } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-rose-500/50 outline-none transition-all"
                              placeholder="توکن رفرش ریل"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Real CSRF Token</label>
                            <input 
                              type="password" 
                              value={settings.api?.real?.csrftoken || ''}
                              onChange={(e) => setSettings({ ...settings, api: { ...settings.api, real: { ...settings.api.real, csrftoken: e.target.value } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-rose-500/50 outline-none transition-all"
                              placeholder="توکن حساب ریل"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Real Session ID</label>
                            <input 
                              type="password" 
                              value={settings.api?.real?.sessionid || ''}
                              onChange={(e) => setSettings({ ...settings, api: { ...settings.api, real: { ...settings.api.real, sessionid: e.target.value } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-rose-500/50 outline-none transition-all"
                              placeholder="سشن حساب ریل"
                            />
                          </div>
                        </div>
                        <p className="text-[9px] text-rose-500 font-bold flex items-center gap-2">
                          <AlertCircle className="w-3 h-3" /> هشدار: در حالت ریل، معاملات با پول واقعی انجام می‌شود.
                        </p>
                      </motion.div>
                    )}
                  </div>

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
                              متصل ({settings.api?.useRealAccount ? 'REAL' : 'DEMO'})
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
                    
                    {!settings.api?.useRealAccount && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Demo Access Token</label>
                            <input 
                              type="password" 
                              value={settings.api?.demo?.accessToken || ''}
                              onChange={(e) => setSettings({ ...settings, api: { ...settings.api, demo: { ...settings.api.demo, accessToken: e.target.value } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Demo Refresh Token</label>
                            <input 
                              type="password" 
                              value={settings.api?.demo?.refreshToken || ''}
                              onChange={(e) => setSettings({ ...settings, api: { ...settings.api, demo: { ...settings.api.demo, refreshToken: e.target.value } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Demo CSRF Token</label>
                          <input 
                            type="password" 
                            value={settings.api?.demo?.csrftoken || ''}
                            onChange={(e) => setSettings({ ...settings, api: { ...settings.api, demo: { ...settings.api.demo, csrftoken: e.target.value } } })}
                            className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Demo Session ID</label>
                          <input 
                            type="password" 
                            value={settings.api?.demo?.sessionid || ''}
                            onChange={(e) => setSettings({ ...settings, api: { ...settings.api, demo: { ...settings.api.demo, sessionid: e.target.value } } })}
                            className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                </section>



                {/* Numerical Strategy Settings removed - moved to dynamic section below */}

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

                {/* Risk-Free Settings */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4" /> تنظیمات ریسک‌فری (Risk-Free)
                  </h3>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                      <span className="text-sm font-medium">فعال‌سازی ریسک‌فری خودکار</span>
                      <button 
                        onClick={() => setSettings({ 
                          ...settings, 
                          targets: { 
                            ...settings.targets, 
                            breakEven: { ...settings.targets?.breakEven, enabled: !settings.targets?.breakEven?.enabled } 
                          } 
                        })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.targets?.breakEven?.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      >
                        <motion.div 
                          animate={{ x: settings.targets?.breakEven?.enabled ? 24 : 4 }}
                          className="absolute top-1 w-4 h-4 bg-white rounded-full"
                        />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">درصد سود برای فعال‌سازی</label>
                        <input 
                          type="number" 
                          value={settings.targets?.breakEven?.triggerPercent || 50}
                          onChange={(e) => setSettings({ 
                            ...settings, 
                            targets: { 
                              ...settings.targets, 
                              breakEven: { ...settings.targets?.breakEven, triggerPercent: parseInt(e.target.value) } 
                            } 
                          })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                        <p className="text-[8px] text-slate-500 mt-1">مثلاً ۵۰ یعنی وقتی معامله ۵۰٪ به سمت تارگت رفت، ریسک‌فری شود.</p>
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">بافر ورود (تیک)</label>
                        <input 
                          type="number" 
                          value={settings.targets?.breakEven?.bufferTicks || 0}
                          onChange={(e) => setSettings({ 
                            ...settings, 
                            targets: { 
                              ...settings.targets, 
                              breakEven: { ...settings.targets?.breakEven, bufferTicks: parseInt(e.target.value) } 
                            } 
                          })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                        />
                        <p className="text-[8px] text-slate-500 mt-1">تعداد تیک بالاتر از نقطه ورود برای پوشش کارمزد.</p>
                      </div>
                    </div>

                    {/* Stepped Risk-Free */}
                    <div className="border-t border-white/5 pt-6 mt-2">
                      <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl mb-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">ریسک‌فری پله‌ای (هوشمند)</span>
                          <span className="text-[10px] text-slate-500">کاهش ریسک در ۳ مرحله با حرکت قیمت</span>
                        </div>
                        <button 
                          onClick={() => setSettings({ 
                            ...settings, 
                            targets: { 
                              ...settings.targets, 
                              steppedRiskFree: { ...settings.targets?.steppedRiskFree, enabled: !settings.targets?.steppedRiskFree?.enabled } 
                            } 
                          })}
                          className={`w-12 h-6 rounded-full transition-colors relative ${settings.targets?.steppedRiskFree?.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.targets?.steppedRiskFree?.enabled ? 24 : 4 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full"
                          />
                        </button>
                      </div>
                      {settings.targets?.steppedRiskFree?.enabled && (
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 space-y-4">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-emerald-500">تنظیمات مراحل</span>
                            <button 
                              onClick={() => {
                                const currentSteps = settings.targets?.steppedRiskFree?.steps || [];
                                setSettings({
                                  ...settings,
                                  targets: {
                                    ...settings.targets,
                                    steppedRiskFree: {
                                      ...settings.targets?.steppedRiskFree,
                                      steps: [...currentSteps, { triggerPct: 50, movePct: 0 }]
                                    }
                                  }
                                });
                              }}
                              className="text-[10px] bg-emerald-500/20 text-emerald-500 px-2 py-1 rounded hover:bg-emerald-500/30 transition-colors"
                            >
                              + افزودن مرحله
                            </button>
                          </div>
                          
                          {(settings.targets?.steppedRiskFree?.steps || []).map((step: any, index: number) => (
                            <div key={index} className="flex items-center gap-3 bg-white/5 p-3 rounded-xl relative group">
                              <div className="flex-1">
                                <label className="text-[9px] text-slate-500 uppercase font-mono mb-1 block">فعال‌سازی (درصد از حد سود)</label>
                                <div className="relative">
                                  <input 
                                    type="number" 
                                    value={step.triggerPct}
                                    onChange={(e) => {
                                      const newSteps = [...(settings.targets?.steppedRiskFree?.steps || [])];
                                      newSteps[index] = { ...newSteps[index], triggerPct: parseFloat(e.target.value) };
                                      setSettings({
                                        ...settings,
                                        targets: {
                                          ...settings.targets,
                                          steppedRiskFree: { ...settings.targets?.steppedRiskFree, steps: newSteps }
                                        }
                                      });
                                    }}
                                    className="w-full bg-black/20 border border-white/5 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500/50"
                                  />
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">%</span>
                                </div>
                              </div>
                              <div className="flex-1">
                                <label className="text-[9px] text-slate-500 uppercase font-mono mb-1 block">جابجایی حد ضرر</label>
                                <div className="relative">
                                  <input 
                                    type="number" 
                                    value={step.movePct}
                                    onChange={(e) => {
                                      const newSteps = [...(settings.targets?.steppedRiskFree?.steps || [])];
                                      newSteps[index] = { ...newSteps[index], movePct: parseFloat(e.target.value) };
                                      setSettings({
                                        ...settings,
                                        targets: {
                                          ...settings.targets,
                                          steppedRiskFree: { ...settings.targets?.steppedRiskFree, steps: newSteps }
                                        }
                                      });
                                    }}
                                    className="w-full bg-black/20 border border-white/5 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500/50"
                                  />
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">%</span>
                                </div>
                              </div>
                              <button 
                                onClick={() => {
                                  const newSteps = [...(settings.targets?.steppedRiskFree?.steps || [])];
                                  newSteps.splice(index, 1);
                                  setSettings({
                                    ...settings,
                                    targets: {
                                      ...settings.targets,
                                      steppedRiskFree: { ...settings.targets?.steppedRiskFree, steps: newSteps }
                                    }
                                  });
                                }}
                                className="absolute -left-2 -top-2 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <div className="text-[9px] text-slate-400 mt-2 p-2 bg-black/20 rounded-xl">
                            <span className="text-emerald-500 font-bold">راهنما:</span><br/>
                            • <b>فعال‌سازی:</b> وقتی قیمت به این درصد از فاصله تا حد سود رسید، مرحله اجرا می‌شود.<br/>
                            • <b>جابجایی:</b> مقدار منفی (مثلاً ۵۰-) یعنی کاهش ۵۰٪ ریسک اولیه. مقدار ۰ یعنی ریسک‌فری کامل (انتقال به نقطه ورود). مقدار مثبت (مثلاً ۲۵) یعنی قفل کردن ۲۵٪ از سود.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Aggressive Systems */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Zap className="w-4 h-4" /> سیستم‌های تهاجمی
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Reversal System */}
                    <div className="flex flex-col bg-white/5 p-4 rounded-2xl">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">سیستم ریورس (Reversal)</span>
                          <span className="text-[10px] text-slate-500">باز کردن پوزیشن معکوس در صورت ضرر</span>
                        </div>
                        <button 
                          onClick={() => setSettings({ 
                            ...settings, 
                            targetsTicks: { 
                              ...settings.targetsTicks, 
                              reversal: { ...settings.targetsTicks?.reversal, enabled: !settings.targetsTicks?.reversal?.enabled } 
                            } 
                          })}
                          className={`w-12 h-6 rounded-full transition-colors relative ${settings.targetsTicks?.reversal?.enabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.targetsTicks?.reversal?.enabled ? 24 : 4 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full"
                          />
                        </button>
                      </div>
                      {settings.targetsTicks?.reversal?.enabled && (
                        <div className="space-y-4 bg-orange-500/5 border border-orange-500/20 p-4 rounded-2xl">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">تعداد تیک ضرر برای فعال‌سازی</label>
                            <input 
                              type="number" 
                              value={settings.targetsTicks?.reversal?.triggerLossTicks || 6}
                              onChange={(e) => setSettings({ 
                                ...settings, 
                                targetsTicks: { 
                                  ...settings.targetsTicks, 
                                  reversal: { ...settings.targetsTicks?.reversal, triggerLossTicks: parseInt(e.target.value) } 
                                } 
                              })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-orange-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداقل قدرت سیگنال معکوس</label>
                            <input 
                              type="number" 
                              value={settings.targetsTicks?.reversal?.minOppositeSignalScore || 2}
                              onChange={(e) => setSettings({ 
                                ...settings, 
                                targetsTicks: { 
                                  ...settings.targetsTicks, 
                                  reversal: { ...settings.targetsTicks?.reversal, minOppositeSignalScore: parseInt(e.target.value) } 
                                } 
                              })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-orange-500/50"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Pyramiding System */}
                    <div className="flex flex-col bg-white/5 p-4 rounded-2xl">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">سیستم پله‌ای (Pyramiding)</span>
                          <span className="text-[10px] text-slate-500">افزایش حجم در روند سودده</span>
                        </div>
                        <button 
                          onClick={() => setSettings({ 
                            ...settings, 
                            strategy: { 
                              ...settings.strategy, 
                              pyramiding: { ...settings.strategy?.pyramiding, enabled: !settings.strategy?.pyramiding?.enabled } 
                            } 
                          })}
                          className={`w-12 h-6 rounded-full transition-colors relative ${settings.strategy?.pyramiding?.enabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.strategy?.pyramiding?.enabled ? 24 : 4 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full"
                          />
                        </button>
                      </div>
                      {settings.strategy?.pyramiding?.enabled && (
                        <div className="space-y-4 bg-orange-500/5 border border-orange-500/20 p-4 rounded-2xl">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">تعداد تیک سود برای ورود پله دوم</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.pyramiding?.profitTicksTrigger || 5}
                              onChange={(e) => setSettings({ 
                                ...settings, 
                                strategy: { 
                                  ...settings.strategy, 
                                  pyramiding: { ...settings.strategy?.pyramiding, profitTicksTrigger: parseInt(e.target.value) } 
                                } 
                              })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-orange-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-1">پس از این مقدار سود، پله دوم وارد می‌شود.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Security Settings */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Lock className="w-4 h-4" /> امنیت و آنتی-آربیتراژ
                  </h3>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">بسته امنیتی آنتی-آربیتراژ</span>
                        <span className="text-[10px] text-slate-500">جلوگیری از حساسیت صرافی در حساب واقعی</span>
                      </div>
                      <button 
                        onClick={() => setSettings({ 
                          ...settings, 
                          risk: { 
                            ...settings.risk, 
                            antiArbitrage: { ...settings.risk?.antiArbitrage, enabled: !settings.risk?.antiArbitrage?.enabled } 
                          } 
                        })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.risk?.antiArbitrage?.enabled ? 'bg-rose-500' : 'bg-slate-700'}`}
                      >
                        <motion.div 
                          animate={{ x: settings.risk?.antiArbitrage?.enabled ? 24 : 4 }}
                          className="absolute top-1 w-4 h-4 bg-white rounded-full"
                        />
                      </button>
                    </div>
                    {settings.risk?.antiArbitrage?.enabled && (
                      <div className="space-y-4 bg-rose-500/5 border border-rose-500/20 p-4 rounded-2xl">
                        <div>
                          <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداقل زمان نگهداری (ثانیه)</label>
                          <input 
                            type="number" 
                            value={settings.risk?.antiArbitrage?.minHoldTimeSeconds || 30}
                            onChange={(e) => setSettings({ 
                              ...settings, 
                              risk: { 
                                ...settings.risk, 
                                antiArbitrage: { ...settings.risk?.antiArbitrage, minHoldTimeSeconds: parseInt(e.target.value) } 
                              } 
                            })}
                            className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-rose-500/50"
                          />
                          <p className="text-[8px] text-slate-500 mt-1">صرافی‌ها به پوزیشن‌های زیر ۳۰ ثانیه حساس هستند.</p>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-rose-500/70">
                          <ShieldAlert className="w-3 h-3" />
                          <span>تاخیر تصادفی (Jitter) برای شبیه‌سازی رفتار انسانی فعال است.</span>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Telegram Settings */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Send className="w-4 h-4" /> تنظیمات تلگرام
                  </h3>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                        <span className="text-sm font-medium">فعال‌سازی تلگرام</span>
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
                      <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                        <span className="text-sm font-medium">ارسال لاگ‌ها به تلگرام</span>
                        <button 
                          onClick={() => setSettings({ ...settings, telegram: { ...settings.telegram, logEnabled: !settings.telegram.logEnabled } })}
                          className={`w-12 h-6 rounded-full transition-colors relative ${settings.telegram.logEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.telegram.logEnabled ? 24 : 4 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full"
                          />
                        </button>
                      </div>
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
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">شناسه چت (Chat IDs - با کاما جدا کنید)</label>
                        <input 
                          type="text" 
                          value={settings.telegram.chatId}
                          onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, chatId: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                          placeholder="مثلاً 123456, 789012"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">راهنمای سریع (Quick Guide)</label>
                        <textarea 
                          value={settings.telegram.quickGuide}
                          onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, quickGuide: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all h-24 resize-none"
                          placeholder="متن راهنمای سریع برای سیگنال‌ها"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Rubika Settings */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <Send className="w-4 h-4" /> تنظیمات روبیکا
                  </h3>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                        <span className="text-sm font-medium">فعال‌سازی روبیکا</span>
                        <button 
                          onClick={() => setSettings({ ...settings, rubika: { ...settings.rubika, enabled: !settings.rubika?.enabled } })}
                          className={`w-12 h-6 rounded-full transition-colors relative ${settings.rubika?.enabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.rubika?.enabled ? 24 : 4 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full"
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                        <span className="text-sm font-medium">ارسال لاگ‌ها به روبیکا</span>
                        <button 
                          onClick={() => setSettings({ ...settings, rubika: { ...settings.rubika, logEnabled: !settings.rubika?.logEnabled } })}
                          className={`w-12 h-6 rounded-full transition-colors relative ${settings.rubika?.logEnabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.rubika?.logEnabled ? 24 : 4 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full"
                          />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">توکن ربات روبیکا</label>
                        <input 
                          type="password" 
                          value={settings.rubika?.botToken || ''}
                          onChange={(e) => setSettings({ ...settings, rubika: { ...settings.rubika, botToken: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-orange-500/50 outline-none transition-all"
                          placeholder="توکن روبیکا را اینجا وارد کنید"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">شناسه چت روبیکا (Chat IDs - با کاما جدا کنید)</label>
                        <input 
                          type="text" 
                          value={settings.rubika?.chatId || ''}
                          onChange={(e) => setSettings({ ...settings, rubika: { ...settings.rubika, chatId: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-orange-500/50 outline-none transition-all"
                          placeholder="مثلاً b0LWeW0W..."
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Trade Settings */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4" /> تنظیمات معامله
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حجم معامله (تعداد واحد - Units)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={settings.trade?.minUnits || 1}
                        onChange={(e) => setSettings({ ...settings, trade: { ...settings.trade, minUnits: parseFloat(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm outline-none focus:border-emerald-500/50"
                      />
                      <p className="text-[8px] text-slate-500 mt-1">تعداد واحد پایه برای هر معامله. پیش‌فرض ۱ واحد است.</p>
                    </div>

                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">تغییر حجم هوشمند</span>
                        <span className="text-[10px] text-slate-500">تغییر حجم بر اساس قدرت سیگنال (۱.۵ برابر برای قوی)</span>
                      </div>
                      <button 
                        onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, enableStrengthScaling: !settings.strategy?.enableStrengthScaling } })}
                        className={`w-12 h-6 rounded-full transition-all duration-300 relative ${settings.strategy?.enableStrengthScaling ? 'bg-emerald-500' : 'bg-white/10'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${settings.strategy?.enableStrengthScaling ? 'right-1' : 'right-7'}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">افزایش حجم خودکار (HQ)</span>
                        <span className="text-[10px] text-slate-500">افزایش حجم در حالت High Quality</span>
                      </div>
                      <button 
                        onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, highQuality: { ...settings.strategy?.highQuality, autoScaleVolume: !settings.strategy?.highQuality?.autoScaleVolume } } })}
                        className={`w-12 h-6 rounded-full transition-all duration-300 relative ${settings.strategy?.highQuality?.autoScaleVolume ? 'bg-emerald-500' : 'bg-white/10'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${settings.strategy?.highQuality?.autoScaleVolume ? 'right-1' : 'right-7'}`} />
                      </button>
                    </div>
                  </div>
                </section>

                {/* Signal Quality Settings */}
                <section>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                    <ShieldAlert className="w-4 h-4" /> کیفیت سیگنال‌ها
                  </h3>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">حالت کیفیت بالا (High Quality)</span>
                        <span className="text-[10px] text-slate-500">تعداد سیگنال کمتر، اما با دقت و تاییدیه بسیار بیشتر (مناسب حساب واقعی)</span>
                      </div>
                      <button 
                        onClick={() => setSettings({ 
                          ...settings, 
                          strategy: { ...settings.strategy, highQualityMode: !settings.strategy.highQualityMode } 
                        })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.strategy?.highQualityMode ? 'bg-amber-500' : 'bg-slate-700'}`}
                      >
                        <motion.div 
                          animate={{ x: settings.strategy?.highQualityMode ? 24 : 4 }}
                          className="absolute top-1 w-4 h-4 bg-white rounded-full"
                        />
                      </button>
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
                      { id: 'HMAMACD', label: 'HMA + MACD', desc: 'کراس Hull و تایید MACD' },
                      { id: 'SCALP', label: 'اسکالپر پرو', desc: 'مبتنی بر RSI و EMA' },
                      { id: 'FAST', label: 'فوق سریع', desc: 'واکنش سریع به نوسان' },
                      { id: 'QUANT', label: 'کوانت', desc: 'پرایس اکشن و الگوها' },
                      { id: 'TREND', label: 'ترند فالووینگ', desc: 'کراس MA و MACD' },
                      { id: 'NUMERICAL', label: 'نوسان‌گیری عددی', desc: 'مومنتوم و اعداد رند' },
                      { id: 'HST', label: 'استراتژی HST', desc: 'تایید دوگانه Hull+SuperTrend' },
                      { id: 'PINBAR', label: 'پین بار', desc: 'پرایس اکشن و سایه‌ها' },
                      { id: 'MTF_PATTERN', label: 'الگوهای MTF', desc: 'سطوح و الگوهای چندزمانی' },
                      { id: 'ICHIMOKU_MTF', label: 'ایچیموکو MTF', desc: 'ایچیموکو و سطوح کلاسیک' },
                      { id: 'ICHIMOKU_HARAMI', label: 'ایچیموکو هارامی', desc: 'ایچیموکو و الگوهای بازگشتی' }
                    ].map(type => (
                      <div
                        role="button"
                        tabIndex={0}
                        key={type.id}
                        onClick={() => {
                          setSettings({ ...settings, activeStrategy: type.id });
                          setShowStrategySettings(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSettings({ ...settings, activeStrategy: type.id });
                            setShowStrategySettings(false);
                          }
                        }}
                        className={`p-4 rounded-2xl border transition-all text-right relative overflow-hidden group cursor-pointer ${settings.activeStrategy === type.id ? 'bg-emerald-500/10 border-emerald-500 text-white' : 'bg-white/5 border-white/5 text-slate-500 hover:bg-white/10'}`}
                      >
                        <div className="relative z-10">
                          <p className="text-xs font-bold">{type.label}</p>
                          <p className="text-[9px] opacity-60 mt-1">{type.desc}</p>
                          
                          {settings.activeStrategy === type.id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowStrategySettings(!showStrategySettings);
                              }}
                              className="mt-3 w-full py-1.5 bg-emerald-500 text-white text-[9px] font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors"
                            >
                              <Settings className="w-3 h-3" />
                              {showStrategySettings ? 'بستن تنظیمات' : 'تنظیمات اختصاصی'}
                            </button>
                          )}
                        </div>
                        {settings.activeStrategy === type.id && (
                          <motion.div 
                            layoutId="active-bg"
                            className="absolute inset-0 bg-emerald-500/5"
                          />
                        )}
                      </div>
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
                {showStrategySettings && (
                  <motion.section 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white/5 p-6 rounded-3xl border border-white/5"
                  >
                    <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                      <Activity className="w-4 h-4" /> تنظیمات حرفه‌ای: {
                        settings.activeStrategy === 'HMAMACD' ? 'HMA + MACD' : 
                        settings.activeStrategy === 'SCALP' ? 'اسکالپر پرو' : 
                        settings.activeStrategy === 'FAST' ? 'فوق سریع' : 
                        settings.activeStrategy === 'QUANT' ? 'کوانت' : 
                        settings.activeStrategy === 'NUMERICAL' ? 'نوسان‌گیری عددی' : 
                        settings.activeStrategy === 'HST' ? 'استراتژی HST' : 
                        settings.activeStrategy === 'PINBAR' ? 'پین بار' : 
                        settings.activeStrategy === 'MTF_PATTERN' ? 'الگوهای MTF' : 
                        settings.activeStrategy === 'ICHIMOKU_MTF' ? 'ایچیموکو MTF' : 
                        settings.activeStrategy === 'ICHIMOKU_HARAMI' ? 'ایچیموکو هارامی' : 
                        'ترند فالووینگ'
                      }
                    </h3>
                    
                    {settings.activeStrategy === 'HMAMACD' && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6"
                      >
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/10">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">💡 راهنمای HMA + MACD</p>
                          <p className="text-[9px] text-slate-400 leading-relaxed">
                            این استراتژی از کراس دو میانگین متحرک Hull برای تشخیص روند و از MACD برای تایید نهایی استفاده می‌کند.
                            ورود فقط زمانی انجام می‌شود که هر دو تاییدیه صادر شده باشند.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">HMA Fast Length</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.hmaFast || 9}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, hmaFast: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">HMA Slow Length</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.hmaSlow || 21}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, hmaSlow: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MACD Fast</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.macdFast || 12}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, macdFast: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MACD Slow</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.macdSlow || 26}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, macdSlow: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MACD Signal</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.macdSignal || 9}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, macdSignal: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Distance Filter (%)</label>
                            <input 
                              type="number" 
                              step="0.001"
                              value={settings.strategy?.hmamacd?.distanceFilter || 0.005}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, distanceFilter: parseFloat(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">Min Candle Strength</label>
                            <input 
                              type="number" 
                              step="0.0001"
                              value={settings.strategy?.hmamacd?.minCandleStrength || 0.001}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, minCandleStrength: parseFloat(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {settings.activeStrategy === 'SCALP' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20 mb-6">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">💡 راهنمای اسکالپر پرو (Faraz Gold)</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            این استراتژی برای نوسان‌گیری‌های سریع در چارت ۱ دقیقه‌ای طلا بهینه شده است. 
                            <br/>**مثال:** اگر بازار رنج است، دوره RSI را روی ۵ بگذارید تا حساسیت بیشتر شود. اگر بازار رونددار است، روی ۷ یا ۹ قرار دهید.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">دوره RSI (حساسیت نوسان)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.indicators?.rsi?.period || 5}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, indicators: { ...settings.strategy?.indicators, rsi: { ...settings.strategy?.indicators?.rsi, period: parseInt(e.target.value) } } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">کمتر = حساسیت بیشتر (مثال: ۵ برای نوسانات ریز)</p>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">EMA سریع (تشخیص جهت)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.indicators?.ema?.fast || 3}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, indicators: { ...settings.strategy?.indicators, ema: { ...settings.strategy?.indicators?.ema, fast: parseInt(e.target.value) } } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">میانگین متحرک برای تایید جهت حرکت (پیش‌فرض: ۳)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'FAST' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">⚡ راهنمای استراتژی فوق سریع</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            طراحی شده برای شکار حرکت‌های انفجاری طلا. در زمان اخبار یا نوسانات شدید عالی عمل می‌کند.
                            <br/>**مثال:** در زمان نوسان کم، کول‌داون را روی ۱۵ ثانیه بگذارید تا از ورودهای مکرر در یک نقطه جلوگیری شود.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداقل امتیاز تاییدیه (۱-۱۰)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.minSignalScore || 1}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, minSignalScore: parseInt(e.target.value) } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">بالاتر = امنیت بیشتر، تعداد معامله کمتر (پیش‌فرض: ۱)</p>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">کول‌داون (ثانیه)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.tradeCooldown || 8}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, tradeCooldown: parseInt(e.target.value) } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">فاصله زمانی اجباری بین دو معامله (مثال: ۸ ثانیه)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'HST' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">🛡️ راهنمای استراتژی HST (Hull + SuperTrend)</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            یکی از دقیق‌ترین استراتژی‌ها برای بازار طلا. از میانگین متحرک هال برای فیلتر نویز استفاده می‌کند.
                            <br/>**مثال:** برای امنیت حداکثری، حالت را روی PRECISION قرار دهید. در این حالت فقط زمانی وارد می‌شود که تمام اندیکاتورها هم‌جهت باشند.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حالت معامله (Aggressive vs Precision)</label>
                            <select 
                              value={settings.strategy?.hst?.mode || 'NORMAL'}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hst: { ...settings.strategy?.hst, mode: e.target.value } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            >
                              <option value="PRECISION">دقت بسیار بالا (معاملات بسیار کم) 💎</option>
                              <option value="NORMAL">دقت بالا (استاندارد) ⚖️</option>
                              <option value="AGGRESSIVE">تهاجمی (معاملات بیشتر) 🔥</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">ضریب SuperTrend (حساسیت روند)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.hst?.stMultiplier || 3}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hst: { ...settings.strategy?.hst, stMultiplier: parseFloat(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">کمتر = واکنش سریع‌تر به چرخش قیمت (پیش‌فرض: ۳)</p>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">دوره HMA (Hull Moving Average)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hst?.hmaLength || 55}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hst: { ...settings.strategy?.hst, hmaLength: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">طول میانگین متحرک برای تشخیص روند کلی (مثال: ۵۵)</p>
                          </div>
                          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold">تاییدیه قیمت بالای HMA</span>
                              <span className="text-[9px] text-slate-500">فیلتر سخت‌گیرانه برای ورود</span>
                            </div>
                            <button 
                              onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, hst: { ...settings.strategy?.hst, requireCloseAboveHMA: !settings.strategy?.hst?.requireCloseAboveHMA } } })}
                              className={`w-10 h-5 rounded-full transition-colors relative ${settings.strategy?.hst?.requireCloseAboveHMA ? 'bg-emerald-500' : 'bg-slate-700'}`}
                            >
                              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.hst?.requireCloseAboveHMA ? 'left-6' : 'left-1'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'NUMERICAL' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">🔢 راهنمای نوسان‌گیری عددی (Numerical)</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            مبتنی بر روانشناسی اعداد رند و مومنتوم آنی. عالی برای نوسانات پله‌ای طلا.
                            <br/>**مثال:** اگر اسپرد بازار زیاد است، حد اسپرد را روی ۲۰ تیک بگذارید تا فرصت‌های بیشتری شناسایی شود.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حد اسپرد مجاز (تیک)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.numerical?.spreadThreshold || 14}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, numerical: { ...settings.strategy?.numerical, spreadThreshold: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">حداکثر فاصله خرید و فروش برای ورود (مثال: ۱۴)</p>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حد سود (تیک)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.numerical?.takeProfitPips || 10}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, numerical: { ...settings.strategy?.numerical, takeProfitPips: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حد ضرر (تیک)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.numerical?.stopLossPips || 8}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, numerical: { ...settings.strategy?.numerical, stopLossPips: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-rose-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">فاصله مگنت عدد رند</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.numerical?.roundNumberMagnet || 5}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, numerical: { ...settings.strategy?.numerical, roundNumberMagnet: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">فاصله تا عدد رند برای فعال‌سازی سیگنال (مثال: ۵ تیک)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'QUANT' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">📊 راهنمای استراتژی کوانت (Quant)</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            ترکیب ریاضیات و پرایس اکشن. از میانگین‌های متحرک بلندمدت برای تشخیص روند اصلی استفاده می‌کند.
                            <br/>**مثال:** برای معاملات میان‌مدت، MA کند را روی ۲۰۰ و MA سریع را روی ۵۰ بگذارید.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MA سریع (روند کوتاه‌مدت)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.quant?.maFast || 50}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, maFast: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MA کند (روند بلندمدت)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.quant?.maSlow || 200}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, maSlow: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">نسبت ریسک به ریوارد (R:R)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.quant?.riskRewardRatio || 2}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, riskRewardRatio: parseFloat(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">مثال: ۲ یعنی به ازای هر ۱ واحد ضرر، ۲ واحد سود هدف‌گذاری شود.</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'PINBAR' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">🕯️ راهنمای استراتژی پین بار (Pinbar)</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            تمرکز بر روی بازگشت‌های قیمتی با استفاده از کندل‌های پین‌بار.
                            <br/>**مثال:** برای سخت‌گیرانه‌تر کردن الگو، نسبت سایه را روی ۳.۰ بگذارید تا فقط پین‌بارهای با سایه بسیار بلند تایید شوند.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">نسبت بدنه (حداکثر)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.pinbar?.bodyRatio || 0.4}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, pinbar: { ...settings.strategy?.pinbar, bodyRatio: parseFloat(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">نسبت اندازه بدنه به کل کندل (پیش‌فرض: ۰.۴)</p>
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">نسبت سایه (حداقل)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.pinbar?.wickRatio || 2.5}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, pinbar: { ...settings.strategy?.pinbar, wickRatio: parseFloat(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">نسبت سایه به بدنه (بزرگتر = الگوی قوی‌تر)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'MTF_PATTERN' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">🌐 راهنمای الگوهای MTF (Multi-Timeframe)</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            تحلیل همزمان تایم‌فریم ۱ دقیقه و ۵ دقیقه برای یافتن نقاط ورود دقیق.
                            <br/>**مثال:** اگر می‌خواهید فقط در جهت روند ۵ دقیقه‌ای وارد شوید، امتیاز تاییدیه را روی ۴ بگذارید.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداقل امتیاز سیگنال (۱-۵)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.mtfPatterns?.minScore || 3}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, mtfPatterns: { ...settings.strategy?.mtfPatterns, minScore: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold">فیلتر حجم معاملات</span>
                              <span className="text-[9px] text-slate-500">تاییدیه با حجم بازار</span>
                            </div>
                            <button 
                              onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, mtfPatterns: { ...settings.strategy?.mtfPatterns, useVolume: !settings.strategy?.mtfPatterns?.useVolume } } })}
                              className={`w-10 h-5 rounded-full transition-colors relative ${settings.strategy?.mtfPatterns?.useVolume ? 'bg-emerald-500' : 'bg-slate-700'}`}
                            >
                              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.mtfPatterns?.useVolume ? 'left-6' : 'left-1'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'ICHIMOKU_MTF' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">☁️ راهنمای ایچیموکو MTF</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            استفاده از قدرت ابر کومو و خطوط کیجون/تنکان برای شکار روندهای پایدار.
                            <br/>**مثال:** برای امنیت بالا، حتماً تاییدیه ابر کومو را روشن بگذارید تا فقط در جهت ابر معامله کند.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداقل امتیاز سیگنال</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.ichimoku?.minScore || 4}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, ichimoku: { ...settings.strategy?.ichimoku, minScore: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold">تاییدیه ابر کومو</span>
                              <span className="text-[9px] text-slate-500">معامله فقط در جهت ابر</span>
                            </div>
                            <button 
                              onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, ichimoku: { ...settings.strategy?.ichimoku, trendFilter: { ...settings.strategy?.ichimoku?.trendFilter, requireCloudConfirmation: !settings.strategy?.ichimoku?.trendFilter?.requireCloudConfirmation } } } })}
                              className={`w-10 h-5 rounded-full transition-colors relative ${settings.strategy?.ichimoku?.trendFilter?.requireCloudConfirmation ? 'bg-emerald-500' : 'bg-slate-700'}`}
                            >
                              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.ichimoku?.trendFilter?.requireCloudConfirmation ? 'left-6' : 'left-1'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'ICHIMOKU_HARAMI' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">🕯️ راهنمای ایچیموکو هارامی</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            ترکیب سطوح ایچیموکو با الگوهای بازگشتی خاص مانند هارامی، نفوذی و ابر سیاه.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداقل امتیاز سیگنال</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.ichimokuHarami?.riskManagement?.minScore || 4}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, ichimokuHarami: { ...settings.strategy?.ichimokuHarami, riskManagement: { ...settings.strategy?.ichimokuHarami?.riskManagement, minScore: parseInt(e.target.value) } } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">حداقل قدرت هارامی</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.ichimokuHarami?.patterns?.harami?.minStrength || 3}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, ichimokuHarami: { ...settings.strategy?.ichimokuHarami, patterns: { ...settings.strategy?.ichimokuHarami?.patterns, harami: { ...settings.strategy?.ichimokuHarami?.patterns?.harami, minStrength: parseInt(e.target.value) } } } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                    {settings.activeStrategy === 'TREND' && (
                      <div className="space-y-6">
                        <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1">📈 راهنمای ترند فالووینگ (Trend Following)</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            استراتژی کلاسیک تعقیب روند با استفاده از تقاطع میانگین‌های متحرک.
                            <br/>**مثال:** برای روندهای بلندمدت، MA سریع را روی ۲۰ و MA کند را روی ۵۰ بگذارید.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MA سریع (دوره کوتاه)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.trend?.maFast || 20}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, trend: { ...settings.strategy?.trend, maFast: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">MA کند (دوره بلند)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.trend?.maSlow || 50}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, trend: { ...settings.strategy?.trend, maSlow: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Entry Optimization Section */}
                    <div className="space-y-6 pt-6 mt-6 border-t border-white/10">
                      <div className="flex items-center gap-2 mb-4">
                        <Zap className="w-4 h-4 text-amber-500" />
                        <h3 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">بهینه‌سازی ورود (Entry Optimization)</h3>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold">ورود در پولبک (Pullback)</span>
                            <span className="text-[9px] text-slate-500">انتظار برای قیمت بهتر بعد از سیگنال</span>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, pullback: { ...settings.strategy?.pullback, enabled: !settings.strategy?.pullback?.enabled } } })}
                            className={`w-10 h-5 rounded-full transition-colors relative ${settings.strategy?.pullback?.enabled ? 'bg-amber-500' : 'bg-slate-700'}`}
                          >
                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.pullback?.enabled ? 'left-6' : 'left-1'}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold">تاییدیه چند زمانی (MTF)</span>
                            <span className="text-[9px] text-slate-500">هماهنگی با روند تایم‌فریم ۵ دقیقه</span>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, mtf: { ...settings.strategy?.mtf, enabled: !settings.strategy?.mtf?.enabled } } })}
                            className={`w-10 h-5 rounded-full transition-colors relative ${settings.strategy?.mtf?.enabled ? 'bg-blue-500' : 'bg-slate-700'}`}
                          >
                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.mtf?.enabled ? 'left-6' : 'left-1'}`} />
                          </button>
                        </div>

                        {settings.strategy?.pullback?.enabled && (
                          <div className="sm:col-span-2">
                            <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">میزان عقب‌نشینی (تیک)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.pullback?.retracementTicks || 5}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, pullback: { ...settings.strategy?.pullback, retracementTicks: parseInt(e.target.value) } } })}
                              className="w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm outline-none focus:border-amber-500/50"
                            />
                            <p className="text-[8px] text-slate-500 mt-2">چند تیک قیمت برگردد تا وارد شویم؟ (پیش‌فرض: ۵)</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.section>
                )}
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

      <AnimatePresence>
        {showCreatePortfolio && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" dir="rtl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#0a0a0a] border border-white/10 rounded-3xl p-6 sm:p-8 w-full max-w-md shadow-2xl relative max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-500/10 rounded-2xl text-emerald-500">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-black text-white">ایجاد پرتفو</h2>
                    <p className="text-xs text-slate-400 mt-1">پرتفو ایزوله جدید بسازید</p>
                  </div>
                </div>
                <button onClick={() => setShowCreatePortfolio(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-sm text-slate-400 mb-3 block">تعداد واحد (هر واحد ۲,۳۰۰,۰۰۰ تومان)</label>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setPortfolioUnits(Math.max(1, portfolioUnits - 1))}
                      className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center text-xl font-bold transition-colors"
                    >-</button>
                    <input 
                      type="number" 
                      value={portfolioUnits}
                      onChange={(e) => setPortfolioUnits(Math.max(1, parseInt(e.target.value) || 1))}
                      className="flex-1 bg-white/5 border border-white/5 rounded-2xl px-4 py-3 text-center text-xl font-bold outline-none focus:border-emerald-500/50"
                    />
                    <button 
                      onClick={() => setPortfolioUnits(portfolioUnits + 1)}
                      className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center text-xl font-bold transition-colors"
                    >+</button>
                  </div>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-emerald-500/80">مبلغ کل پرتفو:</span>
                    <span className="font-bold text-emerald-500">{formatPrice(portfolioUnits * 2300000)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-emerald-500/80">ارزش هر خط:</span>
                    <span className="font-bold text-emerald-500">۲۳,۰۰۰ تومان</span>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={handleCreatePortfolio}
                    disabled={isCreatingPortfolio}
                    className="flex-[2] bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/20"
                  >
                    {isCreatingPortfolio ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
                    ) : (
                      <>
                        <ShieldCheck className="w-5 h-5" />
                        تایید و ایجاد پرتفو
                      </>
                    )}
                  </button>
                  <button 
                    onClick={() => setShowCreatePortfolio(false)}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-slate-400 py-4 rounded-2xl transition-all"
                  >
                    انصراف
                  </button>
                </div>
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
