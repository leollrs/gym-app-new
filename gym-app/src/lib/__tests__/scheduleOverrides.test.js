import { describe, it, expect } from 'vitest';
import { dateKey, resolveForDate } from '../scheduleOverrides';

// 0 = DOMINGO en toda la app.
const MON = 1, WED = 3;
const schedule = { [MON]: { routineId: 'r-lunes' }, [WED]: { routineId: 'r-miercoles' } };

const d = (y, m, day) => new Date(y, m - 1, day);

describe('clave de fecha', () => {
  it('usa la fecha LOCAL, no UTC', () => {
    // 2026-08-07 a las 21:30 en Puerto Rico ya es día 8 en UTC. `toISOString()`
    // habría devuelto el 8 y la excepción se habría aplicado al día equivocado.
    expect(dateKey(new Date(2026, 7, 7, 21, 30))).toBe('2026-08-07');
  });

  it('rellena mes y día con cero', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('sin fecha, cadena vacía y sin reventar', () => {
    expect(dateKey(null)).toBe('');
  });
});

describe('qué toca ese día', () => {
  it('sin excepción manda la semana', () => {
    const r = resolveForDate(d(2026, 8, 10), schedule, {});   // lunes
    expect(r).toEqual({ routineId: 'r-lunes', isOverride: false, source: null });
  });

  it('un día sin nada devuelve null', () => {
    expect(resolveForDate(d(2026, 8, 11), schedule, {})).toBeNull(); // martes
  });

  // El punto entero: hoy hago otra cosa, y el miércoles que viene sigue siendo
  // el miércoles de siempre.
  it('la excepción GANA sobre lo recurrente ese día', () => {
    const ov = { '2026-08-12': { routineId: 'r-reto', source: 'challenge' } };
    const r = resolveForDate(d(2026, 8, 12), schedule, ov);    // miércoles
    expect(r).toEqual({ routineId: 'r-reto', isOverride: true, source: 'challenge' });
  });

  it('y NO se contagia al resto de los miércoles', () => {
    const ov = { '2026-08-12': { routineId: 'r-reto' } };
    const next = resolveForDate(d(2026, 8, 19), schedule, ov); // miércoles siguiente
    expect(next.routineId).toBe('r-miercoles');
    expect(next.isOverride).toBe(false);
  });

  it('puede poner algo en un día que estaba vacío', () => {
    const ov = { '2026-08-11': { routineId: 'r-reto' } };
    expect(resolveForDate(d(2026, 8, 11), schedule, ov).routineId).toBe('r-reto');
  });

  it('mapas ausentes no revientan la pantalla', () => {
    expect(resolveForDate(d(2026, 8, 10), null, null)).toBeNull();
    expect(resolveForDate(null, schedule, {})).toBeNull();
  });
});
