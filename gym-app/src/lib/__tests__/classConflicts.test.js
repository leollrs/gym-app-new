import { describe, it, expect } from 'vitest';
import { findConflicts, projectSessions, calendarGrid, toMinutes } from '../admin/classConflicts';

// `day_of_week` es 0=DOMINGO en toda la app (Postgres, streaks, calendarios).
// El mockup venía indexado con lunes=0; copiarlo habría corrido todos los
// choques un día — el fallo más caro y más silencioso posible aquí.
const SUN = 0, MON = 1, TUE = 2, WED = 3;

const spinning = {
  id: 'c1', name: 'Spinning AM', is_active: true, duration_minutes: 45,
  trainer_id: 't-marisol',
  gym_class_schedules: [
    { day_of_week: MON, start_time: '09:00', end_time: '09:45', specific_date: null },
    { day_of_week: WED, start_time: '09:00', end_time: '09:45', specific_date: null },
  ],
};
const yoga = {
  id: 'c2', name: 'Yoga Suave', is_active: true, duration_minutes: 60,
  gym_class_trainers: [{ trainer: { id: 't-ana' } }],
  gym_class_schedules: [{ day_of_week: MON, start_time: '18:00', end_time: '19:00', specific_date: null }],
};
const ALL = [spinning, yoga];

describe('choques de horario', () => {
  it('sin solape no hay choque', () => {
    const slot = { day_of_week: MON, start_time: '11:00', specific_date: null };
    expect(findConflicts(slot, 60, ALL)).toHaveLength(0);
  });

  it('otro día no choca aunque sea la misma hora', () => {
    const slot = { day_of_week: TUE, start_time: '09:00', specific_date: null };
    expect(findConflicts(slot, 45, ALL)).toHaveLength(0);
  });

  it('solape parcial cuenta', () => {
    // 09:30–10:30 pisa el final de Spinning (09:00–09:45).
    const slot = { day_of_week: MON, start_time: '09:30', specific_date: null };
    const hits = findConflicts(slot, 60, ALL);
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('Spinning AM');
  });

  it('pegadas no chocan: acabar a las 09:45 y empezar a las 09:45 está bien', () => {
    const slot = { day_of_week: MON, start_time: '09:45', specific_date: null };
    expect(findConflicts(slot, 30, ALL)).toHaveLength(0);
  });

  it('el choque de INSTRUCTOR se marca y va primero', () => {
    // Misma hora que Spinning (Marisol) y que Yoga no; pero el instructor
    // elegido es Marisol, así que ese choque no se arregla cambiando de sala.
    const slot = { day_of_week: MON, start_time: '09:15', specific_date: null };
    const hits = findConflicts(slot, 45, ALL, { trainerIds: ['t-marisol'] });
    expect(hits[0].instructorClash).toBe(true);
    expect(hits[0].name).toBe('Spinning AM');
  });

  it('la clase que se está editando no choca consigo misma', () => {
    const slot = { day_of_week: MON, start_time: '09:00', specific_date: null };
    expect(findConflicts(slot, 45, ALL, { excludeClassId: 'c1' })).toHaveLength(0);
  });

  it('una clase inactiva no estorba', () => {
    const slot = { day_of_week: MON, start_time: '09:00', specific_date: null };
    const off = [{ ...spinning, is_active: false }];
    expect(findConflicts(slot, 45, off)).toHaveLength(0);
  });

  it('una fecha concreta choca con la recurrente de ese día de la semana', () => {
    // 2026-08-10 es lunes.
    expect(new Date('2026-08-10T00:00:00').getDay()).toBe(MON);
    const slot = { day_of_week: null, specific_date: '2026-08-10', start_time: '09:00' };
    expect(findConflicts(slot, 45, ALL)).toHaveLength(1);
  });
});

describe('proyección de sesiones', () => {
  const from = new Date(2026, 7, 7); // viernes 7 ago 2026

  it('una franja semanal da 4 sesiones en 4 semanas', () => {
    const s = projectSessions([{ day_of_week: MON, start_time: '09:00', specific_date: null }], { from });
    expect(s).toHaveLength(4);
    expect(s.every(x => x.date.getDay() === MON)).toBe(true);
  });

  it('tres días a la semana dan doce', () => {
    const slots = [MON, WED, SUN].map(d => ({ day_of_week: d, start_time: '18:00', specific_date: null }));
    expect(projectSessions(slots, { from })).toHaveLength(12);
  });

  it('una fecha suelta fuera de la ventana no cuenta', () => {
    const dentro = projectSessions([{ specific_date: '2026-08-20', start_time: '10:00' }], { from });
    const fuera = projectSessions([{ specific_date: '2026-12-01', start_time: '10:00' }], { from });
    expect(dentro).toHaveLength(1);
    expect(fuera).toHaveLength(0);
  });

  it('sale ordenado por fecha y luego por hora', () => {
    const slots = [
      { day_of_week: MON, start_time: '18:00', specific_date: null },
      { day_of_week: MON, start_time: '06:00', specific_date: null },
    ];
    const s = projectSessions(slots, { from });
    expect(toMinutes(s[0].slot.start_time)).toBeLessThan(toMinutes(s[1].slot.start_time));
  });
});

describe('la rejilla empieza en domingo', () => {
  it('35 celdas y la primera es domingo', () => {
    const g = calendarGrid(new Date(2026, 7, 7));
    expect(g).toHaveLength(35);
    expect(g[0].getDay()).toBe(SUN);
  });
});
