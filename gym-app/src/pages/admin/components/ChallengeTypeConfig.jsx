// Lo que cada tipo de reto necesita para poder puntuar.
//
// Este bloque no existía, y por eso `specific_lift` y `milestone` eran opciones
// muertas: se creaban sin ejercicio y el que puntúa los descartaba en silencio
// durante las dos semanas enteras del reto.
//
// Solo se ofrece lo que alguien LEE de verdad. No hay control de «duración
// mínima del entreno» ni de «promedio contra suma del equipo» porque nada en el
// servidor los consume: un interruptor que no hace nada es peor que no tenerlo.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Check, Info } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { LIFT_METRICS, TEAM_METRICS, TEAM_SIZES, isCompletion, metricUnit } from '../../../lib/admin/challengeConfig';

function useExercises(enabled) {
  return useQuery({
    queryKey: ['exercises-challenge-picker'],
    queryFn: async () => {
      const { data } = await supabase
        .from('exercises')
        .select('id, name, name_es, muscle_group')
        .eq('is_active', true)
        .order('name');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

const exLabel = (ex, lang) => (lang?.startsWith('es') && ex.name_es) || ex.name;

function Block({ title, children }) {
  return (
    <div className="rounded-xl p-3.5 mt-3" style={{ border: '1px solid var(--color-admin-border)', background: 'var(--color-admin-panel)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-admin-text-muted)', letterSpacing: '.09em' }}>{title}</p>
      {children}
    </div>
  );
}

function Chip({ on, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="h-[32px] px-3 rounded-lg text-[12px] font-bold transition-colors"
      style={{
        background: on ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-bg-deep)',
        border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-admin-border)'}`,
        color: on ? 'var(--color-accent)' : 'var(--color-admin-text-muted)',
      }}>{children}</button>
  );
}

const fieldStyle = {
  background: 'var(--color-bg-deep)',
  border: '1px solid var(--color-admin-border)',
  color: 'var(--color-admin-text)',
};

/**
 * La meta de un reto de cumplimiento.
 *
 * Vive junto a «qué se mide» y no en su propia sección porque un número suelto
 * no dice nada: «12» solo significa algo cuando al lado pone «entrenos».
 */
function CompletionTarget({ form, set, t }) {
  const unit = t(`admin.challenges.unit_${metricUnit(form)}`);
  return (
    <div className="rounded-xl p-3.5 mt-3" style={{
      border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
      background: 'color-mix(in srgb, var(--color-success) 6%, transparent)',
    }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-admin-text-muted)', letterSpacing: '.09em' }}>
        {t('admin.challenges.cfgTargetTitle', 'La meta')}
      </p>
      <div className="flex items-center gap-2">
        <input type="text" inputMode="numeric"
          value={form.milestone_target === '' || form.milestone_target == null ? '' : String(form.milestone_target)}
          onChange={e => {
            const digits = e.target.value.replace(/\D/g, '');
            set('milestone_target', digits === '' ? '' : Math.min(parseInt(digits, 10), 1000000));
          }}
          placeholder="12"
          className="w-[120px] rounded-lg px-3 py-2.5 text-[15px] font-bold outline-none tabular-nums"
          style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
        <span className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text-sub)' }}>{unit}</span>
      </div>
      <p className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--color-admin-text-muted)' }}>
        {t('admin.challenges.cfgTargetHint', {
          n: form.milestone_target || '—', unit,
          defaultValue: 'Cobra todo el que llegue a {{n}} {{unit}}. No importa quién llegue primero.',
        })}
      </p>
    </div>
  );
}

function TypeBlock({ form, set, t, lang }) {
  const type = form.type;
  const needsExercises = type === 'specific_lift' || type === 'milestone';
  const { data: exercises = [] } = useExercises(needsExercises);
  const [q, setQ] = useState('');

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? exercises.filter(e => exLabel(e, lang).toLowerCase().includes(needle))
      : exercises;
    return list.slice(0, 8);
  }, [exercises, q, lang]);

  // ── Un solo ejercicio ──
  if (type === 'specific_lift') {
    const chosen = exercises.find(e => e.id === form.exercise_id);
    return (
      <Block title={t('admin.challenges.cfgLiftTitle', 'Define el levantamiento')}>
        {chosen ? (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={fieldStyle}>
            <span className="w-[28px] h-[28px] rounded-lg grid place-items-center flex-shrink-0"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}>
              <Check size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-bold truncate" style={{ color: 'var(--color-admin-text)' }}>{exLabel(chosen, lang)}</p>
              <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.challenges.cfgLiftOnly', 'Solo cuenta este ejercicio, registrado en la app')}
              </p>
            </div>
            <button type="button" onClick={() => { set('exercise_id', null); setQ(''); }}
              aria-label={t('admin.challenges.cfgClear', 'Quitar')}
              className="ml-auto w-[28px] h-[28px] grid place-items-center rounded-lg flex-shrink-0"
              style={{ color: 'var(--color-admin-text-muted)' }}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-admin-text-muted)' }} />
              <input value={q} onChange={e => setQ(e.target.value)} autoComplete="off"
                placeholder={t('admin.challenges.cfgSearchExercise', 'Buscar ejercicio del catálogo…')}
                className="w-full rounded-lg pl-9 pr-3 py-2.5 text-[13px] outline-none" style={fieldStyle} />
            </div>
            <div className="mt-1.5 space-y-1 max-h-[200px] overflow-y-auto">
              {hits.map(e => (
                <button key={e.id} type="button" onClick={() => { set('exercise_id', e.id); setQ(''); }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors"
                  style={{ background: 'var(--color-bg-deep)' }}>
                  <span className="text-[12.5px] truncate" style={{ color: 'var(--color-admin-text)' }}>{exLabel(e, lang)}</span>
                  <span className="text-[10.5px] flex-shrink-0" style={{ color: 'var(--color-admin-text-faint)' }}>{e.muscle_group}</span>
                </button>
              ))}
              {hits.length === 0 && (
                <p className="text-[12px] px-3 py-2" style={{ color: 'var(--color-admin-text-faint)' }}>{t('admin.challenges.cfgNoResults', 'Sin resultados')}</p>
              )}
            </div>
            <p className="flex items-start gap-1.5 text-[11px] mt-2 leading-snug" style={{ color: 'var(--color-warning, var(--color-accent))' }}>
              <Info size={12} className="flex-shrink-0 mt-0.5" />
              {t('admin.challenges.cfgLiftRequired', 'Sin ejercicio el reto no puede puntuar: nadie sabría qué levantar.')}
            </p>
          </>
        )}

        <p className="text-[11.5px] font-bold mt-3 mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
          {t('admin.challenges.cfgWhatCounts', '¿Qué cuenta?')}
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {LIFT_METRICS.map(m => (
            <Chip key={m} on={(form.scoring_metric || 'volume') === m} onClick={() => set('scoring_metric', m)}>
              {t(`admin.challenges.liftMetric_${m}`, m === 'volume' ? 'Volumen levantado' : 'Récords nuevos')}
            </Chip>
          ))}
        </div>
      </Block>
    );
  }

  // ── Equipos ──
  if (type === 'team') {
    return (
      <Block title={t('admin.challenges.cfgTeamTitle', 'Cómo funcionan los equipos')}>
        <p className="text-[11.5px] font-bold mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
          {t('admin.challenges.cfgTeamSize', 'Cuántos caben por equipo')}
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {TEAM_SIZES.map(n => (
            <Chip key={n} on={form.team_size === n} onClick={() => set('team_size', n)}>{n}</Chip>
          ))}
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.challenges.cfgTeamSizeHint', 'Los miembros arman su propio equipo e invitan a quien quieran hasta llenarlo.')}
        </p>

        <p className="text-[11.5px] font-bold mt-3 mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
          {t('admin.challenges.cfgTeamMetric', '¿Qué suma cada miembro?')}
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {TEAM_METRICS.map(m => (
            <Chip key={m} on={(form.scoring_metric || 'consistency') === m} onClick={() => set('scoring_metric', m)}>
              {t(`admin.challengeTypes.${m}`)}
            </Chip>
          ))}
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.challenges.cfgTeamSum', 'La puntuación del equipo es la suma de sus miembros.')}
        </p>
      </Block>
    );
  }

  // ── Club (meta compartida) ──
  if (type === 'milestone') {
    const chosen = exercises.filter(e => (form.exercise_ids || []).includes(e.id));
    const toggle = (id) => {
      const cur = form.exercise_ids || [];
      set('exercise_ids', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
    };
    return (
      <Block title={t('admin.challenges.cfgClubTitle', 'Define el club')}>
        <p className="text-[11.5px] font-bold mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
          {t('admin.challenges.cfgClubLifts', 'Qué levantamientos suman')}
        </p>
        {chosen.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {chosen.map(e => (
              <button key={e.id} type="button" onClick={() => toggle(e.id)}
                className="inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-lg text-[11.5px] font-bold"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}>
                {exLabel(e, lang)} <X size={11} />
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-admin-text-muted)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} autoComplete="off"
            placeholder={t('admin.challenges.cfgSearchExercise', 'Buscar ejercicio del catálogo…')}
            className="w-full rounded-lg pl-9 pr-3 py-2.5 text-[13px] outline-none" style={fieldStyle} />
        </div>
        <div className="mt-1.5 space-y-1 max-h-[170px] overflow-y-auto">
          {hits.filter(e => !(form.exercise_ids || []).includes(e.id)).map(e => (
            <button key={e.id} type="button" onClick={() => toggle(e.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left"
              style={{ background: 'var(--color-bg-deep)' }}>
              <span className="text-[12.5px] truncate" style={{ color: 'var(--color-admin-text)' }}>{exLabel(e, lang)}</span>
              <span className="text-[10.5px] flex-shrink-0" style={{ color: 'var(--color-admin-text-faint)' }}>{e.muscle_group}</span>
            </button>
          ))}
        </div>

        <p className="text-[11px] mt-2.5 leading-snug" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.challenges.cfgClubHint', 'Se suma el mejor récord de cada uno de estos levantamientos.')}
        </p>
      </Block>
    );
  }

  // ── Los tres simples: nada que configurar, pero sí que explicar ──
  return (
    <Block title={t('admin.challenges.cfgCounts', 'Qué cuenta')}>
      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-admin-text-sub)' }}>
        {t(`admin.challenges.cfgCounts_${type}`, {
          consistency: 'Cada entreno terminado en la app suma 1. Gana quien más veces entrene.',
          volume: 'Suma el peso × repeticiones de cada serie completada, de todos los entrenos del período.',
          pr_count: 'Cada récord personal nuevo suma 1. Solo cuentan los récords registrados en la app.',
        }[type] || '')}
      </p>
    </Block>
  );
}

export default function ChallengeTypeConfig(props) {
  return (
    <>
      <TypeBlock {...props} />
      {isCompletion(props.form) && <CompletionTarget {...props} />}
    </>
  );
}
