import { useEffect, useState, useCallback } from 'react';
import { CalendarClock, Check, Plus, X, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { TT, TFont } from './designTokens';

const DOWS = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun for display
const DURATIONS = [30, 45, 60, 90];

// Per-client weekly recurring schedule. Trainer picks days, then either one
// shared time for all days OR per-day time/duration — with support for
// MULTIPLE slots on the same day ("+ add time"); get_client_schedule can
// legitimately return 2+ slots per day and set_client_schedule accepts them.
// Saving (set_client_schedule) materializes the next 8 weeks of sessions.
// SAFETY: if the load fails we show an error + Retry and NEVER render the
// editable-empty editor — saving from that state would wipe the client's
// real schedule.
export default function TrainerClientSchedule({ clientId }) {
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const [days, setDays] = useState(() => new Set());
  const [sameTime, setSameTime] = useState(true);
  const [sharedTime, setSharedTime] = useState('09:00');
  const [sharedDuration, setSharedDuration] = useState(60);
  const [dayConfig, setDayConfig] = useState({}); // { [dow]: [{ time, duration }, …] }
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoaded(false);
    setLoadError(false);
    try {
      const { data, error } = await supabase.rpc('get_client_schedule', { p_client_id: clientId });
      if (error) throw error;
      const slots = Array.isArray(data) ? data : [];
      if (slots.length > 0) {
        setDays(new Set(slots.map(s => s.day_of_week)));
        const cfg = {};
        slots.forEach(s => {
          const row = { time: (s.start_time || '09:00').slice(0, 5), duration: s.duration_mins || 60 };
          if (!cfg[s.day_of_week]) cfg[s.day_of_week] = [];
          cfg[s.day_of_week].push(row);
        });
        Object.values(cfg).forEach(rows => rows.sort((a, b) => a.time.localeCompare(b.time)));
        setDayConfig(cfg);
        const first = slots[0];
        const ft = (first.start_time || '09:00').slice(0, 5);
        const fd = first.duration_mins || 60;
        const multi = Object.values(cfg).some(rows => rows.length > 1);
        const allSame = !multi && slots.every(s => (s.start_time || '').slice(0, 5) === ft && (s.duration_mins || 60) === fd);
        setSameTime(allSame);
        setSharedTime(ft);
        setSharedDuration(fd);
      }
    } catch (e) {
      logger.error('TrainerClientSchedule load failed', e);
      setLoadError(true);
    } finally { setLoaded(true); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const toggleDay = (d) => setDays(prev => {
    const next = new Set(prev);
    if (next.has(d)) { next.delete(d); }
    else {
      next.add(d);
      setDayConfig(cfg => cfg[d]?.length ? cfg : { ...cfg, [d]: [{ time: sharedTime, duration: sharedDuration }] });
    }
    return next;
  });

  const setSlot = (d, idx, patch) => setDayConfig(cfg => {
    const rows = cfg[d] ? [...cfg[d]] : [{ time: sharedTime, duration: sharedDuration }];
    rows[idx] = { ...(rows[idx] || { time: sharedTime, duration: sharedDuration }), ...patch };
    return { ...cfg, [d]: rows };
  });

  const addSlot = (d) => setDayConfig(cfg => {
    const rows = cfg[d] ? [...cfg[d]] : [];
    const last = rows[rows.length - 1];
    // Suggest one hour after the day's last slot.
    let time = sharedTime;
    if (last?.time) {
      const [hh, mm] = last.time.split(':').map(Number);
      time = `${String(Math.min(23, (hh || 0) + 1)).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}`;
    }
    rows.push({ time, duration: last?.duration || sharedDuration });
    return { ...cfg, [d]: rows };
  });

  const removeSlot = (d, idx) => {
    setDayConfig(cfg => {
      const rows = (cfg[d] || []).filter((_, i) => i !== idx);
      const next = { ...cfg, [d]: rows };
      if (rows.length === 0) {
        delete next[d];
        setDays(prev => { const n = new Set(prev); n.delete(d); return n; });
      }
      return next;
    });
  };

  // When switching to per-day, seed each selected day's rows from the shared values.
  const enablePerDay = () => {
    setDayConfig(cfg => {
      const next = { ...cfg };
      [...days].forEach(d => { if (!next[d]?.length) next[d] = [{ time: sharedTime, duration: sharedDuration }]; });
      return next;
    });
    setSameTime(false);
  };

  const dowLabel = (d) => format(new Date(2024, 0, 7 + d), 'EEEEE', { locale: dateFnsLocale }); // narrow
  const dowShort = (d) => format(new Date(2024, 0, 7 + d), 'EEE', { locale: dateFnsLocale });   // short

  const save = async () => {
    if (busy || loadError) return; // never save over an unknown server state
    setBusy(true);
    try {
      const sorted = DOWS.filter(d => days.has(d));
      let slots;
      if (sameTime) {
        slots = sorted.map(d => ({ day_of_week: d, start_time: sharedTime, duration_mins: sharedDuration }));
      } else {
        slots = sorted.flatMap(d => {
          const rows = dayConfig[d]?.length ? dayConfig[d] : [{ time: sharedTime, duration: sharedDuration }];
          return rows.map(r => ({ day_of_week: d, start_time: r.time || sharedTime, duration_mins: r.duration || 60 }));
        });
        // The DB template is UNIQUE on (day, time) — drop duplicate rows quietly.
        const seen = new Set();
        slots = slots.filter(s => {
          const k = `${s.day_of_week}|${s.start_time}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
      const { error } = await supabase.rpc('set_client_schedule', { p_client_id: clientId, p_slots: slots });
      if (error) throw error;
      showToast(slots.length === 0 ? t('trainerSchedule.cleared', 'Schedule cleared') : t('trainerSchedule.saved', 'Schedule saved'), 'success');
    } catch (e) {
      logger.error('TrainerClientSchedule save failed', e);
      showToast(t('trainerSchedule.error', 'Could not save schedule'), 'error');
    } finally { setBusy(false); }
  };

  if (!loaded) return null;

  // Failed load → error card + Retry. No editor, no Save (saving an empty
  // editor over a load failure would wipe the client's real schedule).
  if (loadError) {
    return (
      <>
        <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, marginBottom: 11 }}>
          {t('trainerSchedule.title', 'Weekly schedule')}
        </div>
        <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, padding: 18, marginBottom: 22, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, marginBottom: 4 }}>
            {t('trainerSchedule.loadError', "Couldn't load the schedule")}
          </div>
          <div style={{ fontSize: 12, color: TT.textSub, marginBottom: 12 }}>
            {t('trainerSchedule.loadErrorHint', 'Editing is disabled so the saved schedule isn’t overwritten. Check your connection and try again.')}
          </div>
          <button type="button" onClick={load} className="tt-btn tt-btn--secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 11, fontFamily: TFont.display, fontWeight: 700, fontSize: 12.5 }}>
            <RefreshCw size={13} strokeWidth={2.4} /> {t('trainerSchedule.retry', 'Retry')}
          </button>
        </div>
      </>
    );
  }

  const perWeek = DOWS.filter(d => days.has(d))
    .reduce((sum, d) => sum + (sameTime ? 1 : Math.max(1, dayConfig[d]?.length || 1)), 0);
  const sortedDays = DOWS.filter(d => days.has(d));

  const durationSelect = (value, onChange) => (
    <select value={value} onChange={e => onChange(Number(e.target.value))}
      style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 12.5, fontWeight: 700, outline: 'none', cursor: 'pointer' }}>
      {DURATIONS.map(d => <option key={d} value={d}>{t('trainerSchedule.minutes', '{{n}} min', { n: d })}</option>)}
    </select>
  );

  return (
    <>
      <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, marginBottom: 11 }}>
        {t('trainerSchedule.title', 'Weekly schedule')}
      </div>
      <div style={{ background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 'var(--tt-card-radius, 20px)', boxShadow: TT.shadow, padding: 16, marginBottom: 22 }}>
        {/* Day pills */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
          {DOWS.map(d => {
            const on = days.has(d);
            return (
              <button key={d} onClick={() => toggleDay(d)} aria-pressed={on} className="tt-tap"
                style={{ flex: 1, height: 38, borderRadius: 11, fontFamily: TFont.display, fontSize: 13, fontWeight: 800, textTransform: 'uppercase', cursor: 'pointer',
                  border: on ? 'none' : `1px solid ${TT.border}`,
                  background: on ? 'linear-gradient(180deg,#27B0A0,#178C7E)' : TT.surface2,
                  color: on ? '#fff' : TT.textMute,
                  boxShadow: on ? '0 4px 10px -3px rgba(10,90,82,.5), inset 0 1px 0 rgba(255,255,255,.28)' : 'inset 0 0 0 1px var(--tt-border)' }}>
                {dowLabel(d)}
              </button>
            );
          })}
        </div>

        {/* Same-time toggle */}
        {perWeek > 0 && (
          <button
            type="button"
            onClick={() => (sameTime ? enablePerDay() : setSameTime(true))}
            aria-pressed={!sameTime}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, padding: '4px 2px', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.text }}>{t('trainerSchedule.sameTime', 'Same time every day')}</span>
            <span style={{ width: 40, height: 23, borderRadius: 999, background: sameTime ? TT.accent : TT.surface2, border: sameTime ? 'none' : `1px solid ${TT.border}`, position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}>
              <span style={{ position: 'absolute', top: 2, left: sameTime ? 19 : 2, width: 19, height: 19, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.15s' }} />
            </span>
          </button>
        )}

        {/* Shared time + duration */}
        {sameTime && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.7, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>{t('trainerSchedule.time', 'Time')}</div>
              <input type="time" value={sharedTime} onChange={e => setSharedTime(e.target.value)}
                style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 11, border: 'none', boxShadow: 'inset 0 0 0 1px var(--tt-border)', background: TT.surface2, color: TT.text, fontSize: 14, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
            </div>
            <div style={{ flex: 1.4 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.7, color: TT.textMute, textTransform: 'uppercase', marginBottom: 6 }}>{t('trainerSchedule.duration', 'Duration')}</div>
              <div style={{ display: 'flex', gap: 5 }}>
                {DURATIONS.map(d => {
                  const on = sharedDuration === d;
                  return (
                    <button key={d} onClick={() => setSharedDuration(d)} className="tt-tap"
                      style={{ flex: 1, height: 40, borderRadius: 10, fontFamily: TFont.display, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                        border: 'none',
                        background: on ? TT.text : TT.surface2, color: on ? TT.bg : TT.textMute,
                        boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--tt-border)' }}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Per-day time rows — each day supports multiple slots */}
        {!sameTime && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {sortedDays.map(d => {
              const rows = dayConfig[d]?.length ? dayConfig[d] : [{ time: sharedTime, duration: sharedDuration }];
              return (
                <div key={d}>
                  {rows.map((row, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: idx > 0 ? 6 : 0 }}>
                      <span style={{ width: 46, flexShrink: 0, fontSize: 12.5, fontWeight: 800, color: idx === 0 ? TT.text : 'transparent', textTransform: 'capitalize', userSelect: 'none' }}>{dowShort(d)}</span>
                      <input type="time" value={row.time || sharedTime} onChange={e => setSlot(d, idx, { time: e.target.value })}
                        style={{ flex: 1, minWidth: 0, padding: '8px 11px', borderRadius: 10, border: `1px solid ${TT.border}`, background: TT.surface2, color: TT.text, fontSize: 13.5, fontFamily: TFont.display, fontWeight: 700, outline: 'none' }} />
                      {durationSelect(row.duration || 60, (v) => setSlot(d, idx, { duration: v }))}
                      <button type="button" onClick={() => removeSlot(d, idx)}
                        aria-label={t('trainerSchedule.removeSlot', 'Remove time')}
                        style={{ width: 30, height: 30, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 9, border: 'none', background: 'transparent', color: TT.textMute, cursor: 'pointer' }}>
                        <X size={14} strokeWidth={2.4} />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addSlot(d)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 5, marginLeft: 54, padding: '4px 9px', borderRadius: 999, border: 'none', background: 'transparent', color: TT.accent, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                    <Plus size={12} strokeWidth={2.6} /> {t('trainerSchedule.addSlot', 'Add another time')}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary + save */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 11.5, color: TT.textSub }}>
          <CalendarClock size={14} style={{ color: TT.accent }} />
          {perWeek > 0
            ? t('trainerSchedule.perWeek', '{{count}} sessions/week · auto-booked 8 weeks out', { count: perWeek })
            : t('trainerSchedule.none', 'No sessions scheduled')}
        </div>
        <button onClick={save} disabled={busy || loadError}
          className="tt-btn tt-btn--primary"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, borderRadius: 12, fontFamily: TFont.display, fontWeight: 800, fontSize: 13, opacity: (busy || loadError) ? 0.5 : 1 }}>
          <Check size={15} strokeWidth={2.4} /> {t('trainerSchedule.saveSchedule', 'Save schedule')}
        </button>
      </div>
    </>
  );
}
