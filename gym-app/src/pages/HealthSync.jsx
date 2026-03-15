import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Heart, Activity, Scale, Dumbbell, Check, RefreshCw } from 'lucide-react';
import * as healthSync from '../lib/healthSync';

// ── localStorage key ───────────────────────────────────────────────────────────
const SETTINGS_KEY = 'ironforge_health_settings';

const defaultSettings = {
  syncWeight: false,
  syncWorkouts: false,
  importWeight: false,
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
};

const saveSettings = (s) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
};

// ── Toggle switch ──────────────────────────────────────────────────────────────
const Toggle = ({ enabled, onToggle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={enabled}
    onClick={onToggle}
    className="relative shrink-0 transition-colors duration-200 rounded-full"
    style={{
      width: 44,
      height: 24,
      backgroundColor: enabled ? '#D4AF37' : '#374151',
    }}
  >
    <span
      className="block rounded-full bg-white shadow transition-transform duration-200"
      style={{
        width: 18,
        height: 18,
        transform: `translate(${enabled ? 22 : 3}px, 3px)`,
      }}
    />
  </button>
);

// ── Main page ──────────────────────────────────────────────────────────────────
const HealthSync = () => {
  const navigate = useNavigate();

  const [connected, setConnected] = useState(false);
  const [available, setAvailable] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [todaySteps, setTodaySteps] = useState(0);
  const [weeklyCalories, setWeeklyCalories] = useState(0);

  const [settings, setSettings] = useState(loadSettings);

  // Check availability on mount
  useEffect(() => {
    healthSync.isAvailable().then((ok) => setAvailable(ok));
  }, []);

  // Fetch activity data when connected
  const fetchActivity = useCallback(async () => {
    if (!connected) return;
    setRefreshing(true);
    try {
      const [steps, weekly] = await Promise.all([
        healthSync.readTodaySteps(),
        healthSync.readWeeklyActivitySummary(),
      ]);
      setTodaySteps(steps);
      setWeeklyCalories(weekly.calories);
    } catch {
      // silently fail
    }
    setRefreshing(false);
  }, [connected]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Persist settings changes
  const updateSetting = (key) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSettings(next);
      return next;
    });
  };

  // Connect handler
  const handleConnect = async () => {
    setConnecting(true);
    const { granted } = await healthSync.requestPermissions();
    if (granted) {
      setConnected(true);
    }
    setConnecting(false);
  };

  return (
    <div className="min-h-screen bg-[#05070B]">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-[#05070B]/90 backdrop-blur-2xl border-b border-white/6">
        <div className="max-w-[600px] mx-auto flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors"
          >
            <ArrowLeft size={20} className="text-[#E5E7EB]" />
          </button>
          <h1 className="text-[17px] font-bold text-[#E5E7EB]">Health Integration</h1>
        </div>
      </div>

      <div className="max-w-[600px] mx-auto px-4 pb-32 pt-4 space-y-5">
        {/* ── Connection Status ────────────────────────────────────────────── */}
        <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center">
                <Heart size={20} className="text-[#D4AF37]" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-[#E5E7EB]">
                  {Capacitor_isIOS() ? 'Apple Health' : 'Health Connect'}
                </p>
                <p className="text-[12px] text-[#9CA3AF]">
                  {connected ? 'Syncing health data' : 'Not connected'}
                </p>
              </div>
            </div>

            {connected ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#10B981]/15 text-[#10B981] text-[12px] font-semibold">
                <Check size={14} />
                Connected
              </span>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting || !available}
                className="px-4 py-2 rounded-xl bg-[#D4AF37] text-[#05070B] text-[13px] font-bold disabled:opacity-40 hover:bg-[#C5A028] transition-colors"
              >
                {connecting ? 'Connecting...' : !available ? 'Not Available' : 'Connect'}
              </button>
            )}
          </div>
          {!available && !connected && (
            <p className="mt-3 text-[12px] text-[#6B7280] leading-relaxed">
              Health integration is only available on iOS (Apple Health) and Android (Health Connect).
              Open this app on your phone to connect.
            </p>
          )}
        </div>

        {/* ── Today's Activity ─────────────────────────────────────────────── */}
        {connected && (
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-semibold text-[#6B7280] uppercase tracking-widest">
                Today's Activity
              </h2>
              <button
                type="button"
                onClick={fetchActivity}
                disabled={refreshing}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
              >
                <RefreshCw
                  size={15}
                  className={`text-[#9CA3AF] ${refreshing ? 'animate-spin' : ''}`}
                />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-[#0B1220] border border-white/6 p-4 text-center">
                <Activity size={20} className="text-[#D4AF37] mx-auto mb-2" />
                <p className="text-[24px] font-black text-[#E5E7EB] leading-none">
                  {todaySteps.toLocaleString()}
                </p>
                <p className="text-[11px] text-[#6B7280] mt-1 uppercase tracking-wider">Steps</p>
              </div>
              <div className="rounded-xl bg-[#0B1220] border border-white/6 p-4 text-center">
                <Dumbbell size={20} className="text-[#D4AF37] mx-auto mb-2" />
                <p className="text-[24px] font-black text-[#E5E7EB] leading-none">
                  {weeklyCalories.toLocaleString()}
                </p>
                <p className="text-[11px] text-[#6B7280] mt-1 uppercase tracking-wider">
                  Cal (7d)
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Sync Settings ───────────────────────────────────────────────── */}
        <div>
          <h2 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">
            Sync Settings
          </h2>
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 overflow-hidden divide-y divide-white/6">
            {/* Sync weight out */}
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <Scale size={16} className="text-[#6B7280] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#E5E7EB]">Sync weight to Health</p>
                  <p className="text-[12px] text-[#6B7280] leading-snug mt-0.5">
                    Write weight entries when you log in Body Metrics
                  </p>
                </div>
              </div>
              <Toggle
                enabled={settings.syncWeight}
                onToggle={() => updateSetting('syncWeight')}
              />
            </div>

            {/* Sync workouts out */}
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <Dumbbell size={16} className="text-[#6B7280] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#E5E7EB]">Sync workouts to Health</p>
                  <p className="text-[12px] text-[#6B7280] leading-snug mt-0.5">
                    Write completed sessions as workouts
                  </p>
                </div>
              </div>
              <Toggle
                enabled={settings.syncWorkouts}
                onToggle={() => updateSetting('syncWorkouts')}
              />
            </div>

            {/* Import weight in */}
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <Heart size={16} className="text-[#6B7280] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#E5E7EB]">Import weight from Health</p>
                  <p className="text-[12px] text-[#6B7280] leading-snug mt-0.5">
                    Show health store weight data alongside app data
                  </p>
                </div>
              </div>
              <Toggle
                enabled={settings.importWeight}
                onToggle={() => updateSetting('importWeight')}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Tiny helper — detect platform label without importing Capacitor in JSX
function Capacitor_isIOS() {
  try {
    // eslint-disable-next-line no-undef
    return /iphone|ipad/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

export default HealthSync;
