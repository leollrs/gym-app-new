import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { subDays } from 'date-fns';

// Read gym slug from ?gym=slug query param
const getGymSlug = () => new URLSearchParams(window.location.search).get('gym');

const METRICS = [
  { key: 'volume',   label: 'VOLUME',   unit: 'LBS',     period: 'THIS MONTH' },
  { key: 'workouts', label: 'WORKOUTS', unit: 'SESSIONS', period: 'THIS MONTH' },
  { key: 'prs',      label: 'TOP PRs',  unit: 'RECORDS',  period: 'ALL TIME'   },
];

const MEDAL_COLORS = ['#D4AF37', '#9CA3AF', '#CD7F32'];
const ROTATE_MS = 20_000; // rotate metric every 20 seconds

export default function TVDisplay() {
  const [entries,    setEntries]    = useState([]);
  const [gymName,    setGymName]    = useState('');
  const [logoUrl,    setLogoUrl]    = useState('');
  const [accentColor, setAccentColor] = useState('#D4AF37');
  const [gymId,      setGymId]      = useState(null);
  const [metricIdx,  setMetricIdx]  = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [noSlug,     setNoSlug]     = useState(false);
  const [clock,      setClock]      = useState(new Date());
  const channelRef = useRef(null);

  const metric = METRICS[metricIdx];

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Rotate metric
  useEffect(() => {
    const t = setInterval(() => setMetricIdx(i => (i + 1) % METRICS.length), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  // Resolve gym from slug
  useEffect(() => {
    const slug = getGymSlug();
    if (!slug) {
      setNoSlug(true);
      setLoading(false);
      return;
    }
    const resolve = async () => {
      const { data: gym } = await supabase
        .from('gyms')
        .select('id, name')
        .eq('slug', slug)
        .single();
      if (gym) {
        setGymId(gym.id);
      } else {
        setNoSlug(true);
        setLoading(false);
      }
    };
    resolve();
  }, []);

  // Load gym branding
  useEffect(() => {
    if (!gymId) return;
    const loadBranding = async () => {
      const [{ data: gym }, { data: branding }] = await Promise.all([
        supabase.from('gyms').select('name').eq('id', gymId).single(),
        supabase.from('gym_branding').select('accent_color, logo_url, custom_app_name').eq('gym_id', gymId).single(),
      ]);
      setGymName(branding?.custom_app_name || gym?.name || 'GYM');
      setLogoUrl(branding?.logo_url || '');
      setAccentColor(branding?.accent_color || '#D4AF37');
    };
    loadBranding();
  }, [gymId]);

  // Load leaderboard entries
  const loadEntries = async () => {
    if (!gymId) return;
    setLoading(true);
    const from = subDays(new Date(), 30).toISOString();

    if (metric.key === 'prs') {
      const { data } = await supabase
        .from('personal_records')
        .select('profile_id, estimated_1rm, exercises(name), profiles(full_name)')
        .eq('gym_id', gymId)
        .order('estimated_1rm', { ascending: false })
        .limit(10);

      const agg = {};
      (data || []).forEach(r => {
        const id = r.profile_id;
        if (!agg[id]) agg[id] = { name: r.profiles?.full_name ?? '—', score: 0 };
        agg[id].score++;
      });
      setEntries(Object.entries(agg).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score).slice(0, 10));
    } else {
      const { data } = await supabase
        .from('workout_sessions')
        .select('profile_id, total_volume_lbs, profiles(full_name)')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .gte('started_at', from);

      const agg = {};
      (data || []).forEach(s => {
        const id = s.profile_id;
        if (!agg[id]) agg[id] = { name: s.profiles?.full_name ?? '—', volume: 0, count: 0 };
        agg[id].volume += parseFloat(s.total_volume_lbs || 0);
        agg[id].count++;
      });
      const list = Object.entries(agg)
        .map(([id, v]) => ({ id, name: v.name, score: metric.key === 'volume' ? Math.round(v.volume) : v.count }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      setEntries(list);
    }
    setLoading(false);
  };

  useEffect(() => { loadEntries(); }, [gymId, metricIdx]);

  // Realtime subscription
  useEffect(() => {
    if (!gymId) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = supabase
      .channel(`tv-${gymId}-${metric.key}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'workout_sessions',
        filter: `gym_id=eq.${gymId}`,
      }, loadEntries)
      .subscribe();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [gymId, metricIdx]);

  if (noSlug) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#05070B', fontFamily: 'Barlow, sans-serif' }}
      >
        <div className="text-center space-y-4">
          <p className="text-[28px] font-bold text-white/30">No gym specified</p>
          <p className="text-[16px] text-white/20">
            Add a <code className="text-white/40">?gym=your-slug</code> parameter to the URL.
          </p>
        </div>
      </div>
    );
  }

  const accent = accentColor;
  const maxScore = entries[0]?.score || 1;

  const fmtScore = (score) => {
    if (metric.key === 'volume') {
      if (score >= 1_000_000) return `${(score / 1_000_000).toFixed(2)}M`;
      if (score >= 1000)      return `${(score / 1000).toFixed(1)}K`;
      return score.toLocaleString();
    }
    return score.toLocaleString();
  };

  return (
    <div
      className="min-h-screen flex flex-col overflow-hidden select-none"
      style={{ background: '#05070B', fontFamily: 'Barlow, sans-serif' }}
    >
      {/* ── Header bar ──────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-12 py-6 flex-shrink-0"
        style={{ borderBottom: `2px solid ${accent}22` }}
      >
        <div className="flex items-center gap-5">
          {logoUrl && (
            <img src={logoUrl} alt="Logo" className="h-12 w-12 object-contain rounded-xl" />
          )}
          <div>
            <p className="text-[13px] font-bold tracking-[0.3em] uppercase" style={{ color: accent }}>
              Live Leaderboard
            </p>
            <p className="text-[28px] font-black text-white leading-tight">{gymName}</p>
          </div>
        </div>

        {/* Metric selector dots */}
        <div className="flex items-center gap-4">
          {METRICS.map((m, i) => (
            <button
              key={m.key}
              onClick={() => setMetricIdx(i)}
              className="flex items-center gap-2 transition-opacity"
              style={{ opacity: i === metricIdx ? 1 : 0.3 }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
              <span className="text-[13px] font-bold tracking-widest uppercase text-white">{m.label}</span>
            </button>
          ))}
        </div>

        {/* Clock */}
        <div className="text-right">
          <p className="text-[36px] font-black text-white leading-none tabular-nums">
            {clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
          </p>
          <p className="text-[13px] tracking-widest uppercase mt-1" style={{ color: accent }}>
            {clock.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
        </div>
      </header>

      {/* ── Metric title ──────────────────────────────────────────── */}
      <div className="px-12 pt-8 pb-4 flex-shrink-0">
        <div className="flex items-baseline gap-4">
          <h1 className="text-[72px] font-black leading-none tracking-tight" style={{ color: accent }}>
            {metric.label}
          </h1>
          <p className="text-[22px] font-bold tracking-widest uppercase text-white/40 pb-2">
            {metric.period}
          </p>
        </div>
      </div>

      {/* ── Leaderboard ───────────────────────────────────────────── */}
      <div className="flex-1 px-12 pb-8 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-12 h-12 border-2 rounded-full animate-spin" style={{ borderColor: `${accent}30`, borderTopColor: accent }} />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-[28px] font-bold text-white/30">No activity yet this month</p>
            <p className="text-[16px] text-white/20 mt-2">Start training to appear on the board</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 h-full">
            {entries.map((e, i) => {
              const barWidth = Math.round((e.score / maxScore) * 100);
              const isTop3 = i < 3;
              const rankColor = i === 0 ? '#D4AF37' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'rgba(255,255,255,0.2)';
              return (
                <div
                  key={e.id}
                  className="relative flex items-center gap-6 rounded-2xl overflow-hidden flex-shrink-0"
                  style={{
                    height: i === 0 ? '88px' : '68px',
                    background: isTop3 ? `${accent}08` : 'rgba(255,255,255,0.02)',
                    border: isTop3 ? `1px solid ${accent}20` : '1px solid rgba(255,255,255,0.04)',
                    transition: 'all 0.6s ease',
                  }}
                >
                  {/* Progress bar background */}
                  <div
                    className="absolute inset-0 opacity-20 rounded-2xl transition-all duration-1000"
                    style={{ width: `${barWidth}%`, background: `linear-gradient(90deg, ${accent}40, transparent)` }}
                  />

                  {/* Rank */}
                  <div className="flex-shrink-0 w-16 flex items-center justify-center relative z-10">
                    {i < 3 ? (
                      <span style={{ fontSize: i === 0 ? '40px' : '32px' }}>
                        {['🥇', '🥈', '🥉'][i]}
                      </span>
                    ) : (
                      <span className="text-[24px] font-black" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {i + 1}
                      </span>
                    )}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0 relative z-10 pr-4">
                    <p
                      className="font-black truncate"
                      style={{
                        fontSize: i === 0 ? '32px' : '24px',
                        color: i === 0 ? accent : 'rgba(255,255,255,0.9)',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {e.name}
                    </p>
                  </div>

                  {/* Score */}
                  <div className="flex-shrink-0 text-right pr-8 relative z-10">
                    <p
                      className="font-black tabular-nums"
                      style={{ fontSize: i === 0 ? '36px' : '26px', color: i === 0 ? accent : 'rgba(255,255,255,0.7)' }}
                    >
                      {fmtScore(e.score)}
                    </p>
                    <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {metric.unit}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer
        className="px-12 py-4 flex items-center justify-between flex-shrink-0"
        style={{ borderTop: `1px solid rgba(255,255,255,0.04)` }}
      >
        <p className="text-[12px] font-bold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Updates live · rotates every 20s
        </p>
        <div className="flex gap-1.5">
          {METRICS.map((_, i) => (
            <span
              key={i}
              className="h-1 rounded-full transition-all duration-500"
              style={{ width: i === metricIdx ? '24px' : '6px', background: i === metricIdx ? accent : 'rgba(255,255,255,0.15)' }}
            />
          ))}
        </div>
      </footer>
    </div>
  );
}
