import React, { useState, useEffect } from 'react';
import Chart from 'react-apexcharts';
import axios from 'axios';
import { Activity, TrendingUp, TrendingDown, AlertCircle, Clock, Power, Shield, ShieldCheck, Settings, Send, Save, X, ChevronRight, Terminal, RefreshCw, Lock, ShieldAlert, Zap, BarChart3, CircleDot, Layout, Layers, History, Target, Cpu, Waves, Plus, CheckCircle2, Trash2, Globe, Cloud, Info, Database, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LoginSection } from './LoginSection';

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
  const [showIncreasePortfolio, setShowIncreasePortfolio] = useState(false);
  const [portfolioUnits, setPortfolioUnits] = useState(1);
  const [increaseAmount, setIncreaseAmount] = useState(0);
  const [isCreatingPortfolio, setIsCreatingPortfolio] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAutoTuning, setIsAutoTuning] = useState(false);
  const [autoTuneResults, setAutoTuneResults] = useState<any>(null);
  const [autoTuneStrategy, setAutoTuneStrategy] = useState<string>('');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccountType, setNewAccountType] = useState<'real' | 'demo'>('demo');
  const [showCopyTrade, setShowCopyTrade] = useState(false);
  const [isTogglingCopy, setIsTogglingCopy] = useState(false);

  const isEditingSettingsRef = React.useRef(false);
  useEffect(() => {
    isEditingSettingsRef.current = showSettings || showCopyTrade || showAddAccount;
  }, [showSettings, showCopyTrade, showAddAccount]);

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
          // Only update settings from server if no settings-related modal is open
          if (!isEditingSettingsRef.current) {
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
      const res = await fetch('/api/bot/autotune', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: autoTuneStrategy || undefined })
      });
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
        body: JSON.stringify({
          portfolio_type: "isolated",
          mode: "hedge",
          initial_balance: portfolioUnits * 2300000,
          line_value_per_khat: 23000
        })
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

  const handleIncreasePortfolio = async () => {
    if (increaseAmount <= 0) return;
    setIsCreatingPortfolio(true);
    try {
      const res = await fetch('/api/bot/increase-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: increaseAmount })
      });
      const data = await res.json();
      if (data.success) {
        setShowIncreasePortfolio(false);
        setIncreaseAmount(0);
      } else {
        alert(data.message || 'خطا در افزایش سرمایه');
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
      <header className="border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-xl px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-center justify-between sticky top-0 z-40 gap-3 sm:gap-0">
        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
          <div className="flex items-center gap-4">
            <motion.div 
              whileHover={{ rotate: 180 }}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20"
            >
              <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </motion.div>
            <div>
              <h1 className="text-base sm:text-xl font-black tracking-tighter text-white uppercase">FARAZ <span className="text-emerald-500">GOLD</span></h1>
              <p className="text-[7px] sm:text-[9px] text-slate-500 font-mono uppercase tracking-[0.1em]">ربات اسکالپر الگوریتمیک - نسخه ۴.۳</p>
            </div>
            <a 
              href={settings?.api?.accounts?.[settings?.api?.activeAccountId]?.type === 'real' ? "https://farazgold.com/room" : "https://demo.farazgold.com/room"} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-lg text-[9px] sm:text-[10px] font-bold transition-colors border border-emerald-500/20 mr-2 sm:mr-4"
            >
              <Globe className="w-3 h-3" />
              <span className="hidden sm:inline">ورود به {settings?.api?.accounts?.[settings?.api?.activeAccountId]?.type === 'real' ? 'پنل ریل' : 'پنل دمو'}</span>
              <span className="sm:hidden">{settings?.api?.accounts?.[settings?.api?.activeAccountId]?.type === 'real' ? 'ریل' : 'دمو'}</span>
            </a>
          </div>
          
          <div className="flex sm:hidden items-center gap-2">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 bg-white/5 rounded-xl text-slate-400 hover:text-white transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button 
              onClick={toggleTrading}
              className={`p-2 rounded-xl transition-all ${botState.isTrading ? 'bg-rose-500/20 text-rose-500' : 'bg-emerald-500/20 text-emerald-500'}`}
            >
              <Power className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-center sm:justify-end">
          <div className="hidden sm:flex items-center gap-4 border-r border-white/10 pr-6 mr-2">
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
              <option value="HULL_SUPERTREND">هال + سوپرترند (جدید)</option>
              <option value="PINBAR">پین بار (پرایس اکشن)</option>
              <option value="MTF_PATTERN">الگوهای MTF</option>
              <option value="ICHIMOKU_MTF">ایچیموکو MTF</option>
              <option value="ICHIMOKU_HARAMI">ایچیموکو هارامی</option>
            </select>
          </div>
          <div className="flex items-center gap-3 sm:gap-6 ml-auto">
            <div className="text-right bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
              <p className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-0.5">موجودی کل</p>
              <p className="text-lg font-black font-mono text-white">
                {botState.userInfo ? formatPrice(botState.userInfo.balance) : <span className="animate-pulse opacity-50">---</span>}
              </p>
            </div>
            <div className="hidden sm:block text-right bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
              <p className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-0.5">عملکرد امروز</p>
              <p className={`text-lg font-black font-mono ${botState.dailyPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {botState.dailyPnL > 0 ? '+' : ''}{formatPrice(botState.dailyPnL)}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/5">
            <button 
              onClick={toggleHighQuality}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg font-bold transition-all text-xs ${settings?.strategy?.highQualityMode ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
              title="حالت سیگنال‌های با کیفیت (تعداد کمتر، دقت بیشتر)"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">کیفیت بالا</span>
            </button>
            <button 
              onClick={() => setShowCopyTrade(true)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg font-bold transition-all text-xs ${botState?.copyTrade?.isRunning ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
              title="کپی ترید (اتصال به اکانت دیگر)"
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">کپی ترید</span>
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors text-slate-400 hover:text-white"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button 
              onClick={toggleTrading}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-xs ${botState.isTrading ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'}`}
            >
              <Power className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{botState.isTrading ? 'فعال' : 'متوقف'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6" dir="rtl">
        {/* Main Column Section */}
        <div className="lg:col-span-8 space-y-4 sm:space-y-6">
          {/* Open Positions Section (Moved above chart) */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#0f0f0f] border border-white/5 rounded-xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-6 sm:mb-8">
              <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3">
                <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                پوزیشن‌های باز
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 bg-white/5 px-2 py-1 rounded-lg">
                  تعداد: {botState.openPositions.length}
                </span>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        <span className={`text-[8px] sm:text-[9px] font-black px-2 sm:px-2.5 py-0.5 rounded-full w-fit ${pos.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>
                          {pos.type}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[7px] sm:text-[8px] text-slate-400 font-mono uppercase">{pos.pattern || 'EMA CROSS'}</span>
                          {pos.strength && (
                            <span className={`text-[6px] sm:text-[7px] px-1 py-0.5 rounded-md font-bold flex items-center gap-1 ${
                              pos.strength === 'STRONG' ? 'bg-rose-500/20 text-rose-500' : 
                              pos.strength === 'WEAK' ? 'bg-slate-500/20 text-slate-400' : 
                              'bg-blue-500/20 text-blue-400'
                            }`}>
                              {pos.strength === 'STRONG' ? '🔥 STRONG' : pos.strength === 'WEAK' ? '⚠️ WEAK' : '✨ NORMAL'}
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
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-mono mb-1">ورود</p>
                        <p className="text-xs sm:text-sm font-bold font-mono text-white">{formatPrice(pos.entry || pos.price)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-mono mb-1">سود/ضرر لحظه‌ای</p>
                        <p className={`text-[10px] sm:text-xs font-bold font-mono ${
                          ((pos.type === 'BUY' ? botState.price - (pos.entry || pos.price) : (pos.entry || pos.price) - botState.price) / (botState.settings?.market?.tickSize || 1)) * (botState.settings?.market?.tickValueToman || 23000) * (pos.units || 1) >= 0 
                            ? 'text-emerald-500' 
                            : 'text-rose-500'
                        }`}>
                          {botState.price > 0 ? formatPrice(
                            ((pos.type === 'BUY' ? botState.price - (pos.entry || pos.price) : (pos.entry || pos.price) - botState.price) / (botState.settings?.market?.tickSize || 1)) * (botState.settings?.market?.tickValueToman || 23000) * (pos.units || 1)
                          ) : '---'}
                        </p>
                      </div>
                    </div>

                    {/* Graphical Progress Bar */}
                    <div className="mb-4 relative pt-4 pb-2">
                      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden flex">
                        <div 
                          className={`h-full transition-all duration-500 ${pos.type === 'BUY' ? (botState.price > (pos.entry || pos.price) ? 'bg-emerald-500' : 'bg-rose-500') : (botState.price < (pos.entry || pos.price) ? 'bg-emerald-500' : 'bg-rose-500')}`}
                          style={{ 
                            width: `${Math.max(0, Math.min(100, ((pos.type === 'BUY' ? botState.price - pos.sl : pos.sl - botState.price) / Math.abs(pos.tp3 - pos.sl)) * 100))}%` 
                          }}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[7px] text-rose-500 font-mono">SL: {formatPrice(pos.sl)}</span>
                        <span className="text-[7px] text-emerald-500 font-mono">TP3: {formatPrice(pos.tp3)}</span>
                      </div>
                      {/* Current Price Marker */}
                      <div 
                        className="absolute top-2 w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] -ml-1 transition-all duration-500"
                        style={{ 
                          left: `${Math.max(0, Math.min(100, ((pos.type === 'BUY' ? botState.price - pos.sl : pos.sl - botState.price) / Math.abs(pos.tp3 - pos.sl)) * 100))}%` 
                        }}
                      />
                    </div>

                    <div className="pt-3 border-t border-white/5 grid grid-cols-3 gap-2">
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
            </div>

            {botState.openPositions.length === 0 && (
              <div className="text-center py-8 sm:py-12">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-slate-600" />
                </div>
                <p className="text-[10px] sm:text-xs text-slate-500 font-bold">در حال حاضر پوزیشن باز ندارید</p>
              </div>
            )}
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#0f0f0f] border border-white/5 rounded-xl sm:rounded-3xl p-4 sm:p-6 h-[400px] sm:h-[500px] shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 sm:mb-8 gap-4 sm:gap-0">
              <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${botState.marketStatus === 'OPEN' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                {botState.marketStatus === 'OPEN' ? 'تغییرات قیمت در لحظه (زنده)' : 'بازار در حال حاضر بسته است'}
              </h2>
              <div className="flex items-center gap-4">
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
                <p className="text-[10px] sm:text-xs text-slate-300 leading-relaxed text-justify">{botState.marketAnalysis.analysis}</p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Sidebar Section */}
        <div className="lg:col-span-4 space-y-6 sm:space-y-8">
          {/* Portfolio Summary Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#0f0f0f] border border-white/5 rounded-2xl p-6 shadow-2xl relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-3xl rounded-full -mr-16 -mt-16" />
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Layout className="w-4 h-4 text-emerald-500" />
                خلاصه وضعیت سرمایه
              </h2>
              {botState.portfolio?.has_portfolio && (
                <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-lg">پرتفو فعال</span>
              )}
            </div>

            <div className="space-y-5">
              <div className="flex justify-between items-center border-b border-white/5 pb-5">
                <div>
                  <p className="text-[10px] text-slate-500 font-mono uppercase mb-1">کل سرمایه (تومان)</p>
                  <p className="text-2xl font-black text-white font-mono tracking-tight">
                    {botState.userInfo || botState.portfolio ? formatPrice((botState.userInfo?.balance || 0) + (botState.portfolio?.balance || 0)) : <span className="animate-pulse opacity-50">---</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-500 font-mono uppercase mb-1">قیمت لحظه‌ای</p>
                  <p className="text-base font-bold text-amber-500 font-mono">
                    {botState.price > 0 ? formatPrice(botState.price) : <span className="text-[10px] text-slate-600 animate-pulse">در حال دریافت...</span>}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5 group-hover:bg-white/[0.07] transition-colors">
                  <div className="text-[9px] text-slate-500 uppercase font-mono mb-1.5 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    مارجین درگیر
                  </div>
                  <p className="text-base font-black text-emerald-500 font-mono">
                    {botState.portfolio?.has_portfolio ? `${(botState.portfolio.balance / 2300000).toFixed(1)} واحد` : '۰ واحد'}
                  </p>
                </div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5 group-hover:bg-white/[0.07] transition-colors">
                  <div className="text-[9px] text-slate-500 uppercase font-mono mb-1.5 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    موجودی آزاد
                  </div>
                  <p className="text-base font-black text-white font-mono">
                    {botState.userInfo ? formatPrice(botState.userInfo.balance) : <span className="opacity-50">---</span>}
                  </p>
                </div>
              </div>

              <div className="pt-2">
                {(!botState.portfolio || !botState.portfolio.has_portfolio) ? (
                  <button 
                    onClick={() => setShowCreatePortfolio(true)}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                  >
                    <Plus className="w-4 h-4" />
                    ایجاد پرتفوی جدید
                  </button>
                ) : (
                  <button 
                    onClick={() => setShowIncreasePortfolio(true)}
                    className="w-full bg-white/5 hover:bg-white/10 text-emerald-500 border border-emerald-500/20 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <TrendingUp className="w-4 h-4" />
                    افزایش سرمایه / ویرایش
                  </button>
                )}
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#0f0f0f] border border-white/5 rounded-xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl"
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
            <div className="mb-6 p-4 sm:p-5 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
              <div className="flex flex-col gap-4 mb-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                    <Zap className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-[11px] font-bold text-white uppercase tracking-wider">بهینه‌سازی هوشمند (Auto-Tune)</h3>
                    <p className="text-[8px] text-slate-500 font-medium">پیدا کردن بهترین استراتژی بر اساس نوسانات لحظه‌ای</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/5">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tight">سود حداکثری:</span>
                    <button 
                      type="button"
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
                      className={`w-7 h-3.5 rounded-full transition-colors relative ${settings?.autoTune?.maximizeBigWins ? 'bg-emerald-500' : 'bg-slate-700'}`}
                    >
                      <motion.div animate={{ x: settings?.autoTune?.maximizeBigWins ? 14 : 2 }} className="w-2.5 h-2.5 bg-white rounded-full absolute top-0.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/5">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tight">کیفیت دراودان:</span>
                    <button 
                      type="button"
                      onClick={async () => {
                        const newSettings = { 
                          ...settings, 
                          autoTune: { 
                            ...settings.autoTune, 
                            optimizeDrawdownQuality: !settings.autoTune?.optimizeDrawdownQuality 
                          } 
                        };
                        setSettings(newSettings);
                        await fetch('/api/bot/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(newSettings)
                        });
                      }}
                      className={`w-7 h-3.5 rounded-full transition-colors relative ${settings?.autoTune?.optimizeDrawdownQuality ? 'bg-orange-500' : 'bg-slate-700'}`}
                    >
                      <motion.div animate={{ x: settings?.autoTune?.optimizeDrawdownQuality ? 14 : 2 }} className="w-2.5 h-2.5 bg-white rounded-full absolute top-0.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/5">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tight">بهینه‌سازی جراحی (Surgical):</span>
                    <button 
                      type="button"
                      onClick={async () => {
                        const newSettings = { 
                          ...settings, 
                          autoTune: { 
                            ...settings.autoTune, 
                            surgicalOptimization: !settings.autoTune?.surgicalOptimization 
                          } 
                        };
                        setSettings(newSettings);
                        await fetch('/api/bot/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(newSettings)
                        });
                      }}
                      className={`w-7 h-3.5 rounded-full transition-colors relative ${settings?.autoTune?.surgicalOptimization ? 'bg-emerald-500' : 'bg-slate-700'}`}
                    >
                      <motion.div animate={{ x: settings?.autoTune?.surgicalOptimization ? 14 : 2 }} className="w-2.5 h-2.5 bg-white rounded-full absolute top-0.5" />
                    </button>
                  </div>
                  <button 
                    type="button"
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
                    className="flex-1 sm:flex-none justify-center px-3 py-2 rounded-xl text-[9px] font-bold transition-all bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 flex items-center gap-2"
                  >
                    <RefreshCw className="w-3 h-3" />
                    بازگشت به قبل
                  </button>
                  <select
                    value={autoTuneStrategy}
                    onChange={(e) => setAutoTuneStrategy(e.target.value)}
                    className="flex-1 sm:flex-none px-3 py-2 rounded-xl text-[9px] font-bold bg-white/5 text-white border border-white/10 outline-none focus:border-emerald-500/50"
                  >
                    <option value="">همه استراتژی‌ها (جستجوی کامل)</option>
                    <option value="SCALP">SCALP (اسکالپ سریع)</option>
                    <option value="HST">HST (هال سوپرترند)</option>
                    <option value="QUANT">QUANT (کوانت)</option>
                    <option value="TREND">TREND (ترند)</option>
                    <option value="HMAMACD">HMAMACD (هال مکدی)</option>
                  </select>
                  <button 
                    type="button"
                    onClick={runAutoTune}
                    disabled={isAutoTuning}
                    className={`flex-1 sm:flex-none justify-center px-4 py-2 rounded-xl text-[9px] font-bold transition-all flex items-center gap-2 ${isAutoTuning ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20'}`}
                  >
                    {isAutoTuning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    {isAutoTuning ? 'در حال بهینه‌سازی...' : 'شروع بهینه‌سازی'}
                  </button>
                </div>
              </div>
              
              {autoTuneResults ? (
                <div className="space-y-4">
                  <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] text-slate-400 uppercase font-mono font-bold tracking-wider">استراتژی پیشنهادی</span>
                      <span className="text-[10px] font-black text-emerald-500 bg-emerald-500/20 px-2 py-0.5 rounded-lg border border-emerald-500/20">{autoTuneResults.bestStrategy || '---'}</span>
                    </div>
                    <p className="text-[9px] text-slate-400 leading-relaxed font-medium">
                      بر اساس تحلیل داده‌های اخیر، استراتژی <span className="text-emerald-500 font-bold">{autoTuneResults.bestStrategy}</span> بیشترین بازدهی را با پارامترهای فعلی بازار داشته است.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-black/20 p-2.5 rounded-xl border border-white/5">
                      <p className="text-[7px] text-slate-500 uppercase mb-1 font-bold tracking-widest">سود خالص (تیک)</p>
                      <p className={`text-xs font-black ${autoTuneResults.metrics?.netTicks >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {autoTuneResults.metrics?.netTicks || 0}
                      </p>
                    </div>
                    <div className="bg-black/20 p-2.5 rounded-xl border border-white/5">
                      <p className="text-[7px] text-slate-500 uppercase mb-1 font-bold tracking-widest">ضریب سود (PF)</p>
                      <p className={`text-xs font-black ${autoTuneResults.metrics?.profitFactor >= 1.5 ? 'text-emerald-500' : autoTuneResults.metrics?.profitFactor >= 1.0 ? 'text-white' : 'text-rose-500'}`}>
                        {autoTuneResults.metrics?.profitFactor?.toFixed(2) || 0}
                      </p>
                    </div>
                    <div className="bg-black/20 p-2.5 rounded-xl border border-white/5">
                      <p className="text-[7px] text-slate-500 uppercase mb-1 font-bold tracking-widest">وین ریت (WR)</p>
                      <p className={`text-xs font-black ${autoTuneResults.metrics?.winRate >= 0.5 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {Math.round((autoTuneResults.metrics?.winRate || 0) * 100)}%
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-black/20 p-2.5 rounded-xl border border-white/5 flex items-center justify-between">
                      <div>
                        <p className="text-[7px] text-slate-500 uppercase mb-0.5 font-bold tracking-widest">میانگین دراودان (MAE)</p>
                        <p className="text-[10px] font-black text-rose-400">
                          {autoTuneResults.metrics?.avgMAE?.toFixed(1) || 0} <span className="text-[7px] opacity-50">تیک</span>
                        </p>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center">
                        <TrendingDown className="w-4 h-4 text-rose-500" />
                      </div>
                    </div>
                    <div className="bg-black/20 p-2.5 rounded-xl border border-white/5 flex items-center justify-between">
                      <div>
                        <p className="text-[7px] text-slate-500 uppercase mb-0.5 font-bold tracking-widest">میانگین پیشروی (MFE)</p>
                        <p className="text-[10px] font-black text-emerald-400">
                          {autoTuneResults.metrics?.avgMFE?.toFixed(1) || 0} <span className="text-[7px] opacity-50">تیک</span>
                        </p>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                      </div>
                    </div>
                  </div>

                  {autoTuneResults.bestHours && (
                    <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] text-slate-400 uppercase font-mono flex items-center gap-2">
                          <Clock className="w-3 h-3" /> بهترین ساعات ترید (UTC)
                        </p>
                        <span className="text-[7px] text-slate-600 font-bold uppercase tracking-tight">بر اساس سود خالص</span>
                      </div>
                      {autoTuneResults.bestHours.filter((h: any) => h.trades > 0).length <= 1 && (
                        <p className="text-[8px] text-amber-500/80 mb-3 bg-amber-500/5 p-2 rounded-lg border border-amber-500/10">
                          ⚠️ دیتای معاملاتی در ساعات مختلف محدود است. نتایج ممکن است دقیق نباشد.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {autoTuneResults.bestHours.map((h: any, idx: number) => {
                          // Convert UTC hour to Iran time (UTC+3:30)
                          const iranHour = (h.hour + 3) % 24;
                          const iranMin = 30;
                          return (
                            <div key={idx} className="bg-white/5 px-3 py-1.5 rounded-xl border border-white/5 flex flex-col items-center">
                              <span className="text-[10px] font-bold text-white">{h.hour}:00 <span className="text-[8px] text-slate-500">(UTC)</span></span>
                              <span className="text-[8px] text-slate-400 font-mono">{iranHour}:{iranMin} <span className="text-[7px]">IR</span></span>
                              <span className={`text-[8px] mt-1 ${h.netTicks >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {h.netTicks > 0 ? '+' : ''}{h.netTicks} تیک
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                    <span>آخرین اجرا: {new Date(autoTuneResults.generatedAt).toLocaleString('fa-IR')}</span>
                    <span className={autoTuneResults.objectiveScore < -1e6 ? 'text-rose-500' : 'text-emerald-500'}>
                      {autoTuneResults.objectiveScore < -1e6 ? 'دیتای ناکافی برای امتیازدهی' : `امتیاز استراتژی: ${autoTuneResults.objectiveScore?.toFixed(1)}`}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 bg-black/20 rounded-xl border border-dashed border-white/5">
                  <div className="p-3 bg-white/5 rounded-full mb-3">
                    <Zap className="w-5 h-5 text-slate-600" />
                  </div>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">هنوز بهینه‌سازی انجام نشده است</p>
                  <p className="text-[8px] text-slate-600 mt-1">برای پیدا کردن بهترین تنظیمات، دکمه بالا را بزنید.</p>
                </div>
              )}
            </div>

            {/* System Status (Moved from top) */}
            <div className="mb-6 p-4 sm:p-5 bg-[#0f0f0f] border border-white/5 rounded-2xl">
              <h3 className="text-[11px] font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-slate-400" />
                وضعیت سیستم و بازار
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-black/20 p-2.5 rounded-xl border border-white/5">
                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tight">تأخیر شبکه (پینگ):</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold font-mono ${botState.latency < 500 ? 'text-emerald-500' : botState.latency < 1500 ? 'text-amber-500' : 'text-rose-500'}`}>
                      {botState.latency}ms
                    </span>
                    <div className="flex gap-0.5">
                      {[1, 2, 3].map(i => (
                        <div 
                          key={i} 
                          className={`w-1 h-2.5 rounded-full ${
                            !botState.isConnected ? 'bg-slate-700' :
                            botState.latency < 500 ? 'bg-emerald-500' :
                            botState.latency < 1500 ? (i <= 2 ? 'bg-amber-500' : 'bg-slate-700') :
                            (i <= 1 ? 'bg-rose-500' : 'bg-slate-700')
                          }`} 
                        />
                      ))}
                    </div>
                  </div>
                </div>
                
                {botState.marketAnalysis && (
                  <div className="flex items-center justify-between bg-black/20 p-2.5 rounded-xl border border-white/5">
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tight">وضعیت بازار:</span>
                    <span className={`text-[10px] font-bold ${botState.marketAnalysis.color}`}>{botState.marketAnalysis.trend}</span>
                  </div>
                )}
                
                {botState.mtfStatus && (
                  <div className="flex items-center justify-between bg-black/20 p-2.5 rounded-xl border border-white/5">
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tight">تاییدیه MTF:</span>
                    <span className={`text-[10px] font-bold ${botState.mtfStatus.status === 'CONFIRMED' ? (botState.mtfStatus.trend === 'BUY' ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-500'}`}>
                      {botState.mtfStatus.status === 'CONFIRMED' ? (botState.mtfStatus.trend === 'BUY' ? 'صعودی (5m)' : 'نزولی (5m)') : 'در حال تحلیل...'}
                    </span>
                  </div>
                )}
              </div>
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
            className="bg-[#0f0f0f] border border-white/5 rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl"
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
                    <span>ورود: {formatPrice(pos.entry || pos.price)}</span>
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
            className="bg-[#0a0a0a] border border-white/5 rounded-xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-xl bg-[#0f0f0f] border border-white/10 rounded-2xl p-5 sm:p-6 shadow-3xl overflow-hidden"
            >
              <div className="flex items-center justify-between mb-5 sm:mb-6" dir="rtl">
                <h2 className="text-base sm:text-lg font-black text-white flex items-center gap-3">
                  <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                  تنظیمات پیشرفته ربات
                </h2>
                <button onClick={() => setShowSettings(false)} className="p-1.5 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
                </button>
              </div>

              <div className="space-y-5 sm:space-y-6 max-h-[75vh] overflow-y-auto pr-1 sm:pr-2 custom-scrollbar" dir="rtl">
                {/* Account & Data Source Selection */}
                <section>
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                    مدیریت حساب‌ها (Multi-Account)
                  </h2>
                  
                  <div className="space-y-3">
                    {/* Account List */}
                    {Object.values(settings.api?.accounts || {}).map((acc: any) => (
                      <div 
                        key={acc.username}
                        className={`p-3 rounded-xl border transition-all cursor-pointer relative group ${settings.api.activeAccountId === acc.username ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/5 hover:border-white/10'}`}
                        onClick={() => setSettings({ ...settings, api: { ...settings.api, activeAccountId: acc.username } })}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${acc.type === 'real' ? 'bg-rose-500/20 text-rose-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                              <ShieldAlert className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-white">{acc.username}</p>
                              <p className="text-[9px] text-slate-500 font-mono uppercase tracking-wider">{acc.type === 'real' ? 'حساب واقعی' : 'حساب دمو'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {settings.api.activeAccountId === acc.username && (
                              <div className="flex items-center gap-1.5 text-emerald-500 text-[9px] font-bold uppercase tracking-wider">
                                <CheckCircle2 className="w-3.5 h-3.5" /> فعال
                              </div>
                            )}
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                const newAccounts = { ...settings.api.accounts };
                                delete newAccounts[acc.username];
                                let newActive = settings.api.activeAccountId;
                                if (newActive === acc.username) {
                                  newActive = Object.keys(newAccounts)[0] || '';
                                }
                                setSettings({ ...settings, api: { ...settings.api, accounts: newAccounts, activeAccountId: newActive } });
                              }}
                              className="p-1.5 text-slate-500 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Add New Account Button */}
                    <button 
                      onClick={() => setShowAddAccount(!showAddAccount)}
                      className="w-full py-3 rounded-xl border border-dashed border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-slate-400 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                    >
                      <Plus className="w-3.5 h-3.5" /> افزودن حساب جدید
                    </button>

                    <AnimatePresence>
                      {showAddAccount && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4 mt-2">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold text-white uppercase tracking-widest">ورود به حساب جدید</span>
                              <div className="flex bg-black/20 p-1 rounded-lg">
                                <button 
                                  onClick={() => setNewAccountType('real')}
                                  className={`px-3 py-1 rounded-md text-[9px] font-bold transition-all ${newAccountType === 'real' ? 'bg-rose-500 text-white' : 'text-slate-500'}`}
                                >ریل</button>
                                <button 
                                  onClick={() => setNewAccountType('demo')}
                                  className={`px-3 py-1 rounded-md text-[9px] font-bold transition-all ${newAccountType === 'demo' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}
                                >دمو</button>
                              </div>
                            </div>
                            <LoginSection 
                              type={newAccountType} 
                              settings={settings} 
                              setSettings={setSettings} 
                              onLoginSuccess={() => setShowAddAccount(false)} 
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>


                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">تایم فریم</label>
                        <select 
                          value={settings.timeframe?.value || 60}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            const label = e.target.options[e.target.selectedIndex].text;
                            setSettings({ ...settings, timeframe: { value: val, label } });
                          }}
                          className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50 transition-all appearance-none font-bold"
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
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">وضعیت اتصال</label>
                        <div className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-[10px] text-emerald-500 flex items-center gap-2 font-bold">
                          {botState?.isConnected ? (
                            <>
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              متصل ({settings.api?.accounts?.[settings.api?.activeAccountId]?.type?.toUpperCase() || 'NONE'})
                            </>
                          ) : (
                            <>
                              <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              قطع / در حال اتصال...
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>



                {/* Risk Management */}

                {/* Risk Management */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500" />
                    مدیریت ریسک و سرمایه
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداکثر ریسک هر معامله (تومان)</label>
                      <input 
                        type="number" 
                        value={settings.risk?.maxRiskTomanPerTrade || 1000000}
                        onChange={(e) => setSettings({ ...settings, risk: { ...settings.risk, maxRiskTomanPerTrade: parseInt(e.target.value) || 0 } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[9px] text-emerald-500 mt-1 font-bold">{(settings.risk?.maxRiskTomanPerTrade || 1000000).toLocaleString('fa-IR')} تومان</p>
                    </div>
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداکثر ضرر روزانه (تومان)</label>
                      <input 
                        type="number" 
                        value={settings.risk?.maxDailyLossToman || 5000000}
                        onChange={(e) => setSettings({ ...settings, risk: { ...settings.risk, maxDailyLossToman: parseInt(e.target.value) || 0 } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-rose-500/50 font-bold"
                      />
                      <p className="text-[9px] text-rose-500 mt-1 font-bold">{(settings.risk?.maxDailyLossToman || 5000000).toLocaleString('fa-IR')} تومان</p>
                    </div>
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداکثر پوزیشن همزمان</label>
                      <input 
                        type="number" 
                        value={settings.risk?.maxOpenPositions || 2}
                        onChange={(e) => setSettings({ ...settings, risk: { ...settings.risk, maxOpenPositions: parseInt(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حد سود پایه (تیک)</label>
                      <input 
                        type="number" 
                        value={settings.targetsTicks?.tpTicks || 18}
                        onChange={(e) => setSettings({ ...settings, targetsTicks: { ...settings.targetsTicks, tpTicks: parseInt(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                    </div>
                  </div>
                </section>

                {/* Market Settings */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <Database className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                    تنظیمات بازار و نماد
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">اندازه هر تیک (Tick Size)</label>
                      <input 
                        type="number" 
                        value={settings.market?.tickSize || 1}
                        onChange={(e) => setSettings({ ...settings, market: { ...settings.market, tickSize: parseInt(e.target.value) || 1 } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[7px] text-slate-500 mt-1 font-mono uppercase tracking-tight">مقدار هر واحد تغییر قیمت (معمولاً ۱ برای طلا)</p>
                    </div>
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">ارزش هر تیک (تومان)</label>
                      <input 
                        type="number" 
                        value={settings.market?.tickValueToman || 23000}
                        onChange={(e) => setSettings({ ...settings, market: { ...settings.market, tickValueToman: parseInt(e.target.value) || 0 } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[7px] text-slate-500 mt-1 font-mono uppercase tracking-tight">سود/ضرر هر ۱ تیک به ازای ۱ واحد معامله.</p>
                    </div>
                  </div>
                </section>

                {/* Safety & Anti-Arbitrage */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                    امنیت و ضد آربیتراژ (حساب واقعی)
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/5">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold">فعالسازی گارد امنیتی</span>
                        <span className="text-[8px] text-slate-500">جلوگیری از معامله در شرایط نامناسب</span>
                      </div>
                      <button 
                        onClick={() => setSettings({ ...settings, risk: { ...settings.risk, antiArbitrage: { ...settings.risk?.antiArbitrage, enabled: !settings.risk?.antiArbitrage?.enabled } } })}
                        className={`w-10 h-5 rounded-full transition-colors relative ${settings.risk?.antiArbitrage?.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.risk?.antiArbitrage?.enabled ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/5">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold">فیلتر اسپرد (Spread Filter)</span>
                        <span className="text-[8px] text-slate-500">جلوگیری از ورود در اسپرد بالا</span>
                      </div>
                      <button 
                        onClick={() => setSettings({ ...settings, risk: { ...settings.risk, useSpreadFilter: !settings.risk?.useSpreadFilter } })}
                        className={`w-10 h-5 rounded-full transition-colors relative ${settings.risk?.useSpreadFilter ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.risk?.useSpreadFilter ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداکثر اسپرد مجاز (تیک)</label>
                      <input 
                        type="number" 
                        value={settings.risk?.maxSpreadTicks || 15}
                        onChange={(e) => setSettings({ ...settings, risk: { ...settings.risk, maxSpreadTicks: parseInt(e.target.value) } })}
                        className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">جلوگیری از ورود در زمان باز شدن اسپرد (پیش‌فرض: ۱۵)</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداکثر تاخیر مجاز (میلی‌ثانیه)</label>
                      <input 
                        type="number" 
                        value={settings.risk?.antiArbitrage?.maxLatencyMs || 500}
                        onChange={(e) => setSettings({ ...settings, risk: { ...settings.risk, antiArbitrage: { ...settings.risk?.antiArbitrage, maxLatencyMs: parseInt(e.target.value) } } })}
                        className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">اگر پینگ بیشتر از این باشد، ربات وارد نمی‌شود (پیش‌فرض: ۵۰۰)</p>
                    </div>
                  </div>
                </section>

                {/* Backtest Settings */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <History className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
                    تنظیمات بک‌تست و شبیه‌سازی
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">لغزش قیمت (Slippage - تیک)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={settings.backtest?.slippageTicks || 1}
                        onChange={(e) => setSettings({ ...settings, backtest: { ...settings.backtest, slippageTicks: parseFloat(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[8px] text-slate-500 mt-1 font-mono uppercase tracking-tight">اختلاف قیمت ورود/خروج واقعی با قیمت مارکت.</p>
                    </div>
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">کارمزد (Commission - تیک)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={settings.backtest?.commissionTicks || 0.5}
                        onChange={(e) => setSettings({ ...settings, backtest: { ...settings.backtest, commissionTicks: parseFloat(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[8px] text-slate-500 mt-1 font-mono uppercase tracking-tight">هزینه هر معامله که از سود کسر می‌شود.</p>
                    </div>
                  </div>
                </section>

                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                    تنظیمات ریسک‌فری (Risk-Free)
                  </h2>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg transition-colors ${settings.targets?.breakEven?.enabled ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-500/10 text-slate-500'}`}>
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-bold text-white">فعال‌سازی ریسک‌فری خودکار</span>
                      </div>
                      <button 
                        onClick={() => setSettings({ 
                          ...settings, 
                          targets: { 
                            ...settings.targets, 
                            breakEven: { ...settings.targets?.breakEven, enabled: !settings.targets?.breakEven?.enabled } 
                          } 
                        })}
                        className={`w-10 h-5 rounded-full transition-all relative ${settings.targets?.breakEven?.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      >
                        <motion.div 
                          animate={{ x: settings.targets?.breakEven?.enabled ? 22 : 2 }}
                          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">درصد سود برای فعال‌سازی</label>
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
                          className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                        />
                        <p className="text-[7px] text-slate-500 mt-1 font-mono uppercase tracking-tight">مثلاً ۵۰ یعنی وقتی معامله ۵۰٪ به سمت تارگت رفت، ریسک‌فری شود.</p>
                      </div>
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">بافر ورود (تیک)</label>
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
                          className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                        />
                        <p className="text-[7px] text-slate-500 mt-1 font-mono uppercase tracking-tight">تعداد تیک بالاتر از نقطه ورود برای پوشش کارمزد.</p>
                      </div>
                    </div>

                    {/* Stepped Risk-Free */}
                    <div className="border-t border-white/5 pt-4 mt-1">
                      <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5 mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg transition-colors ${settings.targets?.steppedRiskFree?.enabled ? 'bg-emerald-500/20 text-emerald-500' : 'bg-blue-500/10 text-blue-500'}`}>
                            <Layers className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white">ریسک‌فری پله‌ای (هوشمند)</span>
                            <span className="text-[8px] text-slate-500 font-mono uppercase tracking-wider">کاهش ریسک در ۳ مرحله با حرکت قیمت</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => setSettings({ 
                            ...settings, 
                            targets: { 
                              ...settings.targets, 
                              steppedRiskFree: { ...settings.targets?.steppedRiskFree, enabled: !settings.targets?.steppedRiskFree?.enabled } 
                            } 
                          })}
                          className={`w-10 h-5 rounded-full transition-all relative ${settings.targets?.steppedRiskFree?.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.targets?.steppedRiskFree?.enabled ? 22 : 2 }}
                            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
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
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
                    سیستم‌های تهاجمی
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Reversal System */}
                    <div className="flex flex-col bg-white/5 p-3 rounded-xl border border-white/5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg transition-colors ${settings.targetsTicks?.reversal?.enabled ? 'bg-orange-500/20 text-orange-500' : 'bg-slate-500/10 text-slate-500'}`}>
                            <RefreshCw className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white">سیستم ریورس (Reversal)</span>
                            <span className="text-[8px] text-slate-500 font-mono uppercase tracking-wider">باز کردن پوزیشن معکوس در صورت ضرر</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => setSettings({ 
                            ...settings, 
                            targetsTicks: { 
                              ...settings.targetsTicks, 
                              reversal: { ...settings.targetsTicks?.reversal, enabled: !settings.targetsTicks?.reversal?.enabled } 
                            } 
                          })}
                          className={`w-10 h-5 rounded-full transition-all relative ${settings.targetsTicks?.reversal?.enabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.targetsTicks?.reversal?.enabled ? 22 : 2 }}
                            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                      {settings.targetsTicks?.reversal?.enabled && (
                        <div className="space-y-3 bg-orange-500/5 border border-orange-500/20 p-3 rounded-xl">
                          <div>
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">تعداد تیک ضرر برای فعال‌سازی</label>
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
                              className="w-full bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-orange-500/50 font-bold"
                            />
                          </div>
                          <div>
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">حداقل قدرت سیگنال معکوس</label>
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
                              className="w-full bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-orange-500/50 font-bold"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Pyramiding System */}
                    <div className="flex flex-col bg-white/5 p-3 rounded-xl border border-white/5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg transition-colors ${settings.strategy?.pyramiding?.enabled ? 'bg-orange-500/20 text-orange-500' : 'bg-slate-500/10 text-slate-500'}`}>
                            <Zap className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white">سیستم پله‌ای (Pyramiding)</span>
                            <span className="text-[8px] text-slate-500 font-mono uppercase tracking-wider">افزایش حجم در روند سودده</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => setSettings({ 
                            ...settings, 
                            strategy: { 
                              ...settings.strategy, 
                              pyramiding: { ...settings.strategy?.pyramiding, enabled: !settings.strategy?.pyramiding?.enabled } 
                            } 
                          })}
                          className={`w-10 h-5 rounded-full transition-all relative ${settings.strategy?.pyramiding?.enabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.strategy?.pyramiding?.enabled ? 22 : 2 }}
                            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                      {settings.strategy?.pyramiding?.enabled && (
                        <div className="space-y-3 bg-orange-500/5 border border-orange-500/20 p-3 rounded-xl">
                          <div>
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">تعداد تیک سود برای ورود پله دوم</label>
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
                              className="w-full bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-orange-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1 font-mono uppercase tracking-tight">پس از این مقدار سود، پله دوم وارد می‌شود.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Security Settings */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500" />
                    امنیت و آنتی-آربیتراژ
                  </h2>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg transition-colors ${settings.risk?.antiArbitrage?.enabled ? 'bg-rose-500/20 text-rose-500' : 'bg-slate-500/10 text-slate-500'}`}>
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-white">بسته امنیتی آنتی-آربیتراژ</span>
                          <span className="text-[8px] text-slate-500 font-mono uppercase tracking-wider">جلوگیری از حساسیت صرافی در حساب واقعی</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => setSettings({ 
                          ...settings, 
                          risk: { 
                            ...settings.risk, 
                            antiArbitrage: { ...settings.risk?.antiArbitrage, enabled: !settings.risk?.antiArbitrage?.enabled } 
                          } 
                        })}
                        className={`w-10 h-5 rounded-full transition-all relative ${settings.risk?.antiArbitrage?.enabled ? 'bg-rose-500' : 'bg-slate-700'}`}
                      >
                        <motion.div 
                          animate={{ x: settings.risk?.antiArbitrage?.enabled ? 22 : 2 }}
                          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>
                    {settings.risk?.antiArbitrage?.enabled && (
                      <div className="space-y-3 bg-rose-500/5 border border-rose-500/20 p-3 rounded-xl">
                        <div>
                          <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">حداقل زمان نگهداری (ثانیه)</label>
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
                            className="w-full bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-rose-500/50 font-bold"
                          />
                          <p className="text-[7px] text-slate-500 mt-1 font-mono uppercase tracking-tight">صرافی‌ها به پوزیشن‌های زیر ۳۰ ثانیه حساس هستند.</p>
                        </div>
                        <div className="flex items-center gap-2 text-[8px] text-rose-500/70 font-mono uppercase tracking-tight">
                          <ShieldAlert className="w-3 h-3" />
                          <span>تاخیر تصادفی (Jitter) برای شبیه‌سازی رفتار انسانی فعال است.</span>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Telegram Settings */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <Send className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
                    تنظیمات تلگرام
                  </h2>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-xs font-bold text-white">فعال‌سازی تلگرام</span>
                        <button 
                          onClick={() => setSettings({ ...settings, telegram: { ...settings.telegram, enabled: !settings.telegram.enabled } })}
                          className={`w-10 h-5 rounded-full transition-all relative ${settings.telegram.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.telegram.enabled ? 22 : 2 }}
                            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-xs font-bold text-white">ارسال لاگ‌ها به تلگرام</span>
                        <button 
                          onClick={() => setSettings({ ...settings, telegram: { ...settings.telegram, logEnabled: !settings.telegram.logEnabled } })}
                          className={`w-10 h-5 rounded-full transition-all relative ${settings.telegram.logEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.telegram.logEnabled ? 22 : 2 }}
                            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">توکن ربات (Bot Token)</label>
                        <input 
                          type="password" 
                          value={settings.telegram.botToken}
                          onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, botToken: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white focus:border-emerald-500/50 outline-none transition-all font-bold"
                          placeholder="توکن را اینجا وارد کنید"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">شناسه چت (Chat IDs - با کاما جدا کنید)</label>
                        <input 
                          type="text" 
                          value={settings.telegram.chatId}
                          onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, chatId: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white focus:border-emerald-500/50 outline-none transition-all font-bold"
                          placeholder="مثلاً 123456, 789012"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">راهنمای سریع (Quick Guide)</label>
                        <textarea 
                          value={settings.telegram.quickGuide}
                          onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, quickGuide: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white focus:border-emerald-500/50 outline-none transition-all h-20 resize-none font-medium"
                          placeholder="متن راهنمای سریع برای سیگنال‌ها"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Rubika Settings */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <Send className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400" />
                    تنظیمات روبیکا
                  </h2>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-xs font-bold text-white">فعال‌سازی روبیکا</span>
                        <button 
                          onClick={() => setSettings({ ...settings, rubika: { ...settings.rubika, enabled: !settings.rubika?.enabled } })}
                          className={`w-10 h-5 rounded-full transition-all relative ${settings.rubika?.enabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.rubika?.enabled ? 22 : 2 }}
                            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-xs font-bold text-white">ارسال لاگ‌ها به روبیکا</span>
                        <button 
                          onClick={() => setSettings({ ...settings, rubika: { ...settings.rubika, logEnabled: !settings.rubika?.logEnabled } })}
                          className={`w-10 h-5 rounded-full transition-all relative ${settings.rubika?.logEnabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.rubika?.logEnabled ? 22 : 2 }}
                            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-white">گزارش دراودان (Drawdown)</span>
                          <span className="text-[8px] text-slate-500">تحلیل MAE/MFE پس از خروج</span>
                        </div>
                        <button 
                          onClick={() => setSettings({ ...settings, rubika: { ...settings.rubika, drawdownReportEnabled: !settings.rubika?.drawdownReportEnabled } })}
                          className={`w-10 h-5 rounded-full transition-all relative ${settings.rubika?.drawdownReportEnabled ? 'bg-orange-500' : 'bg-slate-700'}`}
                        >
                          <motion.div 
                            animate={{ x: settings.rubika?.drawdownReportEnabled ? 22 : 2 }}
                            className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">توکن ربات روبیکا</label>
                        <input 
                          type="password" 
                          value={settings.rubika?.botToken || ''}
                          onChange={(e) => setSettings({ ...settings, rubika: { ...settings.rubika, botToken: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white focus:border-orange-500/50 outline-none transition-all font-bold"
                          placeholder="توکن روبیکا را اینجا وارد کنید"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase font-mono mb-1 block tracking-widest">شناسه چت روبیکا (Chat IDs - با کاما جدا کنید)</label>
                        <input 
                          type="text" 
                          value={settings.rubika?.chatId || ''}
                          onChange={(e) => setSettings({ ...settings, rubika: { ...settings.rubika, chatId: e.target.value } })}
                          className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white focus:border-orange-500/50 outline-none transition-all font-bold"
                          placeholder="مثلاً b0LWeW0W..."
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Trade Settings */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                    تنظیمات معامله
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حجم معامله (تعداد واحد - Units)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={settings.trade?.minUnits || 1}
                        onChange={(e) => setSettings({ ...settings, trade: { ...settings.trade, minUnits: parseFloat(e.target.value) } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[7px] text-slate-500 mt-1 font-mono uppercase tracking-tight">تعداد واحد پایه برای هر معامله. پیش‌فرض ۱ واحد است.</p>
                    </div>
                  </div>
                </section>

                {/* Signal Quality Settings */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <ShieldAlert className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                    کیفیت سیگنال‌ها
                  </h2>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg transition-colors ${settings.strategy?.highQualityMode ? 'bg-amber-500/20 text-amber-500' : 'bg-slate-500/10 text-slate-500'}`}>
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-white">حالت کیفیت بالا (High Quality)</span>
                          <span className="text-[8px] text-slate-500 font-mono uppercase tracking-wider">تعداد سیگنال کمتر، اما با دقت و تاییدیه بسیار بیشتر</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => setSettings({ 
                          ...settings, 
                          strategy: { ...settings.strategy, highQualityMode: !settings.strategy.highQualityMode } 
                        })}
                        className={`w-10 h-5 rounded-full transition-all relative ${settings.strategy?.highQualityMode ? 'bg-amber-500' : 'bg-slate-700'}`}
                      >
                        <motion.div 
                          animate={{ x: settings.strategy?.highQualityMode ? 22 : 2 }}
                          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>
                  </div>
                </section>

                {/* Strategy Selection */}
                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                    استراتژی فعال
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { id: 'HMAMACD', label: 'HMA + MACD', desc: 'کراس Hull و تایید MACD' },
                      { id: 'SCALP', label: 'اسکالپر پرو', desc: 'مبتنی بر RSI و EMA' },
                      { id: 'FAST', label: 'فوق سریع', desc: 'واکنش سریع به نوسان' },
                      { id: 'QUANT', label: 'کوانت', desc: 'پرایس اکشن و الگوها' },
                      { id: 'TREND', label: 'ترند فالووینگ', desc: 'کراس MA و MACD' },
                      { id: 'NUMERICAL', label: 'نوسان‌گیری عددی', desc: 'مومنتوم و اعداد رند' },
                      { id: 'HST', label: 'استراتژی HST', desc: 'تایید دوگانه Hull+SuperTrend' },
                      { id: 'HULL_SUPERTREND', label: 'هال + سوپرترند', desc: 'استراتژی جدید ترکیبی' },
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
                        className={`p-3 rounded-xl border transition-all text-right relative overflow-hidden group cursor-pointer ${settings.activeStrategy === type.id ? 'bg-emerald-500/10 border-emerald-500 text-white' : 'bg-white/5 border-white/5 text-slate-500 hover:bg-white/10'}`}
                      >
                        <div className="relative z-10">
                          <p className="text-[10px] font-bold">{type.label}</p>
                          <p className="text-[8px] opacity-60 mt-0.5 font-mono uppercase tracking-tight">{type.desc}</p>
                          
                          {settings.activeStrategy === type.id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowStrategySettings(!showStrategySettings);
                              }}
                              className="mt-2 w-full py-1 bg-emerald-500 text-white text-[8px] font-bold rounded-lg flex items-center justify-center gap-1.5 hover:bg-emerald-600 transition-colors"
                            >
                              <Settings className="w-2.5 h-2.5" />
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

                <section className="border-t border-white/5 pt-6">
                  <h2 className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-[0.2em] sm:tracking-[0.3em] flex items-center gap-3 mb-5">
                    <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                    فیلترها و محدودیت‌ها
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداکثر پوزیشن همزمان</label>
                      <input 
                        type="number" 
                        value={settings.strategy?.filters?.maxPositions || 3}
                        onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, filters: { ...settings.strategy?.filters, maxPositions: parseInt(e.target.value) } } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداکثر معامله در ۱۰ دقیقه</label>
                      <input 
                        type="number" 
                        value={settings.strategy?.filters?.maxTradesPer10Min || 2}
                        onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, filters: { ...settings.strategy?.filters, maxTradesPer10Min: parseInt(e.target.value) } } })}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-emerald-500/50 font-bold"
                      />
                      <p className="text-[7px] text-slate-500 mt-1 font-mono uppercase tracking-tight">برای جلوگیری از اورتریدینگ (Overtrading)</p>
                    </div>
                  </div>
                </section>

                {/* Strategy Parameters */}
                {showStrategySettings && (
                  <motion.section 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white/5 p-4 sm:p-6 rounded-2xl border border-white/5"
                  >
                    <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-5 flex items-center gap-3">
                      <Activity className="w-4 h-4" /> تنظیمات حرفه‌ای: {
                        settings.activeStrategy === 'HMAMACD' ? 'HMA + MACD' : 
                        settings.activeStrategy === 'SCALP' ? 'اسکالپر پرو' : 
                        settings.activeStrategy === 'FAST' ? 'فوق سریع' : 
                        settings.activeStrategy === 'QUANT' ? 'کوانت' : 
                        settings.activeStrategy === 'NUMERICAL' ? 'نوسان‌گیری عددی' : 
                        settings.activeStrategy === 'HST' ? 'استراتژی HST' : 
                        settings.activeStrategy === 'HULL_SUPERTREND' ? 'هال + سوپرترند' : 
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
                        className="space-y-4"
                      >
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/10">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <Zap className="w-3 h-3" />
                            راهنمای HMA + MACD
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            این استراتژی از کراس دو میانگین متحرک Hull برای تشخیص روند و از MACD برای تایید نهایی استفاده می‌کند.
                            ورود فقط زمانی انجام می‌شود که هر دو تاییدیه صادر شده باشند.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">HMA سریع</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.hmaFast || 9}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, hmaFast: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">HMA کند</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.hmaSlow || 21}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, hmaSlow: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">MACD Fast</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.macdFast || 12}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, macdFast: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-2 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">MACD Slow</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.macdSlow || 26}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, macdSlow: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-2 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">MACD Signal</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hmamacd?.macdSignal || 9}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, macdSignal: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-2 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">فیلتر فاصله (%)</label>
                            <input 
                              type="number" 
                              step="0.001"
                              value={settings.strategy?.hmamacd?.distanceFilter || 0.005}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, distanceFilter: parseFloat(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">قدرت کندل</label>
                            <input 
                              type="number" 
                              step="0.0001"
                              value={settings.strategy?.hmamacd?.minCandleStrength || 0.001}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hmamacd: { ...settings.strategy.hmamacd, minCandleStrength: parseFloat(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {settings.activeStrategy === 'SCALP' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20 mb-4">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <Zap className="w-3 h-3" />
                            راهنمای اسکالپر پرو (PRO VERSION)
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            این استراتژی برای نوسان‌گیری‌های سریع در چارت ۱ دقیقه‌ای طلا بهینه شده است. 
                            <br/>**حالت معامله:** با انتخاب حالت دقت بسیار بالا، ربات تنها در شرایطی وارد معامله می‌شود که تمامی فیلترها و تأییدیه‌ها هم‌جهت باشند.
                          </p>
                        </div>

                        {/* Trading Mode */}
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 mb-4">
                          <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حالت معامله (Trading Mode)</label>
                          <select 
                            value={settings.strategy?.scalp?.tradingMode || 'NORMAL'}
                            onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, scalp: { ...settings.strategy?.scalp, tradingMode: e.target.value } } })}
                            className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                          >
                            <option value="AGGRESSIVE">تهاجمی (Aggressive) 🔥</option>
                            <option value="NORMAL">دقت بالا (استاندارد) ⚖️</option>
                            <option value="PRECISION">دقت بسیار بالا (Precision) 💎</option>
                          </select>
                        </div>

                        {/* Minimum Signal Score */}
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 mb-4">
                          <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداقل امتیاز تاییدیه (۱-۱۰)</label>
                          <input 
                            type="number" 
                            value={settings.strategy?.minSignalScore || 1}
                            onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, minSignalScore: parseInt(e.target.value) } })}
                            className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                          />
                          <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">بالاتر = امنیت بیشتر، تعداد معامله کمتر (پیش‌فرض: ۱)</p>
                        </div>
                        
                        {/* Advanced Filters Section */}
                        <div className="mt-6">
                          <h4 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                            فیلترهای تاییدیه پیشرفته (SCALP)
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {[
                              { id: 'useRsiFilter', label: 'تاییدیه RSI', desc: 'اشباع خرید/فروش با RSI.', example: 'اگر RSI بالای ۶۰ یا زیر ۴۰ باشد، تاییدیه صادر می‌شود.' },
                              { id: 'useEmaFilter', label: 'میانگین‌های متحرک (EMA)', desc: 'تشخیص روند سریع و کند.', example: 'قیمت باید بالای EMA ۲۰۰ و EMA سریع بالای EMA کند باشد.' },
                              { id: 'useVolumeFilter', label: 'فیلتر حجم', desc: 'تاییدیه نقدینگی بازار.', example: 'حجم فعلی باید از میانگین ۲۰ کندل اخیر بیشتر باشد.' },
                              { id: 'useAtrFilter', label: 'فیلتر نوسان (ATR)', desc: 'جلوگیری از بازار مرده.', example: 'نوسان بازار باید از حد مشخصی بیشتر باشد تا سوددهی تضمین شود.' },
                              { id: 'useSpreadGuard', label: 'محافظ اسپرد', desc: 'کنترل فاصله قیمت خرید و فروش.', example: 'اگر اسپرد از ۱۰ تیک بیشتر شود، ربات وارد نمی‌شود.' },
                              { id: 'useMomentumFilter', label: 'مومنتوم آنی', desc: 'تشخیص حرکت انفجاری قیمت.', example: 'شتاب قیمت در ۳ کندل اخیر باید صعودی باشد.' },
                              { id: 'useAdxFilter', label: 'قدرت روند (ADX)', desc: 'فیلتر بازارهای ضعیف.', example: 'ADX باید بالای ۲۵ باشد تا روند معتبر شناخته شود.' },
                              { id: 'useStochFilter', label: 'فیلتر استوکاستیک', desc: 'تاییدیه اشباع خرید/فروش.', example: 'خطوط K و D باید در نواحی افراطی باشند.' },
                              { id: 'useMacdFilter', label: 'فیلتر MACD', desc: 'تاییدیه هیستوگرام و تقاطع.', example: 'خط MACD باید بالای خط سیگنال باشد.' },
                              { id: 'useBbFilter', label: 'باندهای بولینگر', desc: 'فیلتر محدوده قیمت.', example: 'قیمت نباید خارج از باندهای بولینگر باشد.' },
                              { id: 'useCandleFilter', label: 'الگوهای کندلی', desc: 'تاییدیه پرایس اکشن.', example: 'شناسایی الگوهای پین‌بار یا انگالفینگ.' },
                              { id: 'useMtfFilter', label: 'تاییدیه روند (MTF)', desc: 'هماهنگی روند در تایم‌فریم 5M.', example: 'روند ۵ دقیقه باید با جهت معامله ۱ دقیقه هماهنگ باشد.' },
                              { id: 'useDivergenceFilter', label: 'فیلتر واگرایی', desc: 'تشخیص بازگشت‌های احتمالی.', example: 'شناسایی واگرایی مثبت یا منفی بین قیمت و RSI.' },
                              { id: 'useOrderBlockFilter', label: 'نواحی نقدینگی (OB)', desc: 'تاییدیه اوردربلاک‌ها.', example: 'قیمت باید در محدوده یک اوردربلاک معتبر باشد.' },
                              { id: 'useSessionFilter', label: 'فیلتر زمانی (Session)', desc: 'ترید فقط در ساعات مشخص.', example: 'مثلاً فقط در سشن لندن و نیویورک ترید می‌کند.' },
                            ].map((filter) => (
                              <div key={filter.id} className="flex flex-col gap-2">
                                <div className="group relative flex items-center justify-between bg-white/5 p-2.5 rounded-xl border border-white/5 hover:border-emerald-500/20 transition-all">
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] font-bold text-slate-200">{filter.label}</span>
                                      <div className="relative group/tooltip">
                                        <Info className="w-3 h-3 text-slate-500 cursor-help hover:text-emerald-500 transition-colors" />
                                        <div className="absolute bottom-full left-0 mb-2 w-48 p-2 bg-slate-900 border border-white/10 rounded-lg shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all z-50 pointer-events-none">
                                          <p className="text-[8px] text-emerald-400 font-bold mb-1">آموزش:</p>
                                          <p className="text-[8px] text-slate-300 leading-relaxed mb-2">{filter.desc}</p>
                                          <p className="text-[8px] text-emerald-500/80 font-bold mb-0.5">مثال واقعی:</p>
                                          <p className="text-[7px] text-slate-400 italic leading-tight">{filter.example}</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                  <button 
                                    onClick={() => {
                                      const currentScalp = settings.strategy?.scalp || {};
                                      setSettings({ 
                                        ...settings, 
                                        strategy: { 
                                          ...settings.strategy, 
                                          scalp: { 
                                            ...currentScalp, 
                                            [filter.id]: !currentScalp[filter.id as keyof typeof currentScalp] 
                                          } 
                                        } 
                                      });
                                    }}
                                    className={`w-8 h-4 rounded-full transition-all relative ${settings.strategy?.scalp?.[filter.id as keyof typeof settings.strategy.scalp] ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-slate-700'}`}
                                  >
                                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.scalp?.[filter.id as keyof typeof settings.strategy.scalp] ? 'left-4.5' : 'left-0.5'}`} />
                                  </button>
                                </div>

                                {/* Conditional Settings */}
                                <AnimatePresence>
                                  {settings.strategy?.scalp?.[filter.id] && (
                                    <motion.div 
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: 'auto' }}
                                      exit={{ opacity: 0, height: 0 }}
                                      className="space-y-2 px-1 pb-2 overflow-hidden"
                                    >
                                      {filter.id === 'useRsiFilter' && (
                                        <div className="grid grid-cols-3 gap-2">
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">دوره</label>
                                            <input type="number" value={settings.strategy?.indicators?.rsi?.period || 14} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, rsi: {...settings.strategy.indicators.rsi, period: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">OS</label>
                                            <input type="number" value={settings.strategy?.indicators?.rsi?.oversold || 40} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, rsi: {...settings.strategy.indicators.rsi, oversold: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">OB</label>
                                            <input type="number" value={settings.strategy?.indicators?.rsi?.overbought || 60} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, rsi: {...settings.strategy.indicators.rsi, overbought: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                        </div>
                                      )}
                                      {filter.id === 'useEmaFilter' && (
                                        <div className="grid grid-cols-3 gap-2">
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">سریع</label>
                                            <input type="number" value={settings.strategy?.indicators?.ema?.fast || 9} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, ema: {...settings.strategy.indicators.ema, fast: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">کند</label>
                                            <input type="number" value={settings.strategy?.indicators?.ema?.slow || 21} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, ema: {...settings.strategy.indicators.ema, slow: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">بلند</label>
                                            <input type="number" value={settings.strategy?.indicators?.ema?.longTerm || 200} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, ema: {...settings.strategy.indicators.ema, longTerm: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                        </div>
                                      )}
                                      {filter.id === 'useStochFilter' && (
                                        <div className="grid grid-cols-4 gap-2">
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">K</label>
                                            <input type="number" value={settings.strategy?.indicators?.stoch?.k || 14} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, stoch: {...settings.strategy.indicators.stoch, k: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">D</label>
                                            <input type="number" value={settings.strategy?.indicators?.stoch?.d || 3} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, stoch: {...settings.strategy.indicators.stoch, d: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">OS</label>
                                            <input type="number" value={settings.strategy?.indicators?.stoch?.oversold || 20} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, stoch: {...settings.strategy.indicators.stoch, oversold: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">OB</label>
                                            <input type="number" value={settings.strategy?.indicators?.stoch?.overbought || 80} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, stoch: {...settings.strategy.indicators.stoch, overbought: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                        </div>
                                      )}
                                      {filter.id === 'useMacdFilter' && (
                                        <div className="grid grid-cols-3 gap-2">
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">سریع</label>
                                            <input type="number" value={settings.strategy?.indicators?.macd?.fast || 12} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, macd: {...settings.strategy.indicators.macd, fast: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">کند</label>
                                            <input type="number" value={settings.strategy?.indicators?.macd?.slow || 26} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, macd: {...settings.strategy.indicators.macd, slow: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">سیگنال</label>
                                            <input type="number" value={settings.strategy?.indicators?.macd?.signal || 9} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, macd: {...settings.strategy.indicators.macd, signal: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                        </div>
                                      )}
                                      {filter.id === 'useBbFilter' && (
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">دوره</label>
                                            <input type="number" value={settings.strategy?.indicators?.bb?.period || 20} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, bb: {...settings.strategy.indicators.bb, period: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">انحراف</label>
                                            <input type="number" value={settings.strategy?.indicators?.bb?.stdDev || 2} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, bb: {...settings.strategy.indicators.bb, stdDev: parseFloat(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                        </div>
                                      )}
                                      {filter.id === 'useSessionFilter' && (
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">شروع</label>
                                            <input type="text" value={settings.strategy?.scalp?.sessionStart || '11:00'} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, scalp: {...settings.strategy.scalp, sessionStart: e.target.value}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                          <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <label className="text-[6px] text-slate-500 uppercase block mb-0.5">پایان</label>
                                            <input type="text" value={settings.strategy?.scalp?.sessionEnd || '19:00'} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, scalp: {...settings.strategy.scalp, sessionEnd: e.target.value}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                          </div>
                                        </div>
                                      )}
                                      {filter.id === 'useVolumeFilter' && (
                                        <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                          <label className="text-[6px] text-slate-500 uppercase block mb-0.5">حداقل حجم (SMA)</label>
                                          <input type="number" value={settings.strategy?.indicators?.volume?.minSma || 20} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, volume: {...settings.strategy.indicators.volume, minSma: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                        </div>
                                      )}
                                      {filter.id === 'useAtrFilter' && (
                                        <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                          <label className="text-[6px] text-slate-500 uppercase block mb-0.5">حداقل نوسان (ATR %)</label>
                                          <input type="number" step="0.01" value={settings.strategy?.indicators?.atr?.minThreshold || 0.05} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, atr: {...settings.strategy.indicators.atr, minThreshold: parseFloat(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                        </div>
                                      )}
                                      {filter.id === 'useSpreadGuard' && (
                                        <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                          <label className="text-[6px] text-slate-500 uppercase block mb-0.5">حداکثر اسپرد (تیک)</label>
                                          <input type="number" value={settings.strategy?.indicators?.spread?.maxTicks || 10} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, spread: {...settings.strategy.indicators.spread, maxTicks: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                        </div>
                                      )}
                                      {filter.id === 'useMomentumFilter' && (
                                        <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                          <label className="text-[6px] text-slate-500 uppercase block mb-0.5">آستانه مومنتوم</label>
                                          <input type="number" step="0.1" value={settings.strategy?.indicators?.momentum?.threshold || 1.5} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, momentum: {...settings.strategy.indicators.momentum, threshold: parseFloat(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                        </div>
                                      )}
                                      {filter.id === 'useAdxFilter' && (
                                        <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                          <label className="text-[6px] text-slate-500 uppercase block mb-0.5">حداقل ADX</label>
                                          <input type="number" value={settings.strategy?.indicators?.adx?.minLevel || 25} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, adx: {...settings.strategy.indicators.adx, minLevel: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                        </div>
                                      )}
                                      {filter.id === 'useMtfFilter' && (
                                        <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                          <label className="text-[6px] text-slate-500 uppercase block mb-0.5">تایم‌فریم تاییدیه</label>
                                          <select value={settings.strategy?.indicators?.mtf?.timeframe || '5m'} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, mtf: {...settings.strategy.indicators.mtf, timeframe: e.target.value}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold">
                                            <option value="5m">۵ دقیقه</option>
                                            <option value="15m">۱۵ دقیقه</option>
                                            <option value="1h">۱ ساعت</option>
                                          </select>
                                        </div>
                                      )}
                                      {filter.id === 'useDivergenceFilter' && (
                                        <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                          <label className="text-[6px] text-slate-500 uppercase block mb-0.5">بازه بررسی (Lookback)</label>
                                          <input type="number" value={settings.strategy?.indicators?.divergence?.lookback || 30} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, divergence: {...settings.strategy.indicators.divergence, lookback: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                        </div>
                                      )}
                                      {filter.id === 'useOrderBlockFilter' && (
                                        <div className="bg-black/20 p-1.5 rounded-lg border border-white/5">
                                          <label className="text-[6px] text-slate-500 uppercase block mb-0.5">قدرت ناحیه (OB)</label>
                                          <input type="number" value={settings.strategy?.indicators?.ob?.minStrength || 2} onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, ob: {...settings.strategy.indicators.ob, minStrength: parseInt(e.target.value)}}}})} className="w-full bg-transparent text-[9px] text-white outline-none font-bold" />
                                        </div>
                                      )}
                                      {filter.id === 'useCandleFilter' && (
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="flex items-center gap-2 bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <input 
                                              type="checkbox" 
                                              checked={settings.strategy?.indicators?.candles?.pinbar !== false} 
                                              onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, candles: {...settings.strategy.indicators.candles, pinbar: e.target.checked}}}})} 
                                              className="w-3 h-3 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-0"
                                            />
                                            <span className="text-[8px] text-slate-300">پین‌بار (Pinbar)</span>
                                          </div>
                                          <div className="flex items-center gap-2 bg-black/20 p-1.5 rounded-lg border border-white/5">
                                            <input 
                                              type="checkbox" 
                                              checked={settings.strategy?.indicators?.candles?.engulfing !== false} 
                                              onChange={(e) => setSettings({...settings, strategy: {...settings.strategy, indicators: {...settings.strategy.indicators, candles: {...settings.strategy.indicators.candles, engulfing: e.target.checked}}}})} 
                                              className="w-3 h-3 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-0"
                                            />
                                            <span className="text-[8px] text-slate-300">انگالفینگ (Engulfing)</span>
                                          </div>
                                        </div>
                                      )}
                                      {/* Add more sub-settings as needed */}
                                      {['useCandleFilter'].includes(filter.id) && (
                                        <div className="bg-black/20 p-2 rounded-lg border border-white/5">
                                          <p className="text-[7px] text-slate-400 leading-tight">تاییدیه الگوهای پرایس اکشن در نواحی حساس قیمت فعال است.</p>
                                        </div>
                                      )}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'FAST' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <Zap className="w-3 h-3" />
                            راهنمای استراتژی فوق سریع
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            طراحی شده برای شکار حرکت‌های انفجاری طلا. در زمان اخبار یا نوسانات شدید عالی عمل می‌کند.
                            <br/>**مثال:** در زمان نوسان کم، کول‌داون را روی ۱۵ ثانیه بگذارید تا از ورودهای مکرر در یک نقطه جلوگیری شود.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداقل امتیاز تاییدیه (۱-۱۰)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.minSignalScore || 1}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, minSignalScore: parseInt(e.target.value) } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">بالاتر = امنیت بیشتر، تعداد معامله کمتر (پیش‌فرض: ۱)</p>
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">کول‌داون (ثانیه)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.tradeCooldown || 8}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, tradeCooldown: parseInt(e.target.value) } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">فاصله زمانی اجباری بین دو معامله (مثال: ۸ ثانیه)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'HST' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <ShieldCheck className="w-3 h-3" />
                            راهنمای استراتژی HST (Hull + SuperTrend)
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            یکی از دقیق‌ترین استراتژی‌ها برای بازار طلا. از میانگین متحرک هال برای فیلتر نویز استفاده می‌کند.
                            <br/>**مثال:** برای امنیت حداکثری، حالت را روی PRECISION قرار دهید. در این حالت فقط زمانی وارد می‌شود که تمام اندیکاتورها هم‌جهت باشند.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حالت معامله (Aggressive vs Precision)</label>
                            <select 
                              value={settings.strategy?.hst?.mode || 'NORMAL'}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hst: { ...settings.strategy?.hst, mode: e.target.value } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            >
                              <option value="PRECISION">دقت بسیار بالا 💎</option>
                              <option value="NORMAL">دقت بالا (استاندارد) ⚖️</option>
                              <option value="AGGRESSIVE">تهاجمی 🔥</option>
                            </select>
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">ضریب SuperTrend (حساسیت روند)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.hst?.stMultiplier || 3}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hst: { ...settings.strategy?.hst, stMultiplier: parseFloat(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">کمتر = واکنش سریع‌تر به چرخش قیمت (پیش‌فرض: ۳)</p>
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">دوره HMA (Hull Moving Average)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hst?.hmaLength || 55}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hst: { ...settings.strategy?.hst, hmaLength: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">طول میانگین متحرک برای تشخیص روند کلی (مثال: ۵۵)</p>
                          </div>
                          <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-bold">تاییدیه قیمت بالای HMA</span>
                              <span className="text-[8px] text-slate-500">فیلتر سخت‌گیرانه برای ورود</span>
                            </div>
                            <button 
                              onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, hst: { ...settings.strategy?.hst, requireCloseAboveHMA: !settings.strategy?.hst?.requireCloseAboveHMA } } })}
                              className={`w-8 h-4 rounded-full transition-colors relative ${settings.strategy?.hst?.requireCloseAboveHMA ? 'bg-emerald-500' : 'bg-slate-700'}`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.hst?.requireCloseAboveHMA ? 'left-4.5' : 'left-0.5'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'HULL_SUPERTREND' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <ShieldCheck className="w-3 h-3" />
                            راهنمای استراتژی هال + سوپرترند (جدید)
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            استراتژی ترکیبی بر اساس تقاطع خطوط HMA و EHMA با تاییدیه جهت از SuperTrend.
                            <br/>**نکته:** این استراتژی برای تایم فریم ۵ دقیقه بهینه شده است و از تقاطع خط آبی (EHMA) و نارنجی (HMA) سیگنال می‌گیرد.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">طول Hull Suite (Length)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.hullSuperTrend?.hullLength || 55}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hullSuperTrend: { ...settings.strategy?.hullSuperTrend, hullLength: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">پیش‌فرض: ۵۵ (بهینه برای طلا)</p>
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">ضریب SuperTrend</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.hullSuperTrend?.stMultiplier || 3}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, hullSuperTrend: { ...settings.strategy?.hullSuperTrend, stMultiplier: parseFloat(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'NUMERICAL' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <Zap className="w-3 h-3" />
                            راهنمای نوسان‌گیری عددی (Numerical)
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            مبتنی بر روانشناسی اعداد رند و مومنتوم آنی. عالی برای نوسانات پله‌ای طلا.
                            <br/>**مثال:** اگر اسپرد بازار زیاد است، حد اسپرد را روی ۲۰ تیک بگذارید تا فرصت‌های بیشتری شناسایی شود.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حد اسپرد مجاز (تیک)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.numerical?.spreadThreshold || 14}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, numerical: { ...settings.strategy?.numerical, spreadThreshold: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">حداکثر فاصله خرید و فروش (مثال: ۱۴)</p>
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حد سود (تیک)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.numerical?.takeProfitPips || 10}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, numerical: { ...settings.strategy?.numerical, takeProfitPips: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حد ضرر (تیک)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.numerical?.stopLossPips || 8}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, numerical: { ...settings.strategy?.numerical, stopLossPips: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-rose-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">فاصله مگنت عدد رند</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.numerical?.roundNumberMagnet || 5}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, numerical: { ...settings.strategy?.numerical, roundNumberMagnet: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">فاصله تا عدد رند (مثال: ۵ تیک)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'QUANT' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <BarChart3 className="w-3 h-3" />
                            راهنمای استراتژی کوانت (Quant)
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            ترکیب ریاضیات و پرایس اکشن. از میانگین‌های متحرک بلندمدت برای تشخیص روند اصلی استفاده می‌کند.
                            <br/>**مثال:** برای معاملات میان‌مدت، MA کند را روی ۲۰۰ و MA سریع را روی ۵۰ بگذارید.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">MA سریع (روند کوتاه‌مدت)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.quant?.maFast || 50}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, maFast: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">MA کند (روند بلندمدت)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.quant?.maSlow || 200}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, maSlow: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">نسبت ریسک به ریوارد (R:R)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.quant?.riskRewardRatio || 2}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, quant: { ...settings.strategy?.quant, riskRewardRatio: parseFloat(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">مثال: ۲ یعنی به ازای هر ۱ واحد ضرر، ۲ واحد سود هدف‌گذاری شود.</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'PINBAR' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <Activity className="w-3 h-3" />
                            راهنمای استراتژی پین بار (Pinbar)
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            تمرکز بر روی بازگشت‌های قیمتی با استفاده از کندل‌های پین‌بار.
                            <br/>**مثال:** برای سخت‌گیرانه‌تر کردن الگو، نسبت سایه را روی ۳.۰ بگذارید تا فقط پین‌بارهای با سایه بسیار بلند تایید شوند.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">نسبت بدنه (حداکثر)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.pinbar?.bodyRatio || 0.4}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, pinbar: { ...settings.strategy?.pinbar, bodyRatio: parseFloat(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">نسبت بدنه به کل کندل (پیش‌فرض: ۰.۴)</p>
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">نسبت سایه (حداقل)</label>
                            <input 
                              type="number" 
                              step="0.1"
                              value={settings.strategy?.pinbar?.wickRatio || 2.5}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, pinbar: { ...settings.strategy?.pinbar, wickRatio: parseFloat(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">نسبت سایه به بدنه (بزرگتر = قوی‌تر)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'MTF_PATTERN' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <Globe className="w-3 h-3" />
                            راهنمای الگوهای MTF (Multi-Timeframe)
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            تحلیل همزمان تایم‌فریم ۱ دقیقه و ۵ دقیقه برای یافتن نقاط ورود دقیق.
                            <br/>**مثال:** اگر می‌خواهید فقط در جهت روند ۵ دقیقه‌ای وارد شوید، امتیاز تاییدیه را روی ۴ بگذارید.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداقل امتیاز سیگنال (۱-۵)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.mtfPatterns?.minScore || 3}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, mtfPatterns: { ...settings.strategy?.mtfPatterns, minScore: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-bold">فیلتر حجم معاملات</span>
                              <span className="text-[8px] text-slate-500">تاییدیه با حجم بازار</span>
                            </div>
                            <button 
                              onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, mtfPatterns: { ...settings.strategy?.mtfPatterns, useVolume: !settings.strategy?.mtfPatterns?.useVolume } } })}
                              className={`w-8 h-4 rounded-full transition-colors relative ${settings.strategy?.mtfPatterns?.useVolume ? 'bg-emerald-500' : 'bg-slate-700'}`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.mtfPatterns?.useVolume ? 'left-4.5' : 'left-0.5'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'ICHIMOKU_MTF' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <Cloud className="w-3 h-3" />
                            راهنمای ایچیموکو MTF
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            استفاده از قدرت ابر کومو و خطوط کیجون/تنکان برای شکار روندهای پایدار.
                            <br/>**مثال:** برای امنیت بالا، حتماً تاییدیه ابر کومو را روشن بگذارید تا فقط در جهت ابر معامله کند.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداقل امتیاز سیگنال</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.ichimoku?.minScore || 4}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, ichimoku: { ...settings.strategy?.ichimoku, minScore: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-bold">تاییدیه ابر کومو</span>
                              <span className="text-[8px] text-slate-500">معامله فقط در جهت ابر</span>
                            </div>
                            <button 
                              onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, ichimoku: { ...settings.strategy?.ichimoku, trendFilter: { ...settings.strategy?.ichimoku?.trendFilter, requireCloudConfirmation: !settings.strategy?.ichimoku?.trendFilter?.requireCloudConfirmation } } } })}
                              className={`w-8 h-4 rounded-full transition-colors relative ${settings.strategy?.ichimoku?.trendFilter?.requireCloudConfirmation ? 'bg-emerald-500' : 'bg-slate-700'}`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.ichimoku?.trendFilter?.requireCloudConfirmation ? 'left-4.5' : 'left-0.5'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settings.activeStrategy === 'ICHIMOKU_HARAMI' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <Activity className="w-3 h-3" />
                            راهنمای ایچیموکو هارامی
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            ترکیب سطوح ایچیموکو با الگوهای بازگشتی خاص مانند هارامی، نفوذی و ابر سیاه.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداقل امتیاز سیگنال</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.ichimokuHarami?.riskManagement?.minScore || 4}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, ichimokuHarami: { ...settings.strategy?.ichimokuHarami, riskManagement: { ...settings.strategy?.ichimokuHarami?.riskManagement, minScore: parseInt(e.target.value) } } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">حداقل قدرت هارامی</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.ichimokuHarami?.patterns?.harami?.minStrength || 3}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, ichimokuHarami: { ...settings.strategy?.ichimokuHarami, patterns: { ...settings.strategy?.ichimokuHarami?.patterns, harami: { ...settings.strategy?.ichimokuHarami?.patterns?.harami, minStrength: parseInt(e.target.value) } } } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                    {settings.activeStrategy === 'TREND' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-500 font-bold mb-1 flex items-center gap-2">
                            <TrendingUp className="w-3 h-3" />
                            راهنمای ترند فالووینگ (Trend Following)
                          </p>
                          <p className="text-[8px] text-slate-400 leading-relaxed font-medium">
                            استراتژی کلاسیک تعقیب روند با استفاده از تقاطع میانگین‌های متحرک.
                            <br/>**مثال:** برای روندهای بلندمدت، MA سریع را روی ۲۰ و MA کند را روی ۵۰ بگذارید.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">MA سریع (دوره کوتاه)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.trend?.maFast || 20}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, trend: { ...settings.strategy?.trend, maFast: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                          <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">MA کند (دوره بلند)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.trend?.maSlow || 50}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, trend: { ...settings.strategy?.trend, maSlow: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-emerald-500/50 font-bold"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Entry Optimization Section */}
                    <div className="space-y-4 pt-5 mt-5 border-t border-white/10">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-4 h-4 text-amber-500" />
                        <h3 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">بهینه‌سازی ورود (Entry Optimization)</h3>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold">ورود در پولبک (Pullback)</span>
                            <span className="text-[8px] text-slate-500">انتظار برای قیمت بهتر بعد از سیگنال</span>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, pullback: { ...settings.strategy?.pullback, enabled: !settings.strategy?.pullback?.enabled } } })}
                            className={`w-8 h-4 rounded-full transition-colors relative ${settings.strategy?.pullback?.enabled ? 'bg-amber-500' : 'bg-slate-700'}`}
                          >
                            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.pullback?.enabled ? 'left-4.5' : 'left-0.5'}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold">تاییدیه چند زمانی (MTF)</span>
                            <span className="text-[8px] text-slate-500">هماهنگی با روند تایم‌فریم ۵ دقیقه</span>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setSettings({ ...settings, strategy: { ...settings.strategy, mtf: { ...settings.strategy?.mtf, enabled: !settings.strategy?.mtf?.enabled } } })}
                            className={`w-8 h-4 rounded-full transition-colors relative ${settings.strategy?.mtf?.enabled ? 'bg-blue-500' : 'bg-slate-700'}`}
                          >
                            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${settings.strategy?.mtf?.enabled ? 'left-4.5' : 'left-0.5'}`} />
                          </button>
                        </div>

                        {settings.strategy?.pullback?.enabled && (
                          <div className="sm:col-span-2 bg-white/5 p-3 rounded-xl border border-white/5">
                            <label className="text-[8px] text-slate-500 uppercase font-mono mb-1.5 block tracking-widest">میزان عقب‌نشینی (تیک)</label>
                            <input 
                              type="number" 
                              value={settings.strategy?.pullback?.retracementTicks || 5}
                              onChange={(e) => setSettings({ ...settings, strategy: { ...settings.strategy, pullback: { ...settings.strategy?.pullback, retracementTicks: parseInt(e.target.value) } } })}
                              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-amber-500/50 font-bold"
                            />
                            <p className="text-[7px] text-slate-500 mt-1.5 font-mono uppercase tracking-tight">چند تیک قیمت برگردد تا وارد شویم؟ (پیش‌فرض: ۵)</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.section>
                )}
              </div>

              <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row gap-3">
                <button 
                  onClick={async () => {
                    if (window.confirm('آیا از راه‌اندازی مجدد ربات اطمینان دارید؟')) {
                      await fetch('/api/bot/restart', { method: 'POST' });
                      setShowSettings(false);
                    }
                  }}
                  className="flex-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-[10px] border border-rose-500/20"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  راه‌اندازی مجدد موتور
                </button>
                <button 
                  onClick={saveSettings}
                  className="flex-[2] bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 text-[10px]"
                >
                  <Save className="w-3.5 h-3.5" />
                  ذخیره تنظیمات
                </button>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-400 py-3 rounded-xl transition-all text-[10px] font-bold border border-white/5"
                >
                  انصراف
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCopyTrade && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" dir="rtl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#0a0a0a] border border-white/10 rounded-3xl p-6 sm:p-8 w-full max-w-4xl shadow-2xl relative max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-black text-white">کپی ترید (Copy Trade)</h2>
                    <p className="text-xs text-slate-400 mt-1">اتصال هوشمند و ریل‌تایم بین دو حساب</p>
                  </div>
                </div>
                <button onClick={() => setShowCopyTrade(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Source Account */}
                <div className="space-y-4 bg-white/5 p-6 rounded-3xl border border-white/5">
                  <h3 className="text-sm font-bold text-blue-500 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    حساب مبدا (Source)
                  </h3>
                  <p className="text-[10px] text-slate-500">حسابی که معاملات آن مانیتور و کپی می‌شود.</p>
                  
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, source: { ...settings.copyTrade.source, type: 'demo' } } })}
                        className={`py-2 rounded-xl text-[10px] font-bold transition-all ${settings?.copyTrade?.source?.type === 'demo' ? 'bg-blue-500 text-white' : 'bg-white/5 text-slate-400'}`}
                      >دمو</button>
                      <button 
                        onClick={() => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, source: { ...settings.copyTrade.source, type: 'real' } } })}
                        className={`py-2 rounded-xl text-[10px] font-bold transition-all ${settings?.copyTrade?.source?.type === 'real' ? 'bg-rose-500 text-white' : 'bg-white/5 text-slate-400'}`}
                      >ریل</button>
                    </div>
                    <input 
                      type="text" 
                      placeholder="Bearer Token (Source)" 
                      value={settings?.copyTrade?.source?.bearerToken || ''}
                      onChange={(e) => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, source: { ...settings.copyTrade.source, bearerToken: e.target.value } } })}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-blue-500/50"
                    />
                  </div>
                </div>

                {/* Destination Account */}
                <div className="space-y-4 bg-white/5 p-6 rounded-3xl border border-white/5">
                  <h3 className="text-sm font-bold text-emerald-500 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    حساب مقصد (Destination)
                  </h3>
                  <p className="text-[10px] text-slate-500">حسابی که معاملات در آن اجرا می‌شود.</p>
                  
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, destination: { ...settings.copyTrade.destination, type: 'demo' } } })}
                        className={`py-2 rounded-xl text-[10px] font-bold transition-all ${settings?.copyTrade?.destination?.type === 'demo' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-slate-400'}`}
                      >دمو</button>
                      <button 
                        onClick={() => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, destination: { ...settings.copyTrade.destination, type: 'real' } } })}
                        className={`py-2 rounded-xl text-[10px] font-bold transition-all ${settings?.copyTrade?.destination?.type === 'real' ? 'bg-rose-500 text-white' : 'bg-white/5 text-slate-400'}`}
                      >ریل</button>
                    </div>
                    <input 
                      type="text" 
                      placeholder="Bearer Token (Destination)" 
                      value={settings?.copyTrade?.destination?.bearerToken || ''}
                      onChange={(e) => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, destination: { ...settings.copyTrade.destination, bearerToken: e.target.value } } })}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
              </div>

              {/* Advanced Settings */}
              <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                  <label className="text-[10px] text-slate-500 uppercase mb-2 block">ضریب حجم (Multiplier)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={settings?.copyTrade?.multiplier || 1}
                    onChange={(e) => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, multiplier: parseFloat(e.target.value) || 1 } })}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none"
                  />
                </div>
                <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span className="text-[10px] text-slate-500 uppercase">کپی حد سود (TP)</span>
                  <button 
                    onClick={() => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, copyTP: !settings.copyTrade.copyTP } })}
                    className={`w-10 h-5 rounded-full relative transition-colors ${settings?.copyTrade?.copyTP ? 'bg-emerald-500' : 'bg-slate-700'}`}
                  >
                    <motion.div animate={{ x: settings?.copyTrade?.copyTP ? 22 : 2 }} className="w-4 h-4 bg-white rounded-full absolute top-0.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span className="text-[10px] text-slate-500 uppercase">کپی حد ضرر (SL)</span>
                  <button 
                    onClick={() => setSettings({ ...settings, copyTrade: { ...settings.copyTrade, copySL: !settings.copyTrade.copySL } })}
                    className={`w-10 h-5 rounded-full relative transition-colors ${settings?.copyTrade?.copySL ? 'bg-emerald-500' : 'bg-slate-700'}`}
                  >
                    <motion.div animate={{ x: settings?.copyTrade?.copySL ? 22 : 2 }} className="w-4 h-4 bg-white rounded-full absolute top-0.5" />
                  </button>
                </div>
              </div>

              {/* Logs & Status */}
              <div className="mt-8 bg-black/40 rounded-3xl border border-white/5 overflow-hidden">
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                  <h3 className="text-xs font-bold text-slate-400 flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    لاگ‌های سیستم کپی ترید
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${botState?.copyTrade?.isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                    <span className="text-[10px] font-bold text-slate-500">{botState?.copyTrade?.isRunning ? 'در حال اجرا' : 'متوقف'}</span>
                  </div>
                </div>
                <div className="h-48 overflow-y-auto p-4 space-y-2 font-mono text-[10px]">
                  {botState?.copyTrade?.logs?.map((log: any, i: number) => (
                    <div key={i} className="flex gap-3 border-b border-white/5 pb-1">
                      <span className="text-slate-600">[{log.time}]</span>
                      <span className={
                        log.type === 'ERROR' ? 'text-rose-500' : 
                        log.type === 'SUCCESS' ? 'text-emerald-500' : 
                        log.type === 'SIGNAL' ? 'text-blue-500' : 'text-slate-400'
                      }>{log.message}</span>
                    </div>
                  ))}
                  {(!botState?.copyTrade?.logs || botState.copyTrade.logs.length === 0) && (
                    <div className="text-center text-slate-600 py-10 italic">هیچ لاگی ثبت نشده است.</div>
                  )}
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button 
                  onClick={async () => {
                    if (isTogglingCopy) return;
                    setIsTogglingCopy(true);
                    try {
                      const newSettings = { ...settings, copyTrade: { ...settings.copyTrade, enabled: !botState?.copyTrade?.isRunning } };
                      setSettings(newSettings);
                      
                      // 1. Save settings
                      await fetch('/api/copytrade/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newSettings.copyTrade)
                      });
                      
                      // 2. Toggle engine
                      const res = await fetch('/api/copytrade/toggle', { method: 'POST' });
                      const data = await res.json();
                      
                      if (!data.success && data.message) {
                        alert(data.message);
                      }
                    } catch (e) {
                      alert('خطا در برقراری ارتباط با سرور');
                    } finally {
                      setIsTogglingCopy(false);
                    }
                  }}
                  disabled={isTogglingCopy}
                  className={`flex-1 py-4 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 shadow-xl ${isTogglingCopy ? 'opacity-50 cursor-not-allowed' : ''} ${botState?.copyTrade?.isRunning ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500/20' : 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-500/20'}`}
                >
                  {isTogglingCopy ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : botState?.copyTrade?.isRunning ? (
                    <>
                      <Power className="w-5 h-5" />
                      توقف سیستم کپی ترید
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      فعال‌سازی کپی ترید
                    </>
                  )}
                </button>
                <button 
                  onClick={async () => {
                    await fetch('/api/copytrade/settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(settings.copyTrade)
                    });
                    alert('تنظیمات با موفقیت ذخیره شد.');
                  }}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all border border-white/10 flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  ذخیره تنظیمات
                </button>
              </div>
            </motion.div>
          </div>
        )}

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

        {showIncreasePortfolio && (
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
                    <TrendingUp className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-black text-white">افزایش سرمایه</h2>
                    <p className="text-xs text-slate-400 mt-1">افزایش موجودی پرتفوی فعلی</p>
                  </div>
                </div>
                <button onClick={() => setShowIncreasePortfolio(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-sm text-slate-400 mb-3 block">مبلغ افزایش (تومان)</label>
                  <input 
                    type="number" 
                    value={increaseAmount}
                    onChange={(e) => setIncreaseAmount(parseInt(e.target.value) || 0)}
                    className="w-full bg-white/5 border border-white/5 rounded-2xl px-4 py-4 text-center text-2xl font-black text-emerald-500 outline-none focus:border-emerald-500/50"
                    placeholder="مثلاً ۵,۰۰۰,۰۰۰"
                  />
                  <p className="text-[10px] text-slate-500 mt-2 text-center">موجودی فعلی پرتفو: {botState.portfolio ? formatPrice(botState.portfolio.balance) : '---'}</p>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-emerald-500/80">موجودی جدید پس از افزایش:</span>
                    <span className="font-bold text-emerald-500">{formatPrice((botState.portfolio?.balance || 0) + increaseAmount)}</span>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={handleIncreasePortfolio}
                    disabled={isCreatingPortfolio || increaseAmount <= 0}
                    className="flex-[2] bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/20"
                  >
                    {isCreatingPortfolio ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    تایید و افزایش سرمایه
                  </button>
                  <button 
                    onClick={() => setShowIncreasePortfolio(false)}
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
