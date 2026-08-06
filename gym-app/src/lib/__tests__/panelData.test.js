import { describe, it, expect } from 'vitest';
import { readResult, panelState, statValue } from '../admin/panelData';

/**
 * EL BUG QUE ESTAS PRUEBAS CONGELAN
 *
 * `if (error) return []` sobre la vista de regalos (mig 0694). Sin la migración
 * aplicada, la pantalla enseñaba «0 regalos enviados» — indistinguible de una
 * campaña que no ha regalado nada. Un hueco se pregunta; un cero se cree.
 */
describe('leer una respuesta sin tragarse el error', () => {
  it('un error NO es una lista vacía', () => {
    const r = readResult({ code: '42P01', message: 'relation does not exist' }, null);
    expect(r.unavailable).toBe(true);
    expect(r.rows).toEqual([]);
    expect(r.error).toBeTruthy();
  });

  it('una lista vacía de verdad no se marca como ilegible', () => {
    const r = readResult(null, []);
    expect(r.unavailable).toBe(false);
    expect(r.rows).toEqual([]);
  });

  it('pasa los datos tal cual', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(readResult(null, rows).rows).toBe(rows);
  });

  // PostgREST manda `data: null` JUNTO al error. Comprobar los datos antes que
  // el error reintroduce exactamente la confusión que esto viene a quitar.
  it('mira el error antes que los datos', () => {
    expect(readResult({ message: 'boom' }, null).unavailable).toBe(true);
    expect(readResult({ message: 'boom' }, []).unavailable).toBe(true);
  });

  it('un null sin error es una lista vacía, no un fallo', () => {
    expect(readResult(null, null)).toEqual({ rows: [], unavailable: false, error: null });
  });
});

describe('los tres estados de un bloque', () => {
  it('distingue ilegible, vacío y con datos', () => {
    expect(panelState(readResult({ message: 'x' }, null))).toBe('unavailable');
    expect(panelState(readResult(null, []))).toBe('empty');
    expect(panelState(readResult(null, [{ id: 1 }]))).toBe('data');
  });

  // El corazón del asunto: si estos dos coincidieran, el panel volvería a
  // mentir. Se comprueba explícitamente y no por inspección.
  it('«no disponible» y «vacío» NUNCA son el mismo estado', () => {
    expect(panelState(readResult({ message: 'x' }, null)))
      .not.toBe(panelState(readResult(null, [])));
  });

  it('sin resultado se considera no disponible, no vacío', () => {
    expect(panelState(undefined)).toBe('unavailable');
    expect(panelState(null)).toBe('unavailable');
  });
});

describe('el número que se pinta', () => {
  const sum = (rows) => rows.reduce((n, r) => n + r.n, 0);

  it('suma cuando se puede leer', () => {
    expect(statValue(readResult(null, [{ n: 2 }, { n: 3 }]), sum)).toBe(5);
  });

  it('un cero real sale como cero', () => {
    expect(statValue(readResult(null, []), sum)).toBe(0);
  });

  // Y este es el que importa: ilegible NO puede salir como 0, o el guion que
  // pusimos arriba no serviría de nada.
  it('lo ilegible sale como guion, nunca como cero', () => {
    const v = statValue(readResult({ message: 'x' }, null), sum);
    expect(v).toBe('—');
    expect(v).not.toBe(0);
  });

  it('admite otro marcador de hueco', () => {
    expect(statValue(readResult({ message: 'x' }, null), sum, 'n/d')).toBe('n/d');
  });
});
