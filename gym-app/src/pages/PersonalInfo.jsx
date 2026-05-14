// PersonalInfo.jsx
// -----------------------------------------------------------------------------
// Single screen for the user's body identity data — sex, age, height, weight,
// units. Saves to:
//   • profiles.full_name (display)
//   • profiles.metric_units (units toggle)
//   • member_onboarding.sex / age / height_inches  (single source of truth
//     used by macro calculator + program generator + 1RM tier display)
//   • body_weight_logs  (one row per day — upserted on weight change, keeps
//     the historical chart in ProgressBody intact)
// -----------------------------------------------------------------------------

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, User, Ruler, Scale, Cake, Save, Check, Gift, Pencil, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

const SEX_OPTIONS = [
  { value: 'male', labelKey: 'personalInfo.sexMale', fallback: 'Male' },
  { value: 'female', labelKey: 'personalInfo.sexFemale', fallback: 'Female' },
];

// Matches App.jsx — 13+ for self-edit. Lower than 13 only happens via gym
// invite at signup; once in, the user can edit their DOB freely (the policy
// applies to signup, not to subsequent edits).
const AGE_VERIFY_MIN = 13;

// "2004-06-22" → "June 22, 2004" (locale-aware)
function formatDob(iso, lang) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  try {
    return new Intl.DateTimeFormat(lang || undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return iso;
  }
}

function computeAgeFromDob(iso) {
  if (!iso) return NaN;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NaN;
  const today = new Date();
  let a = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) a--;
  return a;
}

function Field({ icon: Icon, label, children }) {
  return (
    <div
      style={{
        background: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
        border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
        borderRadius: 18,
        padding: '14px 16px',
      }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <Icon size={14} style={{ color: 'var(--color-accent)' }} strokeWidth={2.4} />
        <p
          className="uppercase"
          style={{
            fontSize: 11, fontWeight: 800, letterSpacing: '0.14em',
            color: 'var(--color-text-muted)',
          }}
        >
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  background: 'transparent',
  border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
  borderRadius: 12,
  padding: '12px 14px',
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
  outline: 'none',
  fontFamily: FONT_DISPLAY,
  letterSpacing: -0.2,
};

export default function PersonalInfo() {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { user, profile, refreshProfile } = useAuth();
  const { showToast } = useToast();

  // Default to imperial when metric_units is undefined — matches the
  // fallback used in ActiveSession / CardioLogModal / LiveCardio.
  const initialMetric = profile?.metric_units === true;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [sex, setSex] = useState('');
  const [age, setAge] = useState('');
  const [dob, setDob] = useState(profile?.date_of_birth || ''); // ISO yyyy-mm-dd
  const [dobModalOpen, setDobModalOpen] = useState(false);
  const [metric, setMetric] = useState(initialMetric);
  const [heightCm, setHeightCm] = useState('');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [originalWeightLbs, setOriginalWeightLbs] = useState(null);

  useEffect(() => {
    document.title = t('personalInfo.title', 'Personal info');
  }, [t]);

  // Keep dob in sync with profile (it loads asynchronously after first render)
  useEffect(() => {
    setDob(profile?.date_of_birth || '');
  }, [profile?.date_of_birth]);

  // Hydrate from member_onboarding + latest body_weight_logs weight
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [obRes, weightRes] = await Promise.all([
          supabase
            .from('member_onboarding')
            .select('sex, age, height_inches')
            .eq('profile_id', user.id)
            .maybeSingle(),
          supabase
            .from('body_weight_logs')
            .select('weight_lbs, logged_at')
            .eq('profile_id', user.id)
            .order('logged_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (cancelled) return;

        const ob = obRes.data || {};
        setSex(ob.sex || '');
        setAge(ob.age != null ? String(ob.age) : '');

        const inches = ob.height_inches != null ? Number(ob.height_inches) : null;
        if (inches) {
          setHeightFt(String(Math.floor(inches / 12)));
          setHeightIn(String(inches % 12));
          setHeightCm(String(Math.round(inches * 2.54)));
        }

        const lbs = weightRes.data?.weight_lbs != null ? Number(weightRes.data.weight_lbs) : null;
        if (lbs) {
          setOriginalWeightLbs(lbs);
          setWeightLbs(lbs.toFixed(1).replace(/\.0$/, ''));
          setWeightKg((lbs / 2.20462).toFixed(1).replace(/\.0$/, ''));
        }
      } catch (err) {
        console.warn('[PersonalInfo] load failed', err?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Keep paired units in sync
  const onHeightCmChange = (v) => {
    setHeightCm(v);
    const cm = parseFloat(v);
    if (Number.isFinite(cm) && cm > 0) {
      const totalIn = Math.round(cm / 2.54);
      setHeightFt(String(Math.floor(totalIn / 12)));
      setHeightIn(String(totalIn % 12));
    }
  };
  const onHeightImpChange = (ft, inch) => {
    setHeightFt(ft);
    setHeightIn(inch);
    const ftN = parseInt(ft || 0, 10) || 0;
    const inN = parseInt(inch || 0, 10) || 0;
    if (ftN > 0 || inN > 0) {
      const total = ftN * 12 + inN;
      setHeightCm(String(Math.round(total * 2.54)));
    }
  };
  const onWeightKgChange = (v) => {
    setWeightKg(v);
    const kg = parseFloat(v);
    if (Number.isFinite(kg) && kg > 0) {
      setWeightLbs((kg * 2.20462).toFixed(1).replace(/\.0$/, ''));
    }
  };
  const onWeightLbsChange = (v) => {
    setWeightLbs(v);
    const lbs = parseFloat(v);
    if (Number.isFinite(lbs) && lbs > 0) {
      setWeightKg((lbs / 2.20462).toFixed(1).replace(/\.0$/, ''));
    }
  };

  const heightInches = useMemo(() => {
    const ftN = parseInt(heightFt || 0, 10) || 0;
    const inN = parseInt(heightIn || 0, 10) || 0;
    return ftN * 12 + inN;
  }, [heightFt, heightIn]);

  async function handleSave() {
    if (!user?.id) return;
    setSaving(true);
    try {
      // 1) Identity + units + dob to profiles
      const profilePatch = {
        full_name: fullName.trim() || profile?.full_name || null,
        metric_units: metric,
      };
      if (dob && dob !== profile?.date_of_birth) {
        profilePatch.date_of_birth = dob;
      }
      const profileRes = await supabase.from('profiles').update(profilePatch).eq('id', user.id);
      if (profileRes.error) throw profileRes.error;

      // 2) Body identity to member_onboarding (upsert in case row missing).
      // gym_id is NOT NULL — must be sent or the insert path 23502-errors
      // for users whose onboarding row was never created.
      const ageN = parseInt(age, 10);
      const obRes = await supabase.from('member_onboarding').upsert({
        profile_id: user.id,
        gym_id: profile?.gym_id || null,
        sex: sex || null,
        age: Number.isFinite(ageN) ? ageN : null,
        height_inches: heightInches > 0 ? heightInches : null,
      }, { onConflict: 'profile_id' });
      if (obRes.error) throw obRes.error;

      // 3) Weight log entry, ONLY when value changed (don't spam history).
      // body_weight_logs is one-row-per-day (UNIQUE profile_id, logged_at) —
      // upsert so re-saving the same day overwrites instead of 23505-erroring.
      const lbsN = parseFloat(weightLbs);
      if (Number.isFinite(lbsN) && lbsN > 0 && lbsN !== originalWeightLbs && profile?.gym_id) {
        const today = new Date().toISOString().slice(0, 10);
        const weightRes = await supabase.from('body_weight_logs').upsert({
          profile_id: user.id,
          gym_id: profile.gym_id,
          weight_lbs: lbsN,
          logged_at: today,
        }, { onConflict: 'profile_id,logged_at' });
        if (weightRes.error) throw weightRes.error;
        setOriginalWeightLbs(lbsN);
      }

      showToast(t('personalInfo.saved', 'Saved'), 'success');
      try { await refreshProfile?.(); } catch {}
    } catch (err) {
      showToast(err.message || t('personalInfo.saveFailed', 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="min-h-screen pb-28 md:pb-12"
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        fontFamily: FONT_BODY,
      }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-30 backdrop-blur-2xl"
        style={{
          background: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)',
          borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
        }}
      >
        <div className="max-w-[480px] mx-auto flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('common:back', 'Back')}
            className="flex items-center justify-center transition-transform active:scale-90"
            style={{
              width: 40, height: 40, borderRadius: 20,
              background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
              color: 'var(--color-text-primary)',
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p
              className="uppercase"
              style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '0.16em',
                color: 'var(--color-accent)',
              }}
            >
              {t('settings.account', 'Account')}
            </p>
            <h1
              className="truncate"
              style={{
                fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 900,
                letterSpacing: -0.4, color: 'var(--color-text-primary)',
                lineHeight: 1.1,
              }}
            >
              {t('personalInfo.title', 'Personal info')}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-[480px] mx-auto px-4 pt-5 space-y-3">
        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
            {t('personalInfo.loading', 'Loading\u2026')}
          </div>
        ) : (
          <>
            <Field icon={User} label={t('personalInfo.identity', 'Identity')}>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t('personalInfo.fullName', 'Full name')}
                style={inputStyle}
              />
              <div className="mt-3 flex gap-2">
                {SEX_OPTIONS.map((opt) => {
                  const sel = sex === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSex(opt.value)}
                      className="flex-1 active:scale-[0.97] transition-transform"
                      style={{
                        padding: '11px 8px', borderRadius: 12,
                        background: sel
                          ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                          : 'transparent',
                        border: sel
                          ? '1.5px solid color-mix(in srgb, var(--color-accent) 50%, transparent)'
                          : '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
                        color: sel ? 'var(--color-accent)' : 'var(--color-text-primary)',
                        fontWeight: 800, fontSize: 13,
                      }}
                    >
                      {t(opt.labelKey, opt.fallback)}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field icon={Cake} label={t('personalInfo.age', 'Age')}>
              <input
                type="number"
                inputMode="numeric"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="—"
                min="13"
                max="100"
                style={{ ...inputStyle, fontSize: 18 }}
              />
            </Field>

            <Field icon={Gift} label={t('personalInfo.dob', 'Date of birth')}>
              <div className="flex items-center justify-between gap-3">
                <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: FONT_DISPLAY, letterSpacing: -0.2 }}>
                  {dob ? formatDob(dob, profile?.preferred_language) : '—'}
                </p>
                <button
                  type="button"
                  onClick={() => setDobModalOpen(true)}
                  className="active:scale-95 transition-transform"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 999,
                    background: 'transparent',
                    border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
                    color: 'var(--color-text-primary)',
                    fontSize: 12, fontWeight: 800, letterSpacing: 0.3,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Pencil size={12} />
                  {t('personalInfo.edit', 'Edit')}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, fontWeight: 600 }}>
                {t('personalInfo.dobHint', 'Used for age verification and to celebrate your birthday 🎂.')}
              </p>
            </Field>

            {/* Units toggle */}
            <div
              className="flex items-center justify-between"
              style={{
                background: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
                borderRadius: 18,
                padding: '12px 16px',
              }}
            >
              <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                {t('personalInfo.units', 'Units')}
              </p>
              <div className="flex" style={{ borderRadius: 999, background: 'rgba(0,0,0,0.18)', padding: 3 }}>
                {[
                  { value: true, label: t('personalInfo.metric', 'kg / cm') },
                  { value: false, label: t('personalInfo.imperial', 'lb / ft') },
                ].map((opt) => {
                  const sel = metric === opt.value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setMetric(opt.value)}
                      style={{
                        padding: '6px 14px', borderRadius: 999,
                        background: sel ? 'var(--color-accent)' : 'transparent',
                        color: sel ? 'var(--color-bg-card, #0A0D10)' : 'var(--color-text-muted)',
                        fontWeight: 800, fontSize: 12, letterSpacing: 0.3,
                        border: 'none',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Field icon={Ruler} label={t('personalInfo.height', 'Height')}>
              {metric ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={heightCm}
                    onChange={(e) => onHeightCmChange(e.target.value)}
                    placeholder="—"
                    style={{ ...inputStyle, fontSize: 18 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-muted)', minWidth: 28 }}>cm</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={heightFt}
                    onChange={(e) => onHeightImpChange(e.target.value, heightIn)}
                    placeholder="ft"
                    style={{ ...inputStyle, fontSize: 18 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-muted)' }}>ft</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={heightIn}
                    onChange={(e) => onHeightImpChange(heightFt, e.target.value)}
                    placeholder="in"
                    style={{ ...inputStyle, fontSize: 18 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-muted)' }}>in</span>
                </div>
              )}
            </Field>

            <Field icon={Scale} label={t('personalInfo.weight', 'Weight')}>
              {metric ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={weightKg}
                    onChange={(e) => onWeightKgChange(e.target.value)}
                    placeholder="—"
                    style={{ ...inputStyle, fontSize: 18 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-muted)', minWidth: 28 }}>kg</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={weightLbs}
                    onChange={(e) => onWeightLbsChange(e.target.value)}
                    placeholder="—"
                    style={{ ...inputStyle, fontSize: 18 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-muted)', minWidth: 28 }}>lb</span>
                </div>
              )}
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, fontWeight: 600 }}>
                {t('personalInfo.weightHint', 'Saving a new weight adds an entry to your weight history.')}
              </p>
            </Field>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
              style={{
                marginTop: 8,
                padding: '15px 20px',
                borderRadius: 999,
                background: 'var(--color-accent)',
                color: 'var(--color-bg-card, #0A0D10)',
                fontFamily: FONT_DISPLAY,
                fontWeight: 900, fontSize: 14, letterSpacing: 0.4,
                border: 'none',
                boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent) 35%, transparent)',
              }}
            >
              {saving ? <Save size={16} className="animate-pulse" /> : <Check size={16} strokeWidth={3} />}
              {saving ? t('personalInfo.saving', 'Saving\u2026') : t('personalInfo.save', 'Save changes')}
            </button>
          </>
        )}
      </div>

      {dobModalOpen && (
        <DobEditModal
          initialDob={dob}
          lang={profile?.preferred_language}
          onClose={() => setDobModalOpen(false)}
          onSave={(newDob) => {
            setDob(newDob);
            // Sync displayed age with the new DOB so the user sees the change
            // immediately; the next handleSave persists both fields.
            const a = computeAgeFromDob(newDob);
            if (Number.isFinite(a) && a > 0) setAge(String(a));
            setDobModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// \u2500\u2500 DOB edit modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Three independent month/day/year selects (same pattern as the age-verify
// gate in App.jsx) \u2014 sidesteps iOS WKWebView's flaky <input type="date">.
function DobEditModal({ initialDob, lang, onClose, onSave }) {
  const { t } = useTranslation('pages');

  const [iy, im, id] = (initialDob || '').split('-').map((s) => s || '');
  const [month, setMonth] = useState(im ? String(Number(im)) : '');
  const [day, setDay] = useState(id ? String(Number(id)) : '');
  const [year, setYear] = useState(iy || '');
  const [err, setErr] = useState('');

  const dob = useMemo(() => {
    if (!month || !day || !year) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }, [month, day, year]);

  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const arr = [];
    for (let y = currentYear; y >= currentYear - 110; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  const monthOptions = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang || undefined, { month: 'long' });
    return Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: fmt.format(new Date(2000, i, 1)),
    }));
  }, [lang]);

  const daysInMonth = useMemo(() => {
    if (!month || !year) return 31;
    return new Date(Number(year), Number(month), 0).getDate();
  }, [month, year]);

  const dayOptions = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => i + 1),
    [daysInMonth],
  );

  const handleConfirm = () => {
    setErr('');
    if (!dob) {
      setErr(t('ageVerify.required', { defaultValue: 'Date of birth is required.' }));
      return;
    }
    const age = computeAgeFromDob(dob);
    if (!Number.isFinite(age) || age < 0) {
      setErr(t('ageVerify.invalid', { defaultValue: 'Please enter a valid date.' }));
      return;
    }
    if (age < AGE_VERIFY_MIN) {
      setErr(t('ageVerify.tooYoung', { defaultValue: `You must be ${AGE_VERIFY_MIN} or older to use TuGymPR.`, min: AGE_VERIFY_MIN }));
      return;
    }
    onSave(dob);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-[420px]"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-card, #0A0D10)',
          border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
          borderRadius: 22,
          padding: 22,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 900, color: 'var(--color-text-primary)' }}>
            {t('personalInfo.dob', 'Date of birth')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:close', 'Close')}
            className="active:scale-90"
            style={{
              width: 32, height: 32, borderRadius: 16,
              background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
              color: 'var(--color-text-primary)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <select
            value={month}
            onChange={(e) => { setMonth(e.target.value); setErr(''); }}
            className="block w-full min-w-0 rounded-xl px-3 py-3 text-[14px] text-left focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--color-text-primary)' }}
          >
            <option value="">{t('ageVerify.month', { defaultValue: 'Month' })}</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <select
            value={day}
            onChange={(e) => { setDay(e.target.value); setErr(''); }}
            className="block w-full min-w-0 rounded-xl px-3 py-3 text-[14px] text-left focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--color-text-primary)' }}
          >
            <option value="">{t('ageVerify.day', { defaultValue: 'Day' })}</option>
            {dayOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => { setYear(e.target.value); setErr(''); }}
            className="block w-full min-w-0 rounded-xl px-3 py-3 text-[14px] text-left focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--color-text-primary)' }}
          >
            <option value="">{t('ageVerify.year', { defaultValue: 'Year' })}</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {err && (
          <p style={{ fontSize: 12.5, color: '#F87171', marginBottom: 10, fontWeight: 600 }}>
            {err}
          </p>
        )}

        <button
          type="button"
          onClick={handleConfirm}
          className="w-full active:scale-[0.98] transition-transform"
          style={{
            marginTop: 4,
            padding: '13px 18px',
            borderRadius: 999,
            background: 'var(--color-accent)',
            color: 'var(--color-bg-card, #0A0D10)',
            fontFamily: FONT_DISPLAY,
            fontWeight: 900, fontSize: 13, letterSpacing: 0.3,
            border: 'none',
          }}
        >
          {t('personalInfo.dobConfirm', { defaultValue: 'Save' })}
        </button>
      </div>
    </div>
  );
}
