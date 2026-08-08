import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Gift, ChevronDown, Flame, Dumbbell, Zap, TrendingUp, Users, Timer, Crown, AlertTriangle, Check, Calendar } from 'lucide-react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import posthog from 'posthog-js';
import { AdminModal } from '../../../components/admin';
import ChallengeTypePicker from './ChallengeTypePicker';
import ChallengeTypeConfig from './ChallengeTypeConfig';
import ChallengeFormatPicker from './ChallengeFormatPicker';
import ChallengeFormRail from './ChallengeFormRail';
import RoutineSelector from './RoutineSelector';
import {
  buildChallengePayload, missingConfig, endFromStart, daysBetween, DURATION_PRESETS,
  isCompletion, rewardSlots, needsPlan,
} from '../../../lib/admin/challengeConfig';

const CHALLENGE_COVERS = [
  { key: 'fire',      labelKey: 'admin.challenges.cover.fire',      icon: Flame,      gradient: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)' },
  { key: 'power',     labelKey: 'admin.challenges.cover.power',     icon: Dumbbell,   gradient: 'linear-gradient(135deg, #D4AF37 0%, #92751E 100%)' },
  { key: 'endurance', labelKey: 'admin.challenges.cover.endurance', icon: Zap,        gradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' },
  { key: 'growth',    labelKey: 'admin.challenges.cover.growth',    icon: TrendingUp, gradient: 'linear-gradient(135deg, #10B981 0%, #047857 100%)' },
  { key: 'compete',   labelKey: 'admin.challenges.cover.compete',   icon: Trophy,     gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' },
  { key: 'team',      labelKey: 'admin.challenges.cover.team',      icon: Users,      gradient: 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)' },
  { key: 'speed',     labelKey: 'admin.challenges.cover.speed',     icon: Timer,      gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
  { key: 'champion',  labelKey: 'admin.challenges.cover.champion',  icon: Crown,      gradient: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)' },
];

// Tres puestos, ni uno más. `award_challenge_prizes` reparte con LIMIT 3
// (migración 0514), así que un cuarto puesto sería una promesa que el servidor
// no cumple.
const DEFAULT_REWARDS = [
  { place: '1st', points: 500, prize: '', product_id: null, prizeType: 'none' },
  { place: '2nd', points: 300, prize: '', product_id: null, prizeType: 'none' },
  { place: '3rd', points: 150, prize: '', product_id: null, prizeType: 'none' },
];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Crear / editar un reto.
 *
 * Cuatro preguntas en vez de dos pasos: qué se mide, cómo se llama, cuánto
 * dura, qué se llevan. La primera arrastra la configuración que ese tipo
 * necesita para puntuar — que es lo que faltaba y lo que dejaba dos de los
 * tipos muertos (ver `lib/admin/challengeConfig.js`).
 */
export default function ChallengeModal({ isOpen, onClose, gymId, adminId, challenge = null, prefill = null }) {
  const { t, i18n } = useTranslation('pages');
  const lang = i18n.language;
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!challenge;

  const { data: gymProducts = [] } = useQuery({
    queryKey: ['gym_products', gymId, 'active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_products')
        .select('id, name, emoji_icon')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
  });

  const { data: gymProgramsList = [] } = useQuery({
    queryKey: ['gym_programs_published', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_programs')
        .select('id, name, duration_weeks')
        .eq('gym_id', gymId)
        .eq('is_published', true)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
  });

  const { data: memberCount = null } = useQuery({
    queryKey: ['gym_member_count', gymId],
    queryFn: async () => {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId);
      return count ?? null;
    },
    enabled: !!gymId,
  });

  const initialForm = () => {
    const common = {
      exercise_id: null, exercise_ids: [], milestone_target: '', team_size: null, scoring_metric: null,
      workout_template_id: null, program_id: null,
    };
    if (!challenge) {
      const seeded = {
        name: '', type: 'consistency', format: 'competitive', description: '', cover_preset: '',
        start_date: todayISO(), days: 14,
        enableRewards: false, rewards: [...DEFAULT_REWARDS],
        ...common,
        ...(prefill || {}),
      };
      // La plantilla rápida «Trae un amigo» pone type: 'team' y nada más. Sin
      // tamaño, `TeamFormationModal` cerraba los equipos en 2 por defecto y la
      // ficha enseñaba «N/?». Se siembra uno razonable; el admin lo cambia.
      if (seeded.type === 'team' && !seeded.team_size) seeded.team_size = 4;
      // Bandera de la plantilla, no columna: `buildChallengePayload` no la copia.
      seeded.requiresProgram = !!(prefill && prefill.requiresProgram);
      return seeded;
    }
    let rewards = [...DEFAULT_REWARDS];
    let enableRewards = false;
    try {
      const parsed = challenge.reward_description ? JSON.parse(challenge.reward_description) : null;
      if (parsed && Array.isArray(parsed)) {
        enableRewards = true;
        rewards = parsed.slice(0, 3).map((r, i) => ({
          place: r.place || ['1st', '2nd', '3rd'][i],
          points: r.points || 0,
          prize: r.prize || '',
          product_id: r.product_id || null,
          prizeType: r.product_id ? 'product' : r.prize ? 'custom' : 'none',
        }));
      }
    } catch { /* ignore parse errors */ }
    const start = new Date(challenge.start_date);
    return {
      name: challenge.name,
      type: challenge.type,
      format: challenge.format || 'competitive',
      description: challenge.description || '',
      cover_preset: challenge.cover_preset || '',
      start_date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      days: daysBetween(challenge.start_date, challenge.end_date) || 14,
      enableRewards,
      rewards,
      ...common,
      exercise_id: challenge.exercise_id || null,
      exercise_ids: challenge.exercise_ids || [],
      milestone_target: challenge.milestone_target || '',
      team_size: challenge.team_size || null,
      scoring_metric: challenge.scoring_metric || null,
      workout_template_id: challenge.workout_template_id || null,
      program_id: challenge.program_id || null,
    };
  };

  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Para que la vista previa diga «Gana quien más acumule en Sentadilla
  // trasera» en vez de enseñar un uuid.
  const { data: chosenExercise } = useQuery({
    queryKey: ['challenge-exercise-name', form.exercise_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('exercises').select('name, name_es').eq('id', form.exercise_id).maybeSingle();
      return data || null;
    },
    enabled: !!form.exercise_id,
  });
  const exerciseLabel = chosenExercise
    ? (lang?.startsWith('es') && chosenExercise.name_es) || chosenExercise.name
    : null;

  // Cambiar de tipo limpia lo del tipo anterior en la pantalla, igual que
  // `buildChallengePayload` lo limpia en la fila. La meta NO se toca: pertenece
  // al formato, y cambiar de métrica no la invalida.
  const pickType = (type) => setForm(p => ({
    ...p, type,
    exercise_id: null, exercise_ids: [],
    team_size: type === 'team' ? (p.team_size || 4) : null,
    scoring_metric: null,
  }));

  // Cambiar de formato recorta o repone los premios: competitivo reparte tres
  // puestos, cumplimiento uno solo. Guardar tres en una fila de cumplimiento
  // sería prometer un podio que el servidor no paga.
  const pickFormat = (format) => setForm(p => ({
    ...p, format,
    rewards: format === 'completion'
      ? [{ ...(p.rewards[0] || DEFAULT_REWARDS[0]), place: '1st' }]
      : (p.rewards.length === 3 ? p.rewards : [...DEFAULT_REWARDS]),
  }));

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { error: err } = await supabase.from('challenges').insert(payload);
      if (err) throw err;
    },
    onSuccess: () => {
      logAdminAction('create_challenge', 'challenge', null);
      posthog?.capture('admin_challenge_created', { source: 'manual', type: form.type });
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast(t('admin.challenges.challengeCreated', 'Challenge created'), 'success');
      onClose();
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload) => {
      const { error: err } = await supabase.from('challenges').update(payload).eq('id', challenge.id);
      if (err) throw err;
    },
    onSuccess: () => {
      logAdminAction('update_challenge', 'challenge', challenge.id);
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast(t('admin.challenges.challengeUpdated', 'Challenge updated'), 'success');
      onClose();
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  // ── Qué falta, dicho con nombres, no con banderas rojas ──
  const missing = useMemo(() => {
    const out = [];
    if (!form.name.trim() || form.name.trim().length < 3) out.push(t('admin.challenges.missName', 'el nombre'));
    if (!form.cover_preset) out.push(t('admin.challenges.missCover', 'la portada'));
    if (!form.start_date) out.push(t('admin.challenges.missStart', 'la fecha de inicio'));
    missingConfig(form).forEach((k) => out.push(k === 'milestone_target'
      ? t('admin.challenges.missTarget', 'la meta')
      : t(`admin.challenges.miss_${k}`, {
        exercise_id: 'el ejercicio',
        exercise_ids: 'los levantamientos',
        team_size: 'el tamaño del equipo',
        plan: 'la rutina o el programa',
        program_id: 'el programa',
        type: 'el tipo',
      }[k] || k)));
    return out;
  }, [form, t]);

  const rewardsForRail = form.rewards.map(r => ({
    ...r,
    prizeLabel: r.prizeType === 'product'
      ? gymProducts.find(p => p.id === r.product_id)?.name || null
      : r.prizeType === 'custom' ? r.prize : null,
  }));

  const handleSave = () => {
    if (missing.length) return;
    setError('');
    const rewardData = form.enableRewards
      ? JSON.stringify(form.rewards.map(r => {
          const entry = { place: r.place, points: r.points, prize: null, product_id: null };
          if (r.prizeType === 'product' && r.product_id) {
            entry.prize = gymProducts.find(p => p.id === r.product_id)?.name || 'Product';
            entry.product_id = r.product_id;
          } else if (r.prizeType === 'custom' && r.prize) {
            entry.prize = r.prize;
          }
          return entry;
        }))
      : null;

    const payload = buildChallengePayload(form, { rewardData });
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate({ ...payload, gym_id: gymId, created_by: adminId, status: 'active' });
  };

  const handlePrizeTypeChange = (index, prizeType) => {
    const updated = [...form.rewards];
    updated[index] = {
      ...updated[index], prizeType,
      prize: prizeType === 'custom' ? updated[index].prize : '',
      product_id: prizeType === 'product' ? updated[index].product_id : null,
    };
    set('rewards', updated);
  };

  const planRequired = needsPlan(form);
  const cover = CHALLENGE_COVERS.find(c => c.key === form.cover_preset) || null;
  const end = endFromStart(form.start_date, form.days);
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

  const sectionNum = (n) => (
    <span className="text-[10.5px] font-bold tabular-nums w-[16px] flex-shrink-0" style={{ color: 'var(--color-admin-text-faint)' }}>{n}</span>
  );
  const inputCls = 'w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors';
  const inputStyle = { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' };
  const chipStyle = (on) => ({
    background: on ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-admin-panel)',
    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-admin-border)'}`,
    color: on ? 'var(--color-accent)' : 'var(--color-admin-text-muted)',
  });

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? t('admin.challenges.editChallenge', 'Edit Challenge') : t('admin.challenges.newChallenge', 'New Challenge')}
      subtitle={t('admin.challenges.formSubtitle', 'Escoge qué se mide, cuánto dura y qué se llevan los ganadores.')}
      titleIcon={Trophy}
      size="lg"
      footer={(
        <div className="flex items-center gap-3 w-full flex-wrap">
          <div className="flex items-center gap-1.5 text-[11.5px] flex-1 min-w-[150px]">
            {missing.length ? (
              <>
                <AlertTriangle size={13} style={{ color: 'var(--color-warning, var(--color-accent))', flexShrink: 0 }} />
                <span style={{ color: 'var(--color-admin-text-muted)' }}>
                  {t('admin.challenges.missingFields', { fields: missing.join(', '), defaultValue: 'Falta {{fields}}' })}
                </span>
              </>
            ) : (
              <>
                <Check size={13} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                <span style={{ color: 'var(--color-success)' }}>
                  {t('admin.challenges.readyToCreate', { n: form.days, defaultValue: 'Listo · {{n}} días' })}
                </span>
              </>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-2.5 text-[13px] font-bold transition-colors"
            style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', borderRadius: 999 }}>
            {t('admin.challenges.cancel', 'Cancelar')}
          </button>
          <button onClick={handleSave} disabled={saving || missing.length > 0}
            className="px-5 py-2.5 text-[13px] font-bold disabled:opacity-50 transition-all hover:brightness-[1.04]"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)', borderRadius: 999 }}>
            {saving
              ? (isEdit ? t('admin.challenges.saving', 'Saving...') : t('admin.challenges.creating', 'Creating...'))
              : isEdit ? t('admin.challenges.saveChanges', 'Save Changes') : t('admin.challenges.createChallenge', 'Create Challenge')}
          </button>
        </div>
      )}
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="min-w-0 space-y-5">
          {/* ── 01 · ¿Cómo se gana? ── */}
          <section>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('01')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.challenges.step0', '¿Cómo se gana?')}
              </h3>
            </div>
            <ChallengeFormatPicker value={form.format} onPick={pickFormat} t={t} />
          </section>

          {/* ── 02 · ¿Qué se mide? ── */}
          <section style={{ borderTop: '1px solid var(--color-admin-border)', paddingTop: 18 }}>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('02')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.challenges.step1', '¿Qué se mide?')}
              </h3>
            </div>
            <ChallengeTypePicker value={form.type} onPick={pickType} t={t} />
            <ChallengeTypeConfig form={form} set={set} t={t} lang={lang} />
          </section>

          {/* ── 03 · ¿Cómo se llama? ── */}
          <section style={{ borderTop: '1px solid var(--color-admin-border)', paddingTop: 18 }}>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('03')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.challenges.step2', '¿Cómo se llama?')}
              </h3>
            </div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[12px] font-bold" style={{ color: 'var(--color-admin-text-sub)' }}>
                {t('admin.challenges.challengeName', 'Challenge Name')} <span style={{ color: 'var(--color-danger)' }}>*</span>
              </label>
              <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-admin-text-faint)' }}>{form.name.length}/50</span>
            </div>
            <input value={form.name} maxLength={50} onChange={e => set('name', e.target.value)}
              placeholder={t('admin.challenges.namePlaceholder', 'e.g. March Volume Wars')}
              className={inputCls} style={inputStyle} />

            <div className="flex items-center justify-between mb-1 mt-3.5">
              <label className="text-[12px] font-bold" style={{ color: 'var(--color-admin-text-sub)' }}>
                {t('admin.challenges.descriptionLabel', 'Description (optional)')}
              </label>
              <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-admin-text-faint)' }}>{form.description.length}/200</span>
            </div>
            <textarea value={form.description} maxLength={200} rows={2} onChange={e => set('description', e.target.value)}
              placeholder={t('admin.challenges.descriptionPlaceholder', 'Tell members what this challenge is about...')}
              className={`${inputCls} resize-none`} style={inputStyle} />

            <label className="block text-[12px] font-bold mb-1.5 mt-3.5" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.challenges.coverLabel', 'Cover Image')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CHALLENGE_COVERS.map(c => {
                const Icon = c.icon;
                const on = form.cover_preset === c.key;
                return (
                  <button key={c.key} type="button" onClick={() => set('cover_preset', c.key)} aria-pressed={on}
                    className={`rounded-xl p-2.5 flex flex-col items-center gap-1 transition-all ${on ? 'scale-[1.03]' : 'opacity-70 hover:opacity-100'}`}
                    style={{ background: c.gradient, boxShadow: on ? '0 0 0 2px var(--color-bg-card), 0 0 0 4px var(--color-accent)' : 'none' }}>
                    <Icon size={20} className="text-white/90" />
                    <span className="text-[8px] font-bold text-white/80 uppercase tracking-wide">{t(c.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── 03 · ¿Cuánto dura? ── */}
          <section style={{ borderTop: '1px solid var(--color-admin-border)', paddingTop: 18 }}>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('04')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.challenges.step3', '¿Cuánto dura?')}
              </h3>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-bold mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
                  {t('admin.challenges.startDate', 'Start Date')} <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                  className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-[12px] font-bold mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
                  {t('admin.challenges.durationLabel', 'Duración')}
                  <span className="font-normal" style={{ color: 'var(--color-admin-text-faint)' }}> — {t('admin.challenges.days', 'días')}</span>
                </label>
                <div className="flex gap-1.5 flex-wrap items-center">
                  {DURATION_PRESETS.map(d => (
                    <button key={d} type="button" onClick={() => set('days', d)}
                      className="h-[34px] px-3.5 rounded-lg text-[12.5px] font-bold tabular-nums transition-colors"
                      style={chipStyle(form.days === d)}>{d}</button>
                  ))}
                  <label className="h-[34px] px-3 rounded-lg text-[12.5px] font-bold inline-flex items-center gap-1.5"
                    style={chipStyle(!DURATION_PRESETS.includes(form.days))}>
                    {t('admin.challenges.other', 'Otro')}
                    <input type="number" inputMode="numeric" min={1} max={365} value={form.days || ''}
                      onChange={e => set('days', Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))}
                      className="w-[42px] bg-transparent outline-none text-right tabular-nums" style={{ color: 'inherit' }} />
                  </label>
                </div>
              </div>
            </div>
            {/* La franja que el formulario viejo no tenía: qué días cubre de verdad. */}
            <div className="flex items-center gap-2 mt-3 px-3 py-2.5 rounded-lg text-[11.5px] flex-wrap"
              style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-muted)' }}>
              <Calendar size={14} style={{ color: 'var(--color-admin-text-faint)' }} />
              {t('admin.challenges.runsFromTo', {
                from: form.start_date ? new Date(`${form.start_date}T12:00:00`).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) : '—',
                to: end ? end.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) : '—',
                defaultValue: 'Corre del {{from}} al {{to}} · 11:59 PM',
              })}
              <span className="ml-auto" style={{ color: 'var(--color-admin-text-faint)' }}>
                {t('admin.challenges.daysWeeks', {
                  d: form.days, w: (form.days / 7).toFixed(form.days % 7 ? 1 : 0),
                  defaultValue: '{{d}} días · {{w}} semanas',
                })}
              </span>
            </div>
          </section>

          {/* ── 05 · ¿Con qué lo entrenan? ── */}
          <section style={{ borderTop: '1px solid var(--color-admin-border)', paddingTop: 18 }}>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('05')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.challenges.step5', '¿Con qué lo entrenan?')}
              </h3>
              {/* Opcional para «entrena más», OBLIGATORIO para un club o para una
                  plantilla que promete un plan. La etiqueta lo dice, y el pie
                  no deja crear sin ello. */}
              <span className="ml-auto text-[11px]"
                style={{ color: planRequired ? 'var(--color-danger)' : 'var(--color-admin-text-faint)' }}>
                {planRequired
                  ? t('admin.challenges.requiredLabel', 'obligatorio')
                  : t('admin.challenges.optionalLabel', 'opcional')}
              </span>
            </div>
            <p className="text-[11.5px] mb-2.5 leading-relaxed" style={{ color: 'var(--color-admin-text-muted)' }}>
              {planRequired
                ? t('admin.challenges.attachRoutineRequired', 'Este reto propone una meta, así que tiene que decir CÓMO se llega: engancha una rutina o un programa entero.')
                : t('admin.challenges.attachRoutineHint', 'Un reto que dice «levanta 1000 lbs» y no dice CÓMO deja al socio solo. Con una rutina enganchada, la puede entrenar de una vez o meterla en su semana.')}
            </p>
            <RoutineSelector gymId={gymId} value={form.workout_template_id}
              onChange={(id) => set('workout_template_id', id)} t={t} />

            {gymProgramsList.length > 0 && (
              <div className="mt-3.5">
                <label className="block text-[12px] font-bold mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
                  {t('admin.challenges.attachProgram', 'O un programa entero')}
                </label>
                <div className="relative">
                  <select value={form.program_id || ''}
                    onChange={e => set('program_id', e.target.value || null)}
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none appearance-none pr-8 cursor-pointer"
                    style={inputStyle}>
                    <option value="">{t('admin.challenges.noProgram', 'Ninguno')}</option>
                    {gymProgramsList.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.duration_weeks ? ` · ${p.duration_weeks} sem` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-admin-text-muted)' }} />
                </div>
                <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--color-admin-text-muted)' }}>
                  {t('admin.challenges.attachProgramHint', 'El socio entra desde el reto. Si ya tiene programa, la app le ofrece pausarlo o cambiarlo — no se lo pisa en silencio.')}
                </p>
              </div>
            )}
          </section>

          {/* ── 06 · ¿Qué se llevan? ── */}
          <section style={{ borderTop: '1px solid var(--color-admin-border)', paddingTop: 18 }}>
            <div className="flex items-baseline gap-2.5 mb-3">
              {sectionNum('06')}
              <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.challenges.step4', '¿Qué se llevan?')}
              </h3>
            </div>

            <button type="button" onClick={() => set('enableRewards', !form.enableRewards)}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors"
              style={{
                background: form.enableRewards ? 'color-mix(in srgb, var(--color-accent) 7%, transparent)' : 'var(--color-admin-panel)',
                border: `1px solid ${form.enableRewards ? 'color-mix(in srgb, var(--color-accent) 32%, transparent)' : 'var(--color-admin-border)'}`,
              }}>
              <Gift size={17} style={{ color: form.enableRewards ? 'var(--color-accent)' : 'var(--color-admin-text-muted)', flexShrink: 0 }} />
              <span className="min-w-0">
                <span className="block text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
                  {t('admin.challenges.addRewards', 'Add Rewards')}
                </span>
                <span className="block text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--color-admin-text-muted)' }}>
                  {t('admin.challenges.rewardsHint', 'Incentivize participation with points and prizes')}
                </span>
              </span>
              <span className="ml-auto relative w-10 h-[22px] rounded-full flex-shrink-0 transition-colors"
                style={{ background: form.enableRewards ? 'var(--color-accent)' : 'var(--color-bg-deep)' }}>
                <span className={`absolute top-[3px] w-4 h-4 rounded-full transition-all ${form.enableRewards ? 'left-[22px]' : 'left-[3px]'}`}
                  style={{ background: form.enableRewards ? 'var(--color-text-on-accent, #fff)' : 'var(--color-admin-text-muted)' }} />
              </span>
            </button>

            {form.enableRewards && (
              <div className="mt-3 space-y-3">
                {form.rewards.slice(0, rewardSlots(form)).map((r, i) => (
                  <div key={r.place} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[16px] w-6 text-center grid place-items-center">
                        {/* En cumplimiento no hay primero ni tercero: o cumpliste o no. */}
                        {isCompletion(form)
                          ? <Check size={16} style={{ color: 'var(--color-success)' }} />
                          : medals[i]}
                      </span>
                      <div className="flex-1 flex gap-2">
                        <div className="w-24">
                          {/* `type="text"` y no `number` A PROPÓSITO. Con un
                              input numérico controlado, teclear «0» sobre un
                              «0» deja «00» en pantalla: React compara el VALOR
                              (0 === 0), no ve cambio, y no reescribe el DOM. Con
                              texto filtrado a dígitos, lo que se ve es siempre
                              exactamente lo que se guarda. */}
                          <input type="text" inputMode="numeric" value={String(r.points ?? 0)}
                            aria-label={`${medals[i]} ${t('admin.challenges.points', 'points')}`}
                            onChange={e => {
                              // Tope [0, 100000] igual que el del servidor en
                              // award_challenge_prizes (migración 0490).
                              const digits = e.target.value.replace(/\D/g, '');
                              const pts = Math.min(parseInt(digits, 10) || 0, 100000);
                              const updated = [...form.rewards];
                              updated[i] = { ...r, points: pts };
                              set('rewards', updated);
                            }}
                            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none text-center tabular-nums"
                            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
                          <p className="text-[10px] text-center mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.challenges.points', 'points')}</p>
                        </div>
                        <div className="flex-1">
                          <div className="relative">
                            <select value={r.prizeType} onChange={e => handlePrizeTypeChange(i, e.target.value)}
                              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none appearance-none pr-8 cursor-pointer"
                              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}>
                              <option value="none">{t('admin.challenges.noPrize', 'Points only')}</option>
                              {gymProducts.length > 0 && <option value="product">{t('admin.challenges.selectProduct', 'Select product')}</option>}
                              <option value="custom">{t('admin.challenges.customPrize', 'Custom prize')}</option>
                            </select>
                            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-admin-text-muted)' }} />
                          </div>
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.challenges.prizeOptional', 'prize (optional)')}</p>
                        </div>
                      </div>
                    </div>

                    {r.prizeType === 'product' && gymProducts.length > 0 && (
                      <div className="ml-9 pl-3 relative">
                        <select value={r.product_id || ''}
                          onChange={e => {
                            const updated = [...form.rewards];
                            updated[i] = { ...r, product_id: e.target.value || null };
                            set('rewards', updated);
                          }}
                          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none appearance-none pr-8 cursor-pointer"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}>
                          <option value="">{t('admin.challenges.selectProduct', 'Select product')}...</option>
                          {gymProducts.map(p => (
                            <option key={p.id} value={p.id}>{p.emoji_icon ? `${p.emoji_icon} ` : ''}{p.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-admin-text-muted)' }} />
                      </div>
                    )}

                    {r.prizeType === 'custom' && (
                      <div className="ml-9 pl-3">
                        <input value={r.prize}
                          onChange={e => {
                            const updated = [...form.rewards];
                            updated[i] = { ...r, prize: e.target.value };
                            set('rewards', updated);
                          }}
                          placeholder={t('admin.challenges.customPrizePlaceholder', 'e.g. Free smoothie, 1 PT session...')}
                          aria-label={`${medals[i]} ${t('admin.challenges.customPrize', 'Custom prize')}`}
                          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
                      </div>
                    )}
                  </div>
                ))}
                {isCompletion(form) ? (
                  <>
                    <p className="text-[11px] leading-snug" style={{ color: 'var(--color-admin-text-faint)' }}>
                      {t('admin.challenges.everyoneWhoMeets', 'Se lo lleva TODO el que llegue a la meta.')}
                    </p>
                    {/* El aviso honesto: no hay inventario en la tienda, así que
                        no se puede enseñar stock — pero sí se puede decir en qué
                        se está metiendo. */}
                    {form.rewards[0]?.prizeType !== 'none' && (
                      <div className="flex gap-2 px-3 py-2.5 rounded-lg"
                        style={{ background: 'color-mix(in srgb, var(--color-warning, var(--color-accent)) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning, var(--color-accent)) 30%, transparent)' }}>
                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning, var(--color-accent))' }} />
                        <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--color-admin-text-sub)' }}>
                          {t('admin.challenges.completionStockWarn', 'Un premio físico aquí no tiene techo: si cumplen 30 personas, son 30 premios. Los puntos sí escalan solos.')}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  /* Se dice, porque el servidor solo reparte tres. */
                  <p className="text-[11px] leading-snug" style={{ color: 'var(--color-admin-text-faint)' }}>
                    {t('admin.challenges.onlyThreePlaces', 'Solo se premian los tres primeros puestos.')}
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-[12px] mt-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          </section>
        </div>

        {/* ── Panel derecho ── */}
        <div className="lg:sticky lg:top-0 self-start">
          <ChallengeFormRail
            form={form}
            cover={cover}
            rewards={rewardsForRail}
            exerciseLabel={exerciseLabel}
            participantsLabel={memberCount != null
              ? t('admin.challenges.nMembers', { count: memberCount, defaultValue: '{{count}} miembros' })
              : '—'}
            t={t}
            lang={lang}
          />
        </div>
      </div>
    </AdminModal>
  );
}
