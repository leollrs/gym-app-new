// La rutina que propone el reto, y las dos maneras honestas de tomarla.
//
// Un reto que dice «llega a 1000 lbs» y no dice CÓMO deja al socio solo con un
// número. Con una rutina enganchada, el reto pasa de ser un marcador a ser un
// plan.
//
// TRES CAMINOS, PORQUE «AÑÁDELO A TU DÍA» SON TRES COSAS DISTINTAS:
//
//   · «Entrenarla ahora» — abre la sesión y ya. Cero escrituras.
//   · «Solo un día» — una excepción con fecha propia
//     (`workout_schedule_overrides`, migración 0712). Gana sobre la semana ese
//     día y no toca el resto. Además sobrevive a reinstalar un programa, que
//     borra la semana entera.
//   · «Todas las semanas» — eso es la semana de verdad, y hay que decir la
//     verdad incómoda: es todos los miércoles, y pisa lo que hubiera.
//
// Un solo botón ambiguo habría hecho que alguien se cargara su miércoles para
// siempre creyendo que lo ponía «para hoy».
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Dumbbell, Play, CalendarPlus, Check, AlertTriangle, Repeat, CalendarDays, ClipboardList } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { setOverride, dateKey } from '../lib/scheduleOverrides';
import { useToast } from '../contexts/ToastContext';

// 0 = DOMINGO, igual que Postgres y que el resto de la app.
const DOWS = [0, 1, 2, 3, 4, 5, 6];

export default function ChallengeRoutineCTA({ challenge, userId, gymId }) {
  // Las traducciones salen del contexto y no de props: hay tres tarjetas
  // distintas que montan esto, y encadenar `t`/`tc`/`lang` por las tres es
  // justo como se desincronizan.
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const lang = i18n.language;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [routine, setRoutine] = useState(null);
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState('once');   // 'once' | 'weekly'
  const [schedule, setSchedule] = useState({});   // dow → { routine_id, name }
  const [saving, setSaving] = useState(false);
  const routineId = challenge?.workout_template_id;
  const programId = challenge?.program_id;

  useEffect(() => {
    if (!routineId) return undefined;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('routines')
        .select('id, name, routine_exercises(count)')
        .eq('id', routineId)
        .maybeSingle();
      if (alive) setRoutine(data || null);
    })();
    return () => { alive = false; };
  }, [routineId]);

  // Qué hay ya en cada día. Se pide AL MONTAR y no al abrir el selector: el
  // aviso «Ya la tienes en tu semana» solo se pinta cuando el selector está
  // cerrado, así que cargarlo al abrirlo hacía imposible que apareciera nunca.
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('workout_schedule')
        .select('day_of_week, routine_id, routines(name)')
        .eq('profile_id', userId);
      if (!alive) return;
      const map = {};
      (data || []).forEach(r => { map[r.day_of_week] = { routine_id: r.routine_id, name: r.routines?.name }; });
      setSchedule(map);
    })();
    return () => { alive = false; };
  }, [userId]);

  if (!routineId && !programId) return null;

  const exCount = routine?.routine_exercises?.[0]?.count ?? null;
  const dayName = (dow) => {
    // 2026-02-01 fue domingo; sirve de ancla para sacar los nombres del idioma.
    const d = new Date(2026, 1, 1 + dow);
    return d.toLocaleDateString(lang, { weekday: 'long' });
  };

  const assignOnce = async (date) => {
    if (saving) return;
    setSaving(true);
    const { error } = await setOverride({
      profileId: userId, gymId, date, routineId,
      source: 'challenge', sourceId: challenge?.id || null,
    });
    setSaving(false);
    if (error) { showToast(error.message || tc('somethingWentWrong'), 'error'); return; }
    try { window.dispatchEvent(new Event('tugympr:schedule-changed')); } catch { /* noop */ }
    setPicking(false);
    showToast(t('challenges.routine.addedOnce', {
      day: date.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'short' }),
      defaultValue: 'Puesta para el {{day}}',
    }), 'success');
  };

  const assign = async (dow) => {
    if (saving) return;
    setSaving(true);
    const { error } = await supabase
      .from('workout_schedule')
      .upsert({ profile_id: userId, gym_id: gymId, day_of_week: dow, routine_id: routineId,
        updated_at: new Date().toISOString() }, { onConflict: 'profile_id,day_of_week' });
    setSaving(false);
    if (error) {
      showToast(error.message || tc('somethingWentWrong'), 'error');
      return;
    }
    // Las dos que escucha el resto de la app. Sin la segunda, el Panel y
    // Entrenos siguen enseñando la semana vieja hasta recargar.
    try {
      window.dispatchEvent(new Event('tugympr:schedule-changed'));
      window.dispatchEvent(new Event('tugympr:programs-changed'));
    } catch { /* noop */ }
    setPicking(false);
    showToast(t('challenges.routine.added', { day: dayName(dow), defaultValue: 'Puesta los {{day}}' }), 'success');
  };

  return (
    <div className="rounded-2xl p-3.5 mt-3" style={{
      background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)',
    }}>
      {routineId && (
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}>
          <Dumbbell size={17} className="text-[var(--color-accent,#2EC4C4)]" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)', letterSpacing: '.1em' }}>
            {t('challenges.routine.label', 'Rutina del reto')}
          </p>
          <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {routine?.name || t('challenges.routine.loading', 'Cargando…')}
          </p>
          {exCount != null && (
            <p className="text-[11.5px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('challenges.routine.exercises', { count: exCount, defaultValue: '{{count}} ejercicios' })}
            </p>
          )}
        </div>
      </div>
      )}

      {routineId && !picking ? (
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={() => navigate(`/session/${routineId}`)}
            className="flex-1 py-2.5 rounded-xl text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}>
            <Play size={14} /> {t('challenges.routine.trainNow', 'Entrenarla ahora')}
          </button>
          <button type="button" onClick={() => setPicking(true)}
            className="flex-1 py-2.5 rounded-xl text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-primary)' }}>
            <CalendarPlus size={14} /> {t('challenges.routine.schedule', 'Programarla')}
          </button>
        </div>
      ) : routineId ? (
        <div className="mt-3">
          {/* El modo primero. Es la diferencia entre «hoy hago esto» y «esto es
              mi miércoles a partir de ahora», y hasta ahora no había forma de
              decir la primera. */}
          <div className="inline-flex p-0.5 rounded-lg mb-3" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            {[['once', CalendarDays, t('challenges.routine.modeOnce', 'Solo un día')],
              ['weekly', Repeat, t('challenges.routine.modeWeekly', 'Todas las semanas')]].map(([m, icon, label]) => {
              const Icon = icon;
              return (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-bold transition-colors"
                  style={{
                    background: mode === m ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
                    color: mode === m ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  }}>
                  <Icon size={12} /> {label}
                </button>
              );
            })}
          </div>

          {mode === 'once' ? (
            <>
              <p className="text-[12px] font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                {t('challenges.routine.whichDate', '¿Qué día?')}
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {Array.from({ length: 8 }, (_, i) => {
                  const d = new Date(); d.setDate(d.getDate() + i);
                  return (
                    <button key={dateKey(d)} type="button" disabled={saving} onClick={() => assignOnce(d)}
                      className="py-2 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50 flex flex-col items-center gap-0.5"
                      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-primary)' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>
                        {i === 0 ? t('challenges.routine.today', 'Hoy')
                          : i === 1 ? t('challenges.routine.tomorrow', 'Mañana')
                            : d.toLocaleDateString(lang, { weekday: 'short' })}
                      </span>
                      <span className="tabular-nums">{d.getDate()}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11.5px] mt-2.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {t('challenges.routine.onceHint', 'Solo ese día. Tu semana no cambia, y lo que tuvieras ese día vuelve al siguiente.')}
              </p>
            </>
          ) : (
          <>
          <p className="text-[12px] font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            {t('challenges.routine.whichDay', '¿Qué día?')}
          </p>
          <div className="grid grid-cols-7 gap-1.5">
            {DOWS.map(dow => {
              const taken = schedule[dow];
              return (
                <button key={dow} type="button" disabled={saving} onClick={() => assign(dow)}
                  aria-label={dayName(dow)}
                  className="h-[42px] rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50 flex flex-col items-center justify-center gap-0.5"
                  style={{
                    background: 'var(--color-bg-card)',
                    border: `1px solid ${taken ? 'color-mix(in srgb, var(--color-warning, #F59E0B) 45%, transparent)' : 'var(--color-border-default)'}`,
                    color: 'var(--color-text-primary)',
                  }}>
                  <span>{dayName(dow).slice(0, 3)}</span>
                  {taken && <span className="w-1 h-1 rounded-full" style={{ background: 'var(--color-warning, #F59E0B)' }} />}
                </button>
              );
            })}
          </div>

          {/* Lo que nadie dice y todo el mundo descubre tarde. */}
          <div className="flex gap-2 mt-2.5 px-3 py-2.5 rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--color-warning, #F59E0B) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning, #F59E0B) 26%, transparent)' }}>
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning, #F59E0B)' }} />
            <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {t('challenges.routine.recurringWarn', 'Se queda fija ese día de todas las semanas, y sustituye lo que tuvieras. Los días marcados ya tienen rutina.')}
            </p>
          </div>

          </>
          )}

          <button type="button" onClick={() => setPicking(false)}
            className="w-full mt-2 py-2.5 rounded-xl text-[12.5px] font-bold"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-muted)' }}>
            {tc('cancel')}
          </button>
        </div>
      ) : null}

      {/* Programa entero. Lleva al detalle del programa en Entrenos, que ya trae
          el flujo de cambio de dos pasos: si el socio tiene uno corriendo, se lo
          dice antes de tocarle nada — y ahora además puede pausarlo en vez de
          darlo de baja. */}
      {programId && (
        <button type="button" onClick={() => navigate(`/workouts?program=${programId}`)}
          className="w-full mt-2.5 py-2.5 rounded-xl text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-primary)' }}>
          <ClipboardList size={14} /> {t('challenges.routine.openProgram', 'Ver el programa del reto')}
        </button>
      )}

      {routineId && schedule && Object.values(schedule).some(v => v?.routine_id === routineId) && !picking && (
        <p className="flex items-center gap-1.5 text-[11.5px] mt-2" style={{ color: 'var(--color-success)' }}>
          <Check size={12} /> {t('challenges.routine.alreadyInWeek', 'Ya la tienes en tu semana')}
        </p>
      )}
    </div>
  );
}
