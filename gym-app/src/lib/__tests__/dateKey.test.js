// El fallo que este módulo existe para impedir solo aparece de noche.
//
// `toISOString()` convierte a UTC antes de cortar la fecha. En Puerto Rico
// (UTC-4) eso significa que a partir de las 8 de la tarde «hoy» pasa a ser
// mañana. Un panel que se mira por la mañana sale bien todos los días, y el
// que lo mire a las nueve de la noche ve la semana corrida y las reservas de
// esa misma tarde contadas como pasadas.
//
// Por eso el test fija la zona horaria: sin eso, en un CI que corre en UTC la
// diferencia entre lo correcto y lo incorrecto no existe y el test pasa igual
// estando el código mal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dateKey, todayKey, startOfDay } from '../dateKey';

const PR = 'America/Puerto_Rico';
let prevTZ;
beforeAll(() => { prevTZ = process.env.TZ; process.env.TZ = PR; });
afterAll(() => { process.env.TZ = prevTZ; });

const inPR = () => new Date().toLocaleString('en-US', { timeZone: PR });

describe('la fecha local, no la de UTC', () => {
  it('a las nueve de la noche sigue siendo hoy', () => {
    // 7 de agosto, 21:00 en Puerto Rico = 8 de agosto 01:00 UTC.
    const night = new Date('2026-08-08T01:00:00Z');
    expect(dateKey(night)).toBe('2026-08-07');
    // Y esto es exactamente lo que hacía el código viejo:
    expect(night.toISOString().slice(0, 10)).toBe('2026-08-08');
  });

  it('a mediodía coinciden — por eso nadie lo veía', () => {
    const noon = new Date('2026-08-07T16:00:00Z'); // 12:00 en PR
    expect(dateKey(noon)).toBe('2026-08-07');
    expect(noon.toISOString().slice(0, 10)).toBe('2026-08-07');
  });

  it('cruza el fin de mes por el lado correcto', () => {
    const night = new Date('2026-09-01T02:30:00Z'); // 31 ago, 22:30 en PR
    expect(dateKey(night)).toBe('2026-08-31');
  });

  it('acepta una cadena y devuelve vacío ante basura', () => {
    expect(dateKey('2026-08-07T00:00:00')).toBe('2026-08-07');
    expect(dateKey(null)).toBe('');
    expect(dateKey('mañana')).toBe('');
  });

  it('todayKey es el día que se está viviendo', () => {
    const d = new Date(inPR());
    expect(todayKey()).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  });
});

describe('startOfDay, que es lo que salva la aritmética de semanas', () => {
  it('deja el día intacto y la hora a cero', () => {
    const s = startOfDay(new Date('2026-08-08T01:00:00Z')); // 7 ago 21:00 PR
    expect(dateKey(s)).toBe('2026-08-07');
    expect([s.getHours(), s.getMinutes(), s.getSeconds()]).toEqual([0, 0, 0]);
  });

  // El caso real: buscar el domingo de la semana restando `getDay()`. Sin
  // normalizar, el Date arrastra las 21:00 y la semana entera salía corrida un
  // día al formatearla en UTC.
  it('el domingo de esa semana es el domingo de esa semana', () => {
    const friNight = startOfDay(new Date('2026-08-08T01:00:00Z')); // vie 7 ago
    const sun = new Date(friNight);
    sun.setDate(sun.getDate() - sun.getDay());
    expect(dateKey(sun)).toBe('2026-08-02');
    const sat = new Date(sun);
    sat.setDate(sat.getDate() + 6);
    expect(dateKey(sat)).toBe('2026-08-08');
  });
});
