import { describe, it, expect } from 'vitest';
import {
  missingConfig, buildChallengePayload, endFromStart, daysBetween, startAt, typeMeta,
  rewardSlots, isCompletion,
} from '../admin/challengeConfig';

const base = {
  name: 'Guerra de Volumen', type: 'volume', format: 'competitive',
  description: '', cover_preset: 'power', start_date: '2026-08-10', days: 14,
  exercise_id: null, exercise_ids: [], milestone_target: '', team_size: null, scoring_metric: null,
};
const build = (over = {}) => buildChallengePayload({ ...base, ...over }, { rewardData: null });

describe('qué le falta a cada tipo para poder puntuar', () => {
  it('los tres simples no necesitan nada', () => {
    ['consistency', 'volume', 'pr_count'].forEach(type =>
      expect(missingConfig({ ...base, type })).toEqual([]));
  });

  // Este es EL fallo: se podía crear un reto de levantamiento sin ejercicio, y
  // entonces no puntuaba nunca.
  it('levantamiento específico SIN ejercicio no puede crearse', () => {
    expect(missingConfig({ ...base, type: 'specific_lift' })).toEqual(['exercise_id']);
  });

  it('levantamiento específico CON ejercicio sí', () => {
    expect(missingConfig({ ...base, type: 'specific_lift', exercise_id: 'ex-1' })).toEqual([]);
  });

  it('equipo sin tamaño de equipo no puede crearse', () => {
    expect(missingConfig({ ...base, type: 'team' })).toEqual(['team_size']);
    expect(missingConfig({ ...base, type: 'team', team_size: 4 })).toEqual([]);
  });

  it('un tipo inventado se rechaza entero', () => {
    expect(missingConfig({ ...base, type: 'telepatía' })).toEqual(['type']);
    expect(typeMeta('telepatía')).toBeNull();
  });
});

describe('la meta la manda el FORMATO, no el tipo', () => {
  it('cumplimiento sin meta no tiene condición de victoria', () => {
    expect(missingConfig({ ...base, format: 'completion' })).toEqual(['milestone_target']);
    expect(missingConfig({ ...base, format: 'completion', milestone_target: 12 })).toEqual([]);
  });

  it('una meta de cero no vale como meta', () => {
    expect(missingConfig({ ...base, format: 'completion', milestone_target: 0 }))
      .toEqual(['milestone_target']);
  });

  // El club competitivo —«quién tiene la suma más alta»— es un reto legítimo y
  // NO lleva meta. Antes era imposible: el tipo la exigía siempre.
  it('un club COMPETITIVO no necesita meta, solo levantamientos y plan', () => {
    expect(missingConfig({ ...base, type: 'milestone' })).toEqual(['exercise_ids', 'plan']);
    expect(missingConfig({ ...base, type: 'milestone', exercise_ids: ['a'], workout_template_id: 'r1' })).toEqual([]);
  });

  it('un club DE CUMPLIMIENTO necesita las tres cosas', () => {
    expect(missingConfig({ ...base, type: 'milestone', format: 'completion' }))
      .toEqual(['exercise_ids', 'plan', 'milestone_target']);
  });

  it('cualquier métrica puede ser de cumplimiento — «ven 12 veces» es consistencia + meta', () => {
    const f = { ...base, type: 'consistency', format: 'completion', milestone_target: 12 };
    expect(missingConfig(f)).toEqual([]);
    expect(build(f).milestone_target).toBe(12);
  });
});

describe('cuándo el reto tiene que decir CÓMO se entrena', () => {
  const club = { ...base, type: 'milestone', exercise_ids: ['a'] };

  // «Llega a 1000 lbs» sin decir cómo es un número, no un reto.
  it('el club no se puede crear sin rutina ni programa', () => {
    expect(missingConfig(club)).toEqual(['plan']);
  });

  it('vale una rutina O un programa: cualquiera de los dos le dice qué hacer', () => {
    expect(missingConfig({ ...club, workout_template_id: 'r1' })).toEqual([]);
    expect(missingConfig({ ...club, program_id: 'p1' })).toEqual([]);
  });

  it('los tipos que se explican solos no lo piden', () => {
    ['consistency', 'volume', 'pr_count', 'check_in'].forEach(type =>
      expect(missingConfig({ ...base, type })).toEqual([]));
  });

  // Una plantilla puede subir el listón donde el tipo no lo hace: «21 días de
  // transformación» sin programa es un titular sin plan.
  it('una plantilla puede exigir PROGRAMA aunque el tipo no lo pida', () => {
    const f = { ...base, type: 'consistency', requiresProgram: true };
    expect(missingConfig(f)).toEqual(['program_id']);
    expect(missingConfig({ ...f, program_id: 'p1' })).toEqual([]);
    // Y una rutina no lo sustituye: se pidió un programa.
    expect(missingConfig({ ...f, workout_template_id: 'r1' })).toEqual(['program_id']);
  });

  it('ni «plan» ni «requiresProgram» llegan a la fila — no son columnas', () => {
    const p = build({ type: 'milestone', exercise_ids: ['a'], workout_template_id: 'r1', requiresProgram: true });
    expect(p.plan).toBeUndefined();
    expect(p.requiresProgram).toBeUndefined();
    expect(p.workout_template_id).toBe('r1');
  });
});

describe('lo que se guarda', () => {
  it('el ejercicio LLEGA a la fila — que era justo lo que no pasaba', () => {
    expect(build({ type: 'specific_lift', exercise_id: 'ex-1' }).exercise_id).toBe('ex-1');
  });

  it('el levantamiento cae a volumen si no se escoge cómo se mide', () => {
    expect(build({ type: 'specific_lift', exercise_id: 'ex-1' }).scoring_metric).toBe('volume');
    expect(build({ type: 'specific_lift', exercise_id: 'ex-1', scoring_metric: '1rm' }).scoring_metric).toBe('1rm');
  });

  it('una métrica que el puntuador no entiende no se guarda', () => {
    expect(build({ type: 'specific_lift', exercise_id: 'e', scoring_metric: 'vibras' }).scoring_metric).toBe('volume');
    expect(build({ type: 'team', team_size: 3, scoring_metric: 'vibras' }).scoring_metric).toBe('consistency');
  });

  it('el equipo guarda su tamaño y su métrica', () => {
    const p = build({ type: 'team', team_size: 4, scoring_metric: 'volume' });
    expect(p.team_size).toBe(4);
    expect(p.scoring_metric).toBe('volume');
  });

  it('un formato inventado cae a competitivo, nunca se guarda tal cual', () => {
    expect(build({ format: 'anarquía' }).format).toBe('competitive');
  });

  it('en competitivo la meta se guarda NULL aunque quede escrita en el formulario', () => {
    expect(build({ format: 'competitive', milestone_target: 999 }).milestone_target).toBeNull();
  });

  // Al editar y cambiar el tipo, los ajustes viejos tienen que morir: si no, la
  // fila dice «consistencia» y arrastra un exercise_id de cuando era otra cosa.
  it('cambiar de tipo limpia los ajustes del tipo anterior', () => {
    const p = build({ type: 'consistency', exercise_id: 'ex-viejo', team_size: 4, exercise_ids: ['a'] });
    expect(p.exercise_id).toBeNull();
    expect(p.team_size).toBeNull();
    expect(p.exercise_ids).toBeNull();
    expect(p.scoring_metric).toBeNull();
  });
});

describe('cuántos premios pide cada formato', () => {
  it('competitivo pide tres, que es lo que el servidor reparte', () => {
    expect(rewardSlots({ format: 'competitive' })).toBe(3);
  });

  it('cumplimiento pide uno: o cumpliste o no, no hay tercer puesto', () => {
    expect(rewardSlots({ format: 'completion' })).toBe(1);
    expect(isCompletion({ format: 'completion' })).toBe(true);
  });
});

describe('fechas', () => {
  it('empieza a medianoche del día escogido, no a la hora de crearlo', () => {
    const s = startAt('2026-08-10');
    expect([s.getHours(), s.getMinutes()]).toEqual([0, 0]);
    expect(s.getDate()).toBe(10);
  });

  it('siete días cuentan el primero: del 10 al 16, no al 17', () => {
    const e = endFromStart('2026-08-10', 7);
    expect(e.getDate()).toBe(16);
    expect(e.getMonth()).toBe(7);
  });

  it('termina a las 11:59 de la noche del último día', () => {
    const e = endFromStart('2026-08-10', 14);
    expect([e.getHours(), e.getMinutes(), e.getSeconds()]).toEqual([23, 59, 59]);
  });

  it('cruza el fin de mes sin despeinarse', () => {
    const e = endFromStart('2026-08-25', 14);
    expect(e.getMonth()).toBe(8); // septiembre
    expect(e.getDate()).toBe(7);
  });

  it('editar recupera la duración de las fechas guardadas', () => {
    const start = startAt('2026-08-10');
    const end = endFromStart('2026-08-10', 21);
    expect(daysBetween(start.toISOString(), end.toISOString())).toBe(21);
  });

  it('sin fecha de inicio no hay fecha de fin', () => {
    expect(endFromStart('', 7)).toBeNull();
    expect(startAt(null)).toBeNull();
  });
});
