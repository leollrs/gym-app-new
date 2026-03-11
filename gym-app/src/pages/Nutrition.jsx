import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Flame, Edit2, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO, subDays, eachDayOfInterval } from 'date-fns';

// ── Auto-calculate targets ────────────────────────────────────────────────────
// Simple TDEE estimate without height/age:
//   Base = bodyweight_lbs × 11  (sedentary baseline)
//   Activity multiplier based on training days
//   Goal adjustment
const autoCalculate = (bodyweightLbs, trainingDays, goal) => {
  if (!bodyweightLbs) return null;
  const bw = parseFloat(bodyweightLbs);

  // Activity factor
  const activityMap = {
    1: 1.25, 2: 1.3, 3: 1.375, 4: 1.4, 5: 1.45, 6: 1.5, 7: 1.55,
  };
  const activity = activityMap[Math.min(Math.max(trainingDays ?? 3, 1), 7)] ?? 1.375;
  const tdee = Math.round(bw * 11 * activity);

  // Goal adjustment
  const calMap = {
    fat_loss:       tdee - 500,
    muscle_gain:    tdee + 300,
    strength:       tdee + 200,
    endurance:      tdee,
    general_fitness: tdee,
  };
  const calories = calMap[goal] ?? tdee;

  // Protein targets (g per lb BW)
  const proteinMap = {
    fat_loss:       Math.round(bw * 0.85),
    muscle_gain:    Math.round(bw * 1.0),
    strength:       Math.round(bw * 1.0),
    endurance:      Math.round(bw * 0.75),
    general_fitness: Math.round(bw * 0.7),
  };
  const protein = proteinMap[goal] ?? Math.round(bw * 0.8);

  // Macros: remaining cals split 40% carbs / 25% fat (protein fills rest)
  const proteinCals = protein * 4;
  const remaining   = Math.max(0, calories - proteinCals);
  const carbs = Math.round((remaining * 0.6) / 4);
  const fat   = Math.round((remaining * 0.4) / 9);

  return { daily_calories: Math.max(1200, calories), daily_protein_g: protein, daily_carbs_g: carbs, daily_fat_g: fat };
};

const GOAL_LABELS = {
  fat_loss: 'Fat Loss', muscle_gain: 'Muscle Gain', strength: 'Strength',
  endurance: 'Endurance', general_fitness: 'General Fitness',
};

const today = () => new Date().toISOString().slice(0, 10);

// ── Macro bar ─────────────────────────────────────────────────────────────────
const MacroBar = ({ label, value, unit, color, max }) => {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <p className="text-[13px] font-black text-white">
          {value ?? '—'}
          <span className="text-[11px] font-medium ml-0.5" style={{ color: 'var(--text-muted)' }}>{unit}</span>
        </p>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
};

// ── 30-day check-in grid ──────────────────────────────────────────────────────
const CheckInGrid = ({ checkins }) => {
  const days = eachDayOfInterval({ start: subDays(new Date(), 29), end: new Date() });
  const dateSet = new Set(
    checkins.map(c => c.checkin_date)
  );
  const hitBothSet = new Set(
    checkins.filter(c => c.hit_calories && c.hit_protein).map(c => c.checkin_date)
  );
  const hitOneSet = new Set(
    checkins.filter(c => c.hit_calories || c.hit_protein).map(c => c.checkin_date)
  );

  return (
    <div className="flex flex-wrap gap-1">
      {days.map(d => {
        const key = format(d, 'yyyy-MM-dd');
        const color = hitBothSet.has(key)
          ? 'bg-[#D4AF37]'
          : hitOneSet.has(key)
          ? 'bg-[#D4AF37]/40'
          : dateSet.has(key)
          ? 'bg-white/10'
          : 'bg-white/4';
        return (
          <div
            key={key}
            className={`w-6 h-6 rounded-[4px] ${color} transition-colors`}
            title={`${format(d, 'MMM d')}${hitBothSet.has(key) ? ' ✓ Both' : hitOneSet.has(key) ? ' ✓ Partial' : ''}`}
          />
        );
      })}
    </div>
  );
};

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Nutrition() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [targets,   setTargets]   = useState(null);
  const [checkins,  setCheckins]  = useState([]);
  const [todayLog,  setTodayLog]  = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [bodyweight, setBodyweight] = useState(null);
  const [loading,   setLoading]   = useState(true);

  // Edit mode
  const [editing,   setEditing]   = useState(false);
  const [draft,     setDraft]     = useState({});
  const [saving,    setSaving]    = useState(false);

  // Today check-in
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const from30 = subDays(new Date(), 29).toISOString().slice(0, 10);

    const [{ data: tgt }, { data: logs }, { data: ob }, { data: bw }] = await Promise.all([
      supabase.from('nutrition_targets').select('*').eq('profile_id', user.id).single(),
      supabase.from('nutrition_checkins').select('*').eq('profile_id', user.id).gte('checkin_date', from30).order('checkin_date', { ascending: false }),
      supabase.from('member_onboarding').select('primary_goal, training_days_per_week').eq('profile_id', user.id).single(),
      supabase.from('body_weight_logs').select('weight_lbs').eq('profile_id', user.id).order('logged_at', { ascending: false }).limit(1).single(),
    ]);

    setTargets(tgt ?? null);
    setCheckins(logs ?? []);
    setTodayLog((logs ?? []).find(c => c.checkin_date === today()) ?? null);
    setOnboarding(ob ?? null);
    setBodyweight(bw?.weight_lbs ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Save targets ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    const payload = {
      profile_id:       user.id,
      gym_id:           profile.gym_id,
      daily_calories:   draft.daily_calories   ? parseInt(draft.daily_calories)   : null,
      daily_protein_g:  draft.daily_protein_g  ? parseInt(draft.daily_protein_g)  : null,
      daily_carbs_g:    draft.daily_carbs_g    ? parseInt(draft.daily_carbs_g)    : null,
      daily_fat_g:      draft.daily_fat_g      ? parseInt(draft.daily_fat_g)      : null,
      updated_at:       new Date().toISOString(),
    };
    const { data, error } = await supabase.from('nutrition_targets').upsert(payload, { onConflict: 'profile_id' }).select().single();
    if (!error) { setTargets(data); setEditing(false); }
    setSaving(false);
  };

  const handleAutoCalculate = () => {
    const calc = autoCalculate(bodyweight, onboarding?.training_days_per_week, onboarding?.primary_goal);
    if (calc) setDraft(d => ({ ...d, ...calc }));
  };

  // ── Log today's check-in ────────────────────────────────────────────────────
  const handleCheckin = async (hitCalories, hitProtein) => {
    setLogging(true);
    const payload = {
      profile_id:   user.id,
      gym_id:       profile.gym_id,
      checkin_date: today(),
      hit_calories: hitCalories,
      hit_protein:  hitProtein,
    };
    const { data, error } = await supabase
      .from('nutrition_checkins')
      .upsert(payload, { onConflict: 'profile_id,checkin_date' })
      .select().single();
    if (!error) {
      setTodayLog(data);
      setCheckins(prev => [data, ...prev.filter(c => c.checkin_date !== today())]);
    }
    setLogging(false);
  };

  const streak = (() => {
    let s = 0;
    const d = new Date();
    for (let i = 0; i < 30; i++) {
      const key = format(subDays(d, i), 'yyyy-MM-dd');
      if (checkins.some(c => c.checkin_date === key)) s++;
      else if (i > 0) break;
    }
    return s;
  })();

  const openEdit = () => {
    setDraft({
      daily_calories:  targets?.daily_calories  ?? '',
      daily_protein_g: targets?.daily_protein_g ?? '',
      daily_carbs_g:   targets?.daily_carbs_g   ?? '',
      daily_fat_g:     targets?.daily_fat_g      ?? '',
    });
    setEditing(true);
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 md:px-6 pt-6 pb-28 md:pb-12 animate-fade-in">

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
          <h1 className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Nutrition</h1>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Daily targets &amp; check-ins</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Daily targets card ─────────────────────────────────────────── */}
          <div
            className="rounded-[14px] p-5 mb-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Daily Targets</p>
              <button
                onClick={openEdit}
                className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-xl"
                style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
              >
                <Edit2 size={12} /> {targets ? 'Edit' : 'Set targets'}
              </button>
            </div>

            {targets ? (
              <div className="space-y-3.5">
                <MacroBar label="Calories" value={targets.daily_calories} unit="kcal" color="#D4AF37" max={targets.daily_calories} />
                <MacroBar label="Protein"  value={targets.daily_protein_g} unit="g"   color="#60A5FA" max={targets.daily_protein_g} />
                <MacroBar label="Carbs"    value={targets.daily_carbs_g}   unit="g"   color="#34D399" max={targets.daily_carbs_g} />
                <MacroBar label="Fat"      value={targets.daily_fat_g}     unit="g"   color="#F97316" max={targets.daily_fat_g} />
                {onboarding?.primary_goal && (
                  <p className="text-[11px] pt-1" style={{ color: 'var(--text-muted)' }}>
                    Optimized for <span style={{ color: '#D4AF37' }}>{GOAL_LABELS[onboarding.primary_goal] ?? onboarding.primary_goal}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="py-4 text-center">
                <p className="text-[13px] mb-1" style={{ color: 'var(--text-muted)' }}>No targets set yet</p>
                <p className="text-[11px]" style={{ color: 'var(--text-subtle)' }}>
                  {bodyweight ? 'Use Auto-Calculate or enter manually' : 'Log your bodyweight first to auto-calculate'}
                </p>
              </div>
            )}
          </div>

          {/* ── Edit modal ─────────────────────────────────────────────────── */}
          {editing && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm py-[10vh] px-4" onClick={() => setEditing(false)}>
              <div
                className="bg-[#0F172A] border border-white/8 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden shadow-xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
                  <p className="text-[16px] font-bold text-[#E5E7EB]">Nutrition Targets</p>
                  <button onClick={() => setEditing(false)}><X size={20} className="text-[#6B7280]" /></button>
                </div>
                <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
                  {bodyweight && (
                    <button
                      onClick={handleAutoCalculate}
                      className="w-full py-2.5 rounded-xl text-[13px] font-bold border transition-colors"
                      style={{ borderColor: 'rgba(212,175,55,0.3)', color: '#D4AF37', background: 'rgba(212,175,55,0.06)' }}
                    >
                      Auto-calculate from my stats
                    </button>
                  )}
                  {[
                    { key: 'daily_calories',  label: 'Calories', unit: 'kcal' },
                    { key: 'daily_protein_g', label: 'Protein',  unit: 'g' },
                    { key: 'daily_carbs_g',   label: 'Carbs',    unit: 'g' },
                    { key: 'daily_fat_g',     label: 'Fat',      unit: 'g' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{f.label} ({f.unit})</label>
                      <input
                        type="number" inputMode="numeric" min={0}
                        value={draft[f.key]}
                        onChange={e => {
                          const v = e.target.value;
                          if (v === '' || v === '-') return setDraft(d => ({ ...d, [f.key]: v }));
                          const n = parseFloat(v);
                          setDraft(d => ({ ...d, [f.key]: (!isNaN(n) && n < 0) ? '0' : v }));
                        }}
                        className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
                      />
                    </div>
                  ))}
                  <button onClick={handleSave} disabled={saving}
                    className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save Targets'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Today's check-in ───────────────────────────────────────────── */}
          <div
            className="rounded-[14px] p-5 mb-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Today's Check-in
            </p>
            <p className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>
              {format(new Date(), 'EEEE, MMMM d')}
            </p>

            <div className="grid grid-cols-2 gap-3">
              {/* Hit calories */}
              <button
                onClick={() => handleCheckin(!(todayLog?.hit_calories), todayLog?.hit_protein ?? false)}
                disabled={logging}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition-all"
                style={todayLog?.hit_calories
                  ? { background: 'rgba(212,175,55,0.1)', borderColor: 'rgba(212,175,55,0.4)' }
                  : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <Flame
                  size={22}
                  style={{ color: todayLog?.hit_calories ? '#D4AF37' : '#4B5563' }}
                  strokeWidth={2}
                />
                <p className="text-[13px] font-bold" style={{ color: todayLog?.hit_calories ? '#D4AF37' : 'var(--text-muted)' }}>
                  {todayLog?.hit_calories ? 'Hit Calories ✓' : 'Calories?'}
                </p>
                {targets?.daily_calories && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{targets.daily_calories} kcal</p>
                )}
              </button>

              {/* Hit protein */}
              <button
                onClick={() => handleCheckin(todayLog?.hit_calories ?? false, !(todayLog?.hit_protein))}
                disabled={logging}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition-all"
                style={todayLog?.hit_protein
                  ? { background: 'rgba(96,165,250,0.1)', borderColor: 'rgba(96,165,250,0.4)' }
                  : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <Check
                  size={22}
                  style={{ color: todayLog?.hit_protein ? '#60A5FA' : '#4B5563' }}
                  strokeWidth={2.5}
                />
                <p className="text-[13px] font-bold" style={{ color: todayLog?.hit_protein ? '#60A5FA' : 'var(--text-muted)' }}>
                  {todayLog?.hit_protein ? 'Hit Protein ✓' : 'Protein?'}
                </p>
                {targets?.daily_protein_g && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{targets.daily_protein_g}g protein</p>
                )}
              </button>
            </div>
          </div>

          {/* ── 30-day grid ─────────────────────────────────────────────────── */}
          <div
            className="rounded-[14px] p-5 mb-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Consistency</p>
              <div className="flex items-center gap-2">
                <Flame size={14} style={{ color: '#D4AF37' }} />
                <span className="text-[13px] font-bold" style={{ color: '#D4AF37' }}>{streak} day streak</span>
              </div>
            </div>
            <CheckInGrid checkins={checkins} />
            <div className="flex items-center gap-3 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-[3px] bg-[#D4AF37]" />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Both hit</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-[3px] bg-[#D4AF37]/40" />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Partial</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-[3px] bg-white/4" />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Missed</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
