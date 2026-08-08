import { describe, it, expect } from 'vitest';
import { groupSlots, slotEnd } from '../admin/classScheduleHelpers';

// 0 = DOMINGO en toda la app (Postgres, rachas, calendarios).
const SUN = 0, MON = 1, TUE = 2, WED = 3, FRI = 5;

const rec = (day, start, end, trainer_id = null) =>
  ({ id: `${day}-${start}`, day_of_week: day, start_time: start, end_time: end, specific_date: null, trainer_id });

describe('agrupar franjas', () => {
  it('tres días a la misma hora son UN horario, no tres', () => {
    const g = groupSlots([rec(MON, '09:00', '09:45'), rec(WED, '09:00', '09:45'), rec(FRI, '09:00', '09:45')], 45);
    expect(g).toHaveLength(1);
    expect(g[0].days).toEqual([MON, WED, FRI]);
    expect(g[0].rows).toHaveLength(3);
  });

  it('los días salen ordenados aunque lleguen al revés', () => {
    const g = groupSlots([rec(FRI, '09:00', '09:45'), rec(SUN, '09:00', '09:45'), rec(WED, '09:00', '09:45')], 45);
    expect(g[0].days).toEqual([SUN, WED, FRI]);
  });

  it('horas distintas no se juntan', () => {
    const g = groupSlots([rec(MON, '09:00', '09:45'), rec(MON, '13:00', '13:45')], 45);
    expect(g).toHaveLength(2);
    expect(g.map(x => x.start_time)).toEqual(['09:00', '13:00']); // ordenado por hora
  });

  it('mismo día y hora pero distinta DURACIÓN son horarios distintos', () => {
    const g = groupSlots([rec(MON, '09:00', '09:45'), rec(WED, '09:00', '10:00')], 45);
    expect(g).toHaveLength(2);
  });

  it('el instructor separa: dos personas a la misma hora no son un solo horario', () => {
    const g = groupSlots([rec(MON, '09:00', '09:45', 't-ana'), rec(WED, '09:00', '09:45', 't-luis')], 45);
    expect(g).toHaveLength(2);
    expect(g.map(x => x.trainer_id).sort()).toEqual(['t-ana', 't-luis']);
  });

  it('las fechas sueltas NUNCA se agrupan entre sí', () => {
    const one = { id: 'a', day_of_week: null, specific_date: '2026-08-20', start_time: '10:00', end_time: '11:00' };
    const two = { id: 'b', day_of_week: null, specific_date: '2026-08-27', start_time: '10:00', end_time: '11:00' };
    const same = { id: 'c', day_of_week: null, specific_date: '2026-08-20', start_time: '10:00', end_time: '11:00' };
    const g = groupSlots([one, two, same], 60);
    expect(g).toHaveLength(3);
    expect(g.every(x => x.kind === 'date')).toBe(true);
  });

  it('«09:00:00» y «09:00» son la misma hora', () => {
    const g = groupSlots([rec(MON, '09:00:00', '09:45:00'), rec(TUE, '09:00', '09:45')], 45);
    expect(g).toHaveLength(1);
    expect(g[0].start_time).toBe('09:00');
  });

  it('cada grupo conserva las filas que hay que borrar en la base', () => {
    const g = groupSlots([rec(MON, '07:00', '08:00'), rec(TUE, '07:00', '08:00')], 60);
    expect(g[0].rows.map(r => r.slot.id)).toEqual(['1-07:00', '2-07:00']);
    expect(g[0].rows.map(r => r.index)).toEqual([0, 1]);
  });

  it('sin franjas, sin grupos', () => {
    expect(groupSlots([], 60)).toEqual([]);
    expect(groupSlots(null, 60)).toEqual([]);
  });
});

describe('hora de fin real', () => {
  it('manda la end_time guardada, no la duración de la clase', () => {
    // Una clase de 60 con una franja guardada de 45: pintar 60 sería mentir.
    expect(slotEnd(rec(MON, '09:00', '09:45'), 60)).toBe('09:45');
  });

  it('si la fila no trae fin, se calcula con la duración', () => {
    expect(slotEnd({ start_time: '09:00', end_time: null }, 30)).toBe('09:30');
  });
});
