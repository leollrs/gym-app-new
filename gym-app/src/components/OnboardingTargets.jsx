import { useState, useMemo } from 'react';
import { X, Check, Dumbbell, Scale, Percent, Target as TargetIcon } from 'lucide-react';
import { realisticBand, BANDS, DEFAULT_BAND } from '../lib/goalRealism';
import { detectConflicts } from '../lib/onboardingGoals';

/**
 * OnboardingTargets — the "Your Targets" capture sheet (Onboarding v2).
 *
 * A skippable overlay opened from the Primary-Goal step. Lets a member pick what
 * matters ("pick what matters to you"): muscle emphasis, target body weight,
 * body-fat %, and target lifts. Emits a `selections` object consumed by
 * buildOnboardingGoals()/persistOnboardingGoals() at handleFinish — which create
 * real member_goals + set priority_muscles and feed generateProgram(). Rendered
 * only when the onboarding_targets flag is on (fail-closed), so it is fully
 * additive to the existing step flow (no step renumbering).
 *
 * Pure presentational + local state; theme-aware via the app's CSS variables.
 */

const MUSCLE_OPTIONS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core'];
const KEY_LIFTS = [
  { id: 'ex_bp',  key: 'bench' },
  { id: 'ex_sq',  key: 'squat' },
  { id: 'ex_dl',  key: 'deadlift' },
  { id: 'ex_ohp', key: 'ohp' },
];
const LIFT_LABEL = { bench: 'Bench Press', squat: 'Back Squat', deadlift: 'Deadlift', ohp: 'Overhead Press' };

const fmtDate = (iso) => {
  if (!iso) return null;
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch { return null; }
};

// A pace-band selector that previews the realistic date for the entered gap.
function BandPicker({ goalType, current, target, exerciseName, fitnessLevel, value, onChange, t }) {
  const bands = useMemo(() => {
    const c = parseFloat(current), tg = parseFloat(target);
    if (!Number.isFinite(c) || !Number.isFinite(tg) || c === tg) return null;
    return realisticBand({ goalType, gap: tg - c, fitnessLevel, exerciseName });
  }, [goalType, current, target, exerciseName, fitnessLevel]);
  if (!bands) return null;
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {BANDS.map((b) => {
        const active = value === b;
        const date = fmtDate(bands[b]?.date);
        return (
          <button
            key={b}
            type="button"
            onClick={() => onChange(b)}
            style={{
              flex: 1, padding: '7px 4px', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
              background: active ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'transparent',
              color: 'var(--color-text-primary)', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
              {t(`onboardingTargets.band.${b}`, b)}
            </div>
            {date && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>{date}</div>}
          </button>
        );
      })}
    </div>
  );
}

function NumField({ label, value, onChange, placeholder, suffix }) {
  return (
    <label style={{ flex: 1, display: 'block' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 3 }}>
        <input
          type="number" inputMode="numeric" min="0" value={value} placeholder={placeholder || '—'}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%', padding: '9px 11px', borderRadius: 10, fontSize: 15, fontWeight: 600,
            background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-primary)', outline: 'none',
          }}
        />
        {suffix && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{suffix}</span>}
      </div>
    </label>
  );
}

function SectionCard({ icon: Icon, title, sub, children }) {
  return (
    <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 16, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: children ? 12 : 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}>
          <Icon size={17} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>{title}</div>
          {sub && <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function OnboardingTargets({ initial, context = {}, onSave, onClose, t }) {
  const tt = t || ((k, d) => d || k);
  const { fitnessLevel = 'intermediate', onboardingWeightLbs, primaryGoal, liftBaselines = {} } = context;

  const [muscles, setMuscles] = useState(initial?.priorityMuscles || []);
  const [bw, setBw] = useState(initial?.bodyWeight || { current: onboardingWeightLbs ? String(onboardingWeightLbs) : '', target: '', band: DEFAULT_BAND });
  const [bf, setBf] = useState(initial?.bodyFat || { current: '', target: '', band: DEFAULT_BAND });
  const [lifts, setLifts] = useState(() => {
    const seed = {};
    for (const l of KEY_LIFTS) {
      const prev = (initial?.lifts || []).find((x) => x.exerciseId === l.id);
      seed[l.id] = prev || { current: liftBaselines[l.id] ? String(liftBaselines[l.id]) : '', target: '', band: DEFAULT_BAND };
    }
    return seed;
  });

  const toggleMuscle = (m) => setMuscles((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const selections = useMemo(() => ({
    priorityMuscles: muscles,
    bodyWeight: (bw.current || bw.target) ? bw : null,
    bodyFat: (bf.current || bf.target) ? bf : null,
    lifts: KEY_LIFTS
      .filter((l) => lifts[l.id]?.target)
      .map((l) => ({ exerciseId: l.id, exerciseName: LIFT_LABEL[l.key], ...lifts[l.id] })),
  }), [muscles, bw, bf, lifts]);

  const conflicts = useMemo(() => detectConflicts(selections, { primaryGoal }), [selections, primaryGoal]);

  const hasAnything = muscles.length > 0 || selections.bodyWeight || selections.bodyFat || selections.lifts.length > 0;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-deep)' }}
      role="dialog" aria-modal="true"
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <button type="button" onClick={onClose} aria-label={tt('common.close', 'Close')}
          style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 4 }}>
          <X size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)' }}>{tt('onboardingTargets.title', 'Your Targets')}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{tt('onboardingTargets.subtitle', 'Pick what matters — we tailor your plan to it. Optional.')}</div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <SectionCard icon={Dumbbell} title={tt('onboardingTargets.emphasis.title', 'Muscle emphasis')} sub={tt('onboardingTargets.emphasis.sub', 'Extra volume where you want it')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {MUSCLE_OPTIONS.map((m) => {
              const on = muscles.includes(m);
              return (
                <button key={m} type="button" onClick={() => toggleMuscle(m)}
                  style={{
                    padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                    background: on ? 'var(--color-accent)' : 'transparent',
                    color: on ? 'var(--color-text-on-secondary, #06231F)' : 'var(--color-text-primary)',
                  }}>
                  {tt(`onboardingTargets.muscle.${m.toLowerCase()}`, m)}
                </button>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard icon={Scale} title={tt('onboardingTargets.bodyWeight.title', 'Target body weight')} sub={tt('onboardingTargets.bodyWeight.sub', 'Where you want to be')}>
          <div style={{ display: 'flex', gap: 10 }}>
            <NumField label={tt('onboardingTargets.current', 'Current')} value={bw.current} suffix="lb" onChange={(v) => setBw((s) => ({ ...s, current: v }))} />
            <NumField label={tt('onboardingTargets.target', 'Target')} value={bw.target} suffix="lb" onChange={(v) => setBw((s) => ({ ...s, target: v }))} />
          </div>
          <BandPicker goalType="body_weight" current={bw.current} target={bw.target} fitnessLevel={fitnessLevel} value={bw.band} onChange={(b) => setBw((s) => ({ ...s, band: b }))} t={tt} />
        </SectionCard>

        <SectionCard icon={Percent} title={tt('onboardingTargets.bodyFat.title', 'Body fat %')} sub={tt('onboardingTargets.bodyFat.sub', 'If you track it')}>
          <div style={{ display: 'flex', gap: 10 }}>
            <NumField label={tt('onboardingTargets.current', 'Current')} value={bf.current} suffix="%" onChange={(v) => setBf((s) => ({ ...s, current: v }))} />
            <NumField label={tt('onboardingTargets.target', 'Target')} value={bf.target} suffix="%" onChange={(v) => setBf((s) => ({ ...s, target: v }))} />
          </div>
          <BandPicker goalType="body_fat" current={bf.current} target={bf.target} fitnessLevel={fitnessLevel} value={bf.band} onChange={(b) => setBf((s) => ({ ...s, band: b }))} t={tt} />
        </SectionCard>

        <SectionCard icon={TargetIcon} title={tt('onboardingTargets.lifts.title', 'Target lifts')} sub={tt('onboardingTargets.lifts.sub', 'Numbers you want to hit')}>
          {KEY_LIFTS.map((l) => {
            const st = lifts[l.id];
            return (
              <div key={l.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 5 }}>
                  {tt(`fitnessLevel.maxes.${l.key}`, LIFT_LABEL[l.key])}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <NumField label={tt('onboardingTargets.current', 'Current')} value={st.current} suffix="lb"
                    onChange={(v) => setLifts((s) => ({ ...s, [l.id]: { ...s[l.id], current: v } }))} />
                  <NumField label={tt('onboardingTargets.target', 'Target')} value={st.target} suffix="lb"
                    onChange={(v) => setLifts((s) => ({ ...s, [l.id]: { ...s[l.id], target: v } }))} />
                </div>
                <BandPicker goalType="lift_1rm" current={st.current} target={st.target} exerciseName={LIFT_LABEL[l.key]} fitnessLevel={fitnessLevel}
                  value={st.band} onChange={(b) => setLifts((s) => ({ ...s, [l.id]: { ...s[l.id], band: b } }))} t={tt} />
              </div>
            );
          })}
        </SectionCard>

        {conflicts.length > 0 && (
          <div style={{ background: 'color-mix(in srgb, var(--color-warning, #F59E0B) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning, #F59E0B) 40%, transparent)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            {conflicts.map((c) => (
              <div key={c} style={{ fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>
                {tt(`onboardingTargets.conflict.${c}`, c === 'fatLossButGaining'
                  ? 'Heads up: your goal is fat loss but your target weight is higher than now.'
                  : 'Heads up: your goal is muscle gain but your target weight is lower than now.')}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', gap: 10, padding: 16, borderTop: '1px solid var(--color-border-subtle)' }}>
        <button type="button" onClick={onClose}
          style={{ flex: 1, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            background: 'var(--color-bg-hover)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
          {tt('onboardingTargets.skip', 'Skip')}
        </button>
        <button type="button" onClick={() => onSave(selections)} disabled={!hasAnything}
          style={{ flex: 2, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: hasAnything ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: hasAnything ? 1 : 0.45,
            background: 'var(--color-accent)', border: 'none', color: 'var(--color-text-on-secondary, #06231F)' }}>
          <Check size={17} /> {tt('onboardingTargets.save', 'Save targets')}
        </button>
      </div>
    </div>
  );
}
