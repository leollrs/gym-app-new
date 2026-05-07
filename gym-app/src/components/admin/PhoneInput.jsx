/**
 * PhoneInput — area-code dropdown + national-number input, single source of truth.
 *
 * Stores the *combined* E.164-style value as `value` (e.g. "+18095551234").
 * The dropdown defaults to +1 (Puerto Rico / US) so admins can just tap and type.
 * Admin can switch the area code at any time.
 *
 * Props:
 *   value           — current full phone number (with leading + and dial code), or ''
 *   onChange(next)  — fires with the new full string
 *   defaultDialCode — initial dial code if value is empty (default '+1')
 *   placeholder     — placeholder for the national-number input
 *   disabled        — disables both controls
 *   ariaLabel       — accessibility label for the national-number input
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Common dial codes for the LATAM/Caribbean market — extend as needed.
export const DIAL_CODES = [
  { code: '+1',   country: 'US / PR / DR' },
  { code: '+52',  country: 'México' },
  { code: '+34',  country: 'España' },
  { code: '+57',  country: 'Colombia' },
  { code: '+58',  country: 'Venezuela' },
  { code: '+54',  country: 'Argentina' },
  { code: '+56',  country: 'Chile' },
  { code: '+51',  country: 'Perú' },
  { code: '+593', country: 'Ecuador' },
  { code: '+591', country: 'Bolivia' },
  { code: '+595', country: 'Paraguay' },
  { code: '+598', country: 'Uruguay' },
  { code: '+506', country: 'Costa Rica' },
  { code: '+507', country: 'Panamá' },
  { code: '+503', country: 'El Salvador' },
  { code: '+502', country: 'Guatemala' },
  { code: '+504', country: 'Honduras' },
  { code: '+505', country: 'Nicaragua' },
  { code: '+44',  country: 'UK' },
  { code: '+33',  country: 'France' },
  { code: '+49',  country: 'Germany' },
  { code: '+39',  country: 'Italy' },
  { code: '+55',  country: 'Brasil' },
];

// Match the longest dial code that prefixes a given input.
function splitPhone(raw, defaultDialCode) {
  if (!raw) return { dial: defaultDialCode, national: '' };
  const v = String(raw).trim();
  if (!v.startsWith('+')) return { dial: defaultDialCode, national: v.replace(/^\+/, '') };
  const sorted = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length);
  const hit = sorted.find((d) => v.startsWith(d.code));
  if (hit) return { dial: hit.code, national: v.slice(hit.code.length).trim() };
  return { dial: defaultDialCode, national: v };
}

// Strip everything except digits, spaces, parens, and dashes from the national side.
function sanitizeNational(s) {
  return (s || '').replace(/[^\d\s().-]/g, '').trim();
}

export default function PhoneInput({
  value,
  onChange,
  defaultDialCode = '+1',
  placeholder = '',
  disabled = false,
  ariaLabel = 'Phone number',
  className = '',
  inputId,
}) {
  const [dial, setDial] = useState(() => splitPhone(value, defaultDialCode).dial);
  const [national, setNational] = useState(() => splitPhone(value, defaultDialCode).national);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Sync from controlled value if it changes externally.
  useEffect(() => {
    const next = splitPhone(value, defaultDialCode);
    setDial(next.dial);
    setNational(next.national);
  }, [value, defaultDialCode]);

  // Close dropdown on outside click / escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const emit = (nextDial, nextNational) => {
    const cleaned = sanitizeNational(nextNational);
    if (!cleaned) onChange?.('');
    else onChange?.(`${nextDial}${cleaned}`);
  };

  const handleDialPick = (code) => {
    setDial(code);
    setOpen(false);
    emit(code, national);
  };

  const handleNationalChange = (e) => {
    const v = sanitizeNational(e.target.value);
    setNational(v);
    emit(dial, v);
  };

  const baseInputStyle = {
    background: 'var(--color-bg-input, var(--color-bg-elevated))',
    border: '1px solid var(--color-border-subtle)',
    color: 'var(--color-text-primary)',
  };

  return (
    <div className={`flex items-stretch gap-2 ${className}`}>
      {/* Dial code selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-label="Country code"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="h-full flex items-center gap-1.5 px-3 rounded-xl text-[13px] font-mono font-semibold transition-colors disabled:opacity-50"
          style={baseInputStyle}
        >
          {dial}
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        {open && (
          <div
            role="listbox"
            // Anchored to the dial-code button. `left-0 right-auto` on mobile so the dropdown
            // grows downward into the available width; on small screens it spans the full row
            // (max-w-[calc(100vw-32px)]) so it never clips off the right edge of a 375px viewport.
            className="absolute left-0 right-auto top-full mt-1 w-[min(14rem,calc(100vw-32px))] max-h-64 overflow-y-auto rounded-xl shadow-2xl z-[140]"
            style={{
              background: 'var(--color-bg-card, #0F172A)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            {DIAL_CODES.map((d) => (
              <button
                key={d.code}
                type="button"
                role="option"
                aria-selected={dial === d.code}
                onClick={() => handleDialPick(d.code)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-white/5"
                style={{
                  color: dial === d.code ? 'var(--color-accent)' : 'var(--color-text-primary)',
                  fontWeight: dial === d.code ? 700 : 500,
                }}
              >
                <span className="font-mono w-12">{d.code}</span>
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{d.country}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* National number */}
      <input
        id={inputId}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={national}
        onChange={handleNationalChange}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
        style={baseInputStyle}
      />
    </div>
  );
}
