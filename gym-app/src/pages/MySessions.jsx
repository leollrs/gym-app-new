import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Package, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import MyTrainerCard from '../components/MyTrainerCard';

const FONT_DISPLAY = "'Familjen Grotesk', 'Archivo', system-ui, sans-serif";
const FONT_BODY = "'Archivo', system-ui, sans-serif";

// Date-only 'yyyy-MM-dd' compared/rendered in LOCAL time (mirrors the trainer
// side — `new Date('2026-06-01')` would parse as UTC and drift a day in PR).
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseLocalDate = (v) => {
  if (!v) return null;
  const m = typeof v === 'string' && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Member "Training Sessions" wallet — how many prepaid personal-training
 * sessions the member has left with their trainer, punch-card style. Reads the
 * member's OWN session_packs (RLS: client_id = auth.uid()). Links to the trainer
 * via the shared MyTrainerCard (message / view profile). Sessions are consumed
 * by a DB trigger when a booked session is completed (migration 0534); dates +
 * titles come from 0642.
 */
export default function MySessions() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');

  const [packs, setPacks] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    // select('*') so this survives before/after 0642 (title/starts_at/
    // expires_at simply come back undefined until it's applied).
    const { data, error } = await supabase
      .from('session_packs')
      .select('*')
      .eq('client_id', profile.id)
      .order('created_at', { ascending: false });
    if (error) {
      if (error.code !== '42P01' && error.code !== 'PGRST205') logger.error('MySessions: load failed', error);
      setPacks([]);
    } else {
      setPacks(data || []);
    }
    setLoaded(true);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (v) => {
    const d = parseLocalDate(v);
    return d ? d.toLocaleDateString(i18n.language?.startsWith('es') ? 'es' : 'en', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  };

  const today = localToday();
  const rows = packs.map((p) => {
    const total = Number(p.sessions_total) || 0;
    const used = Math.max(0, Number(p.sessions_used) || 0);
    const left = Math.max(0, total - used);
    const expired = !!(p.expires_at && p.expires_at < today);
    return { ...p, total, used, left, expired, active: p.is_active && !expired && left > 0 };
  });
  const active = rows.filter((r) => r.active);
  const past = rows.filter((r) => !r.active);

  const packLabel = (r) => (r.title && r.title.trim()) || t('sessions.nPack', '{{n}}-session pack', { n: r.total });

  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-3xl px-4 pt-6 pb-36 md:pb-12 animate-fade-in" style={{ fontFamily: FONT_BODY }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('sessions.back', 'Go back')}
          className="w-11 h-11 flex items-center justify-center rounded-2xl active:scale-95 transition-all duration-200"
          style={{ background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', border: '1px solid var(--color-border-subtle)' }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[24px] truncate" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: '-0.4px' }}>
            {t('sessions.title', 'Training Sessions')}
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('sessions.subtitle', 'Your prepaid sessions with your trainer')}
          </p>
        </div>
      </div>

      {/* Trainer link (message / view profile) — renders null if no trainer */}
      <MyTrainerCard />

      {!loaded ? null : active.length === 0 && past.length === 0 ? (
        /* Empty state */
        <div className="rounded-[22px] p-6 text-center" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}>
            <Package size={22} style={{ color: 'var(--color-accent)' }} />
          </div>
          <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: FONT_DISPLAY }}>
            {t('sessions.emptyTitle', 'No prepaid sessions yet')}
          </p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('sessions.emptyBody', "When your trainer sells you a session pack, it'll show up here.")}
          </p>
        </div>
      ) : (
        <>
          {/* Active pack heroes — punch-card style, member accent */}
          {active.map((r) => {
            const dots = Math.min(r.total, 30);
            return (
              <div key={r.id} className="rounded-[22px] p-5 mb-4"
                style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-card)), var(--color-bg-card))', border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Package size={14} style={{ color: 'var(--color-accent)' }} />
                  <span className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text-primary)', fontFamily: FONT_DISPLAY }}>{packLabel(r)}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 42, lineHeight: 1, color: 'var(--color-accent)', letterSpacing: '-1.2px' }}>{r.left}</span>
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                    {t('sessions.ofLeft', 'of {{total}} sessions left', { total: r.total })}
                  </span>
                </div>
                {/* stamp grid — filled = a session you still have */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {Array.from({ length: dots }).map((_, i) => {
                    const filled = i < r.left;
                    return (
                      <div key={i} className="w-6 h-6 rounded-full flex items-center justify-center"
                        style={filled
                          ? { background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }
                          : { border: '1.5px dashed color-mix(in srgb, var(--color-text-primary) 20%, transparent)' }}>
                        {filled ? <Check size={13} strokeWidth={3} /> : null}
                      </div>
                    );
                  })}
                  {r.total > dots && (
                    <span className="text-[12px] font-bold self-center" style={{ color: 'var(--color-text-muted)' }}>+{r.total - dots}</span>
                  )}
                </div>
                {(r.starts_at || r.expires_at) && (
                  <div className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                    <Clock size={12} />
                    {r.expires_at ? t('sessions.expires', 'Expires {{date}}', { date: fmtDate(r.expires_at) }) : t('sessions.from', 'From {{date}}', { date: fmtDate(r.starts_at) })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Past packs */}
          {past.length > 0 && (
            <div className="rounded-[22px] p-4 mt-1" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
                {t('sessions.past', 'Past packs')}
              </p>
              <div className="flex flex-col gap-2.5">
                {past.map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-bg-secondary)' }}>
                      <Package size={16} style={{ color: 'var(--color-text-muted)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{packLabel(r)}</p>
                      <p className="text-[11.5px]" style={{ color: 'var(--color-text-muted)' }}>
                        {t('sessions.usedOf', '{{used}} of {{total}} used', { used: r.used, total: r.total })}
                        {r.expires_at ? ` · ${fmtDate(r.expires_at)}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md flex-shrink-0"
                      style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
                      {r.expired ? t('sessions.tagExpired', 'Expired') : t('sessions.tagDone', 'Done')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
