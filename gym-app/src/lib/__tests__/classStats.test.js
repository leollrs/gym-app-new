import { describe, it, expect } from 'vitest';
import {
  calcClassStats, duplicateSlots, slotFill, fillTone, weeklySessions, isPastBooking,
} from '../admin/classStats';

const TODAY = new Date(2026, 7, 8, 12, 0, 0);   // 8 ago 2026, mediodía
const b = (over = {}) => ({ booking_date: '2026-08-01', status: 'confirmed', attended: false, rating: null, ...over });

describe('métricas de la clase', () => {
  it('sin reservas no inventa porcentajes', () => {
    const s = calcClassStats([], 20, TODAY);
    expect(s.total).toBe(0);
    expect(s.avgFill).toBeNull();
    expect(s.noShowRate).toBe(0);
  });

  // El denominador es lo que más se equivoca aquí: contra el total, las reservas
  // FUTURAS diluyen el no-show y el número sale bajo justo cuando peor está.
  it('el no-show se mide contra lo que YA pasó, no contra el total', () => {
    const rows = [
      b({ attended: true }),                       // pasada, vino
      b(),                                         // pasada, no vino → no-show
      b({ booking_date: '2026-09-01' }),           // futura: no cuenta
      b({ booking_date: '2026-09-01' }),           // futura: no cuenta
    ];
    const s = calcClassStats(rows, 20, TODAY);
    expect(s.confirmedPast).toBe(2);
    expect(s.noShows).toBe(1);
    expect(s.noShowRate).toBe(50);   // contra el total habría dado 25
  });

  it('una cancelación no es un no-show', () => {
    const s = calcClassStats([b({ status: 'cancelled' })], 20, TODAY);
    expect(s.noShows).toBe(0);
    expect(s.cancellationRate).toBe(100);
  });

  it('la ocupación es reservas por sesión sobre el aforo', () => {
    const rows = [
      b({ booking_date: '2026-08-01' }), b({ booking_date: '2026-08-01' }),
      b({ booking_date: '2026-08-03' }), b({ booking_date: '2026-08-03' }),
    ];
    // 4 reservas / 2 sesiones / 10 de aforo = 20 %
    expect(calcClassStats(rows, 10, TODAY).avgFill).toBe(20);
  });

  it('solo puntúan los que asistieron', () => {
    const rows = [b({ attended: true, rating: 5 }), b({ attended: true, rating: 4 }), b({ rating: 1 })];
    expect(calcClassStats(rows, 10, TODAY).avgRating).toBe('4.5');
  });

  it('sin aforo no hay ocupación que calcular', () => {
    expect(calcClassStats([b()], 0, TODAY).avgFill).toBeNull();
  });
});

// El caso que hacía mentir a la pantalla: un gimnasio donde nadie hace
// check-in ni marca la clase tiene `attended` entero a false. La cuenta es
// correcta —todo el mundo «faltó»— pero lo que dice no es verdad.
describe('¿alguien marca la asistencia?', () => {
  it('nadie la marca: no-show sale 100 % siendo mentira, y hay que poder saberlo', () => {
    const rows = [b(), b(), b()];               // tres pasadas, ninguna marcada
    const s = calcClassStats(rows, 20, TODAY);
    expect(s.noShowRate).toBe(100);             // la cuenta, tal cual
    expect(s.attendanceTracked).toBe(false);    // la señal para no enseñarla
    expect(s.confirmedPast).toBe(3);            // sí hubo sesiones que juzgar
  });

  it('con una sola marcada ya hay de dónde medir', () => {
    const s = calcClassStats([b({ attended: true }), b(), b()], 20, TODAY);
    expect(s.attendanceTracked).toBe(true);
    expect(s.noShowRate).toBe(67);
  });

  it('sin nada pasado tampoco se finge que se mide', () => {
    const s = calcClassStats([b({ booking_date: '2026-09-01' })], 20, TODAY);
    expect(s.attendanceTracked).toBe(false);
    expect(s.confirmedPast).toBe(0);            // la pantalla enseña «aún sin datos»
  });
});

describe('horarios duplicados', () => {
  const s = (id, day, time) => ({ id, day_of_week: day, start_time: time, specific_date: null });

  it('mismo día y misma hora es un duplicado', () => {
    const dups = duplicateSlots([s('a', 1, '09:00'), s('b', 1, '09:00'), s('c', 3, '09:00')]);
    expect(dups).toHaveLength(1);
    expect(dups[0].map(x => x.id)).toEqual(['a', 'b']);
  });

  it('la misma hora en días distintos no lo es', () => {
    expect(duplicateSlots([s('a', 1, '09:00'), s('b', 2, '09:00')])).toEqual([]);
  });

  it('«09:00» y «09:00:00» son la misma hora', () => {
    expect(duplicateSlots([s('a', 1, '09:00'), s('b', 1, '09:00:00')])).toHaveLength(1);
  });

  it('dos fechas sueltas iguales también cuentan', () => {
    const d = (id) => ({ id, day_of_week: null, specific_date: '2026-08-20', start_time: '10:00' });
    expect(duplicateSlots([d('a'), d('b')])).toHaveLength(1);
  });

  it('una fecha suelta no choca con la recurrente del mismo día de la semana', () => {
    const rec = s('a', 4, '10:00');
    const one = { id: 'b', day_of_week: null, specific_date: '2026-08-20', start_time: '10:00' };
    expect(duplicateSlots([rec, one])).toEqual([]);
  });

  it('sin franjas, sin duplicados', () => {
    expect(duplicateSlots([])).toEqual([]);
    expect(duplicateSlots(null)).toEqual([]);
  });
});

describe('ocupación por franja', () => {
  it('el aforo propio de la franja manda sobre el de la clase', () => {
    expect(slotFill(5, { override_capacity: 10 }, 30)).toBe(50);
    expect(slotFill(5, {}, 10)).toBe(50);
  });

  it('sin aforo no se pinta un porcentaje inventado', () => {
    expect(slotFill(5, {}, 0)).toBeNull();
  });

  it('el color va de lleno a vacío', () => {
    expect(fillTone(90)).toBe('var(--color-success)');
    expect(fillTone(10)).toBe('var(--color-danger)');
    expect(fillTone(null)).toBe('var(--color-admin-text-faint)');
  });
});

describe('sesiones por semana', () => {
  it('cuenta solo las recurrentes: una fecha suelta no se repite', () => {
    const rows = [
      { day_of_week: 1, specific_date: null }, { day_of_week: 3, specific_date: null },
      { day_of_week: null, specific_date: '2026-08-20' },
    ];
    expect(weeklySessions(rows)).toBe(2);
  });
});

describe('¿ya pasó?', () => {
  it('el día cuenta entero: una sesión de hoy todavía no ha pasado', () => {
    expect(isPastBooking({ booking_date: '2026-08-08' }, TODAY)).toBe(false);
    expect(isPastBooking({ booking_date: '2026-08-07' }, TODAY)).toBe(true);
  });
});
