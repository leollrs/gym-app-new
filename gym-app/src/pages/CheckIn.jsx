import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, CheckCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO, isToday, isYesterday, formatDistanceToNow } from 'date-fns';

const METHOD_LABELS = { manual: 'Manual', qr: 'QR Scan', gps: 'GPS' };
const METHOD_COLORS = { manual: '#9CA3AF', qr: '#D4AF37', gps: '#10B981' };

// ── Main ─────────────────────────────────────────────────────────────────────
export default function CheckIn() {
  const navigate  = useNavigate();
  const { user, profile } = useAuth();

  const [checkins,   setCheckins]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [checking,   setChecking]   = useState(false);
  const [confirmed,  setConfirmed]  = useState(false);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('check_ins')
      .select('id, checked_in_at, method')
      .eq('profile_id', user.id)
      .order('checked_in_at', { ascending: false })
      .limit(50);
    setCheckins(data ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Already checked in today?
  const todayCheckIn = checkins.find(c => isToday(new Date(c.checked_in_at)));

  const handleCheckIn = async () => {
    if (todayCheckIn) return;
    setChecking(true);
    setError('');
    const { error: err } = await supabase.from('check_ins').insert({
      profile_id:     user.id,
      gym_id:         profile.gym_id,
      method:         'manual',
      checked_in_at:  new Date().toISOString(),
    });
    if (err) { setError(err.message); setChecking(false); return; }
    supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', user.id);
    setConfirmed(true);
    await load();
    setChecking(false);
    // Reset animation after 3s
    setTimeout(() => setConfirmed(false), 3000);
  };

  // ── Streak ──────────────────────────────────────────────────────────────────
  const streak = (() => {
    const dateSets = new Set(checkins.map(c => format(new Date(c.checked_in_at), 'yyyy-MM-dd')));
    let s = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = format(d, 'yyyy-MM-dd');
      if (dateSets.has(key)) s++;
      else if (i > 0) break;
    }
    return s;
  })();

  // ── Group history by date label ──────────────────────────────────────────────
  const grouped = checkins.reduce((acc, c) => {
    const d   = new Date(c.checked_in_at);
    const key = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy');
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  return (
    <div className="mx-auto w-full max-w-[600px] px-4 md:px-6 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div>
          <h1 className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Check In</h1>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Log your gym visit</p>
        </div>
      </div>

      {/* ── Check-in button ──────────────────────────────────────────────────── */}
      <div
        className="rounded-[14px] p-6 mb-5 flex flex-col items-center text-center"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
      >
        {/* Big check-in button */}
        <button
          onClick={handleCheckIn}
          disabled={checking || !!todayCheckIn}
          className="relative w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2 transition-all duration-300 mb-5 active:scale-95"
          style={
            todayCheckIn
              ? { background: 'rgba(16,185,129,0.12)', border: '3px solid rgba(16,185,129,0.4)', cursor: 'default' }
              : confirmed
              ? { background: 'rgba(212,175,55,0.2)', border: '3px solid rgba(212,175,55,0.6)', boxShadow: '0 0 40px rgba(212,175,55,0.3)' }
              : { background: 'rgba(212,175,55,0.1)', border: '3px solid rgba(212,175,55,0.3)' }
          }
        >
          {checking ? (
            <div className="w-10 h-10 border-3 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          ) : todayCheckIn ? (
            <CheckCircle size={44} style={{ color: '#10B981' }} strokeWidth={1.5} />
          ) : (
            <MapPin size={44} style={{ color: '#D4AF37' }} strokeWidth={1.5} />
          )}
          <p
            className="text-[13px] font-bold"
            style={{ color: todayCheckIn ? '#10B981' : '#D4AF37' }}
          >
            {todayCheckIn ? 'Checked In' : 'Check In'}
          </p>
        </button>

        {todayCheckIn ? (
          <div>
            <p className="text-[15px] font-bold text-white mb-1">You're in!</p>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Checked in at {format(new Date(todayCheckIn.checked_in_at), 'h:mm a')}
            </p>
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Tap to log today's gym visit
          </p>
        )}

        {error && <p className="text-[12px] text-red-400 mt-2">{error}</p>}

        {/* Streak */}
        <div
          className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-full"
          style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.15)' }}
        >
          <span className="text-[22px] font-black" style={{ color: '#D4AF37' }}>{streak}</span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            day{streak !== 1 ? 's' : ''} this week streak
          </span>
        </div>
      </div>

      {/* ── History ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : checkins.length === 0 ? (
        <div
          className="rounded-[14px] py-12 text-center"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          <MapPin size={28} style={{ color: '#4B5563', margin: '0 auto 12px' }} strokeWidth={1.5} />
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No check-ins yet</p>
        </div>
      ) : (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          <p className="text-[13px] font-semibold px-5 pt-4 pb-2" style={{ color: 'var(--text-muted)' }}>History</p>
          <div className="divide-y divide-white/4">
            {Object.entries(grouped).map(([label, items]) => (
              <div key={label}>
                <p className="text-[11px] font-bold uppercase tracking-widest px-5 py-2" style={{ color: 'var(--text-muted)' }}>
                  {label}
                </p>
                {items.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${METHOD_COLORS[c.method] ?? '#9CA3AF'}18` }}
                    >
                      <MapPin size={14} style={{ color: METHOD_COLORS[c.method] ?? '#9CA3AF' }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">
                        {format(new Date(c.checked_in_at), 'h:mm a')}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {METHOD_LABELS[c.method] ?? c.method}
                      </p>
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {formatDistanceToNow(new Date(c.checked_in_at), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
