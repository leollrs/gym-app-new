import { useEffect, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, startOfMonth, endOfMonth, addMonths, getDay, getDaysInMonth, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { TT, TFont } from './designTokens';

// Trainer view of a client's attendance: a month calendar where days the client
// trained WITH this trainer (completed session) and days they trained on their
// own (check-in / logged workout) are color-coded differently.
export default function TrainerClientAttendance({ clientId }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [withTrainer, setWithTrainer] = useState(() => new Set());
  const [alone, setAlone] = useState(() => new Set());
  const [loading, setLoading] = useState(true);

  const fmtKey = (d) => format(d, 'yyyy-MM-dd');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = fmtKey(startOfMonth(viewMonth));
      const to = fmtKey(endOfMonth(viewMonth));
      const { data, error } = await supabase.rpc('get_client_attendance', { p_client_id: clientId, p_from: from, p_to: to });
      if (error) throw error;
      const wt = new Set(), al = new Set();
      (Array.isArray(data) ? data : []).forEach(r => {
        if (r.with_trainer) wt.add(r.day); else al.add(r.day);
      });
      setWithTrainer(wt); setAlone(al);
    } catch (e) { logger.error('TrainerClientAttendance load failed', e); setWithTrainer(new Set()); setAlone(new Set()); }
    finally { setLoading(false); }
  }, [clientId, viewMonth]);

  useEffect(() => { load(); }, [load]);

  const cells = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const lead = (getDay(first) + 6) % 7; // Monday-start offset
    const total = getDaysInMonth(viewMonth);
    const out = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= total; d++) out.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    return out;
  }, [viewMonth]);

  const weekdayLabels = useMemo(() =>
    [1, 2, 3, 4, 5, 6, 0].map(d => format(new Date(2024, 0, 7 + d), 'EEEEE', { locale: dateFnsLocale })), [dateFnsLocale]);

  const withCount = withTrainer.size;
  const totalDays = withTrainer.size + alone.size;
  const today = new Date();
  const atCurrentMonth = startOfMonth(new Date()).getTime() <= viewMonth.getTime();

  // "Self" cells use the design's translucent purple wash. In dark mode bump the
  // alpha (so the fill reads on a dark surface) and lighten the number color.
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const selfBg = isDark ? 'rgba(140,126,235,.30)' : 'rgba(122,107,224,.18)';
  const selfFg = isDark ? '#C8BEFF' : '#5B4FB8';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
        <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
          {t('trainerAttendance.title', 'Attendance')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setViewMonth(m => addMonths(m, -1))} aria-label={t('trainerPayments.prev', 'Previous')}
            style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: TT.text, cursor: 'pointer' }}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.text, minWidth: 92, textAlign: 'center', textTransform: 'capitalize' }}>
            {format(viewMonth, 'MMMM yyyy', { locale: dateFnsLocale })}
          </span>
          <button onClick={() => setViewMonth(m => addMonths(m, 1))} disabled={atCurrentMonth} aria-label={t('trainerPayments.next', 'Next')}
            style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: atCurrentMonth ? TT.textMute : TT.text, cursor: atCurrentMonth ? 'not-allowed' : 'pointer', opacity: atCurrentMonth ? 0.4 : 1 }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, padding: 14, marginBottom: 22, opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
        {/* Weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 6 }}>
          {weekdayLabels.map((w, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: TT.textMute, textTransform: 'uppercase' }}>{w}</div>
          ))}
        </div>
        {/* Day grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const key = fmtKey(d);
            const isWith = withTrainer.has(key);
            const isAlone = alone.has(key);
            const isToday = isSameDay(d, today);
            const bg = isWith ? 'linear-gradient(180deg,#27B0A0,#178C7E)' : isAlone ? selfBg : 'transparent';
            const fg = isWith ? '#fff' : isAlone ? selfFg : TT.textSub;
            return (
              <div key={i} style={{
                aspectRatio: '1', display: 'grid', placeItems: 'center', borderRadius: 9,
                background: bg, color: fg,
                fontFamily: TFont.display, fontSize: 12, fontWeight: (isWith || isAlone) ? 800 : 600,
                boxShadow: isWith ? '0 3px 8px -3px rgba(10,90,82,.45), inset 0 1px 0 rgba(255,255,255,.25)' : isToday ? `inset 0 0 0 2px ${TT.text}` : 'none',
              }}>
                {d.getDate()}
              </div>
            );
          })}
        </div>

        {/* Legend + summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${TT.border}`, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: TT.textSub, fontWeight: 700 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: '#178C7E' }} /> {t('trainerAttendance.withYou', 'With you')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: TT.textSub, fontWeight: 700 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: 'rgba(122,107,224,.5)' }} /> {t('trainerAttendance.alone', 'On their own')}
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: TFont.display, fontSize: 11.5, fontWeight: 800, color: TT.text }}>
            {t('trainerAttendance.summary', '{{total}} days · {{withYou}} with you', { total: totalDays, withYou: withCount })}
          </span>
        </div>
      </div>
    </>
  );
}
