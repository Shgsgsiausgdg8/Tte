import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, LogIn, CheckCircle2, AlertCircle } from 'lucide-react';
import axios from 'axios';

interface LoginSectionProps {
  type: 'real' | 'demo';
  settings: any;
  setSettings: (settings: any) => void;
  onLoginSuccess?: () => void;
}

export const LoginSection: React.FC<LoginSectionProps> = ({ type, settings, setSettings, onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [csrftoken, setCsrftoken] = useState('');
  const [captchaKey, setCaptchaKey] = useState('');
  const [captchaUrl, setCaptchaUrl] = useState('');
  const [captchaValue, setCaptchaValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const fetchCaptcha = async () => {
    try {
      const res = await axios.get(`/api/auth/captcha?type=${type}`);
      setCaptchaKey(res.data.key);
      setCaptchaUrl(res.data.image_url);
      setCaptchaValue('');
    } catch (err: any) {
      setError('خطا در دریافت کپچا');
    }
  };

  useEffect(() => {
    fetchCaptcha();
  }, [type]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      const res = await axios.post('/api/auth/login', {
        type,
        username,
        password,
        captcha_key: captchaKey,
        captcha_value: captchaValue
      });

      if (res.data.success) {
        setSuccess(true);
        const newSettings = { ...settings };
        if (!newSettings.api) newSettings.api = { activeAccountId: '', accounts: {} };
        if (!newSettings.api.accounts) newSettings.api.accounts = {};
        
        const accountId = username;
        newSettings.api.accounts[accountId] = {
          type,
          username,
          password,
          accessToken: res.data.access,
          refreshToken: res.data.refresh,
          bearerToken: res.data.access,
          baseUrl: type === 'real' ? 'https://farazgold.com' : 'https://demo.farazgold.com',
          wsUrl: type === 'real' ? 'wss://farazgold.com/ws/' : 'wss://demo.farazgold.com/ws/',
          csrftoken: csrftoken || '',
          sessionid: ''
        };
        newSettings.api.activeAccountId = accountId;
        
        setSettings(newSettings);
        // Save to backend
        axios.post('/api/bot/settings', newSettings);
        
        if (onLoginSuccess) onLoginSuccess();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.detail || 'خطا در ورود');
      fetchCaptcha(); // Refresh captcha on error
    } finally {
      setLoading(false);
    }
  };

  const themeColor = type === 'real' ? 'rose' : 'emerald';

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">شماره موبایل / نام کاربری</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={`w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-${themeColor}-500/50 outline-none transition-all text-left`}
            placeholder="09..."
            dir="ltr"
            required
          />
        </div>
        <div>
          <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">رمز عبور</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-${themeColor}-500/50 outline-none transition-all text-left`}
            required
          />
        </div>
      </div>

      <div>
        <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">CSRF Token (اختیاری)</label>
        <input
          type="text"
          value={csrftoken}
          onChange={(e) => setCsrftoken(e.target.value)}
          className={`w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-${themeColor}-500/50 outline-none transition-all text-left font-mono`}
          placeholder="اگر توکن CSRF دارید وارد کنید"
          dir="ltr"
        />
      </div>

      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="text-[9px] text-slate-500 uppercase font-mono mb-2 block">کد امنیتی</label>
          <input
            type="text"
            value={captchaValue}
            onChange={(e) => setCaptchaValue(e.target.value)}
            className={`w-full bg-white/5 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:border-${themeColor}-500/50 outline-none transition-all text-center tracking-widest`}
            required
          />
        </div>
        <div className="h-[46px] rounded-xl overflow-hidden border border-white/5 relative bg-white/5 flex items-center justify-center min-w-[120px]">
          {captchaUrl ? (
            <img src={captchaUrl} alt="captcha" className="h-full object-cover" />
          ) : (
            <span className="text-xs text-slate-500">در حال بارگذاری...</span>
          )}
          <button
            type="button"
            onClick={fetchCaptcha}
            className="absolute top-1 right-1 p-1 bg-black/50 rounded-lg hover:bg-black/80 transition-colors"
          >
            <RefreshCw className="w-3 h-3 text-white" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !username || !password || !captchaValue}
        className={`w-full py-3 rounded-2xl bg-${themeColor}-500 hover:bg-${themeColor}-600 text-white font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {loading ? (
          <RefreshCw className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <LogIn className="w-5 h-5" />
            ورود به حساب {type === 'real' ? 'ریل' : 'دمو'}
          </>
        )}
      </button>
    </form>
  );
};
