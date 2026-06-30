import { useMemo, useState, useEffect } from 'react';

/**
 * Date-of-birth picker built from three native <select> dropdowns
 * (month / day / year).
 *
 * Why not <input type="date">? On iOS/Android the native date calendar opens
 * on the *current* month with only prev/next-month arrows, so reaching a birth
 * year decades in the past means dozens of taps. Three dropdowns put the year
 * one tap away (a native wheel on mobile) and read far more clearly.
 *
 * Drop-in for a date input: `value` is an ISO 'YYYY-MM-DD' string (or '' while
 * incomplete) and `onChange` receives the same. Future dates beyond `maxDate`
 * are not selectable. The component holds its own partial state so the user can
 * build the date one field at a time — a single combined value can't represent
 * "month chosen, year not yet".
 */

const pad2 = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => (y && m ? new Date(y, m, 0).getDate() : 31); // m is 1-based

const parseISO = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : { y: '', mo: '', d: '' };
};
const toISO = (p) => (p.y && p.mo && p.d ? `${p.y}-${pad2(p.mo)}-${pad2(p.d)}` : '');

export default function DobPicker({
  value = '',
  onChange,
  lang = 'en',
  maxDate,            // Date — latest selectable day (defaults to today)
  minYear = 1920,
  labels = {},        // { month, day, year } placeholder strings
  hasError = false,
  colors = {},
  fonts = {},
  id,
}) {
  const c = {
    surface: '#ffffff',
    ink: '#0B0F12',
    mute: '#9A988E',
    line: 'rgba(11,15,18,0.10)',
    error: '#FF5A2E',
    ...colors,
  };
  const fontBody = fonts.body || 'system-ui, sans-serif';

  const max = maxDate instanceof Date && !Number.isNaN(maxDate.getTime()) ? maxDate : new Date();
  const maxYear = max.getFullYear();
  const maxMonth = max.getMonth() + 1; // 1-based
  const maxDay = max.getDate();

  // Internal partial selection. Seeded from the incoming ISO value, then driven
  // by the user one field at a time.
  const [parts, setParts] = useState(() => parseISO(value));

  // Re-seed when the parent value changes to something we didn't emit (e.g. an
  // external reset / prefill). Comparing against our own ISO avoids a loop.
  useEffect(() => {
    if ((value || '') !== toISO(parts)) setParts(parseISO(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const monthNames = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat(lang || 'en', { month: 'long' });
      return Array.from({ length: 12 }, (_, i) => {
        const name = fmt.format(new Date(2000, i, 1));
        return name.charAt(0).toUpperCase() + name.slice(1);
      });
    } catch {
      return ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    }
  }, [lang]);

  const years = useMemo(() => {
    const arr = [];
    for (let y = maxYear; y >= minYear; y--) arr.push(y);
    return arr;
  }, [maxYear, minYear]);

  const { y: vy, mo: vm, d: vd } = parts;

  // Cap selectable month/day so a future date can't be assembled.
  const monthCap = vy === maxYear ? maxMonth : 12;
  let dayCap = daysInMonth(vy, vm);
  if (vy === maxYear && vm === maxMonth) dayCap = Math.min(dayCap, maxDay);

  // Apply a field change, clamp to a real (non-future) date, store, and emit.
  const update = (patch) => {
    let { y, mo, d } = { ...parts, ...patch };
    if (y && mo && d) {
      if (y === maxYear && mo > maxMonth) mo = maxMonth; // no future month in the current year
      let dim = daysInMonth(y, mo);
      if (y === maxYear && mo === maxMonth) dim = Math.min(dim, maxDay);
      if (d > dim) d = dim; // clamp day to the month length / today
    }
    const next = { y, mo, d };
    setParts(next);
    if (onChange) onChange(toISO(next));
  };

  const selectStyle = (filled) => ({
    height: 52,
    background: c.surface,
    border: `1.5px solid ${hasError ? c.error : c.line}`,
    borderRadius: 14,
    padding: '0 10px',
    fontFamily: fontBody,
    fontSize: 15,
    color: filled ? c.ink : c.mute,
    outline: 'none',
    cursor: 'pointer',
    minWidth: 0,
    width: '100%',
  });

  return (
    <div id={id} style={{ display: 'flex', gap: 8 }}>
      <select
        aria-label={labels.month || 'Month'}
        value={vm === '' ? '' : String(vm)}
        onChange={(e) => update({ mo: e.target.value ? Number(e.target.value) : '' })}
        style={{ ...selectStyle(vm !== ''), flex: 1.5 }}
      >
        <option value="">{labels.month || 'Month'}</option>
        {monthNames.map((name, i) => (
          <option key={i + 1} value={i + 1} disabled={i + 1 > monthCap}>{name}</option>
        ))}
      </select>

      <select
        aria-label={labels.day || 'Day'}
        value={vd === '' ? '' : String(vd)}
        onChange={(e) => update({ d: e.target.value ? Number(e.target.value) : '' })}
        style={{ ...selectStyle(vd !== ''), flex: 0.85 }}
      >
        <option value="">{labels.day || 'Day'}</option>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d} disabled={d > dayCap}>{d}</option>
        ))}
      </select>

      <select
        aria-label={labels.year || 'Year'}
        value={vy === '' ? '' : String(vy)}
        onChange={(e) => update({ y: e.target.value ? Number(e.target.value) : '' })}
        style={{ ...selectStyle(vy !== ''), flex: 1.1 }}
      >
        <option value="">{labels.year || 'Year'}</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
