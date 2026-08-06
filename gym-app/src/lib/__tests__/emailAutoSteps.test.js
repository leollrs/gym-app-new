import { describe, it, expect } from 'vitest';
import { AUTO_STEPS, SERVER_EMITTED_STEPS, scopeForStep, stepLabel } from '../admin/emailAutoSteps';

/**
 * EL FALLO QUE ESTAS PRUEBAS EXISTEN PARA IMPEDIR
 *
 * La interfaz ofrecía «Win-back día 7» y guardaba `winback_day_7`. El servidor
 * emitía `day_7` a secas. La plantilla se busca por `.eq('step_key', …)` sin
 * filtro de familia, así que:
 *
 *   1. los tres momentos de recuperación NUNCA encontraban plantilla, y
 *   2. `day_7`, `day_30` y `day_60` los emitían LAS DOS familias, o sea que
 *      quien canceló hace una semana recibía el correo de bienvenida.
 *
 * Ninguna de las dos cosas daba error: `no_template` responde 200 y no escribe
 * fila. Nada en el build, el lint o los tipos lo veía. Lo único que puede
 * verlo es comparar las dos listas.
 */
describe('los momentos que ofrece la interfaz existen en el servidor', () => {
  it('AUTO_STEPS es exactamente lo que el servidor emite, sin sobras ni faltas', () => {
    const emitted = [
      ...SERVER_EMITTED_STEPS.lifecycle,
      ...SERVER_EMITTED_STEPS.winback,
      ...SERVER_EMITTED_STEPS.classes,
    ];
    expect([...AUTO_STEPS].sort()).toEqual([...emitted].sort());
  });

  it('no hay claves repetidas', () => {
    expect(new Set(AUTO_STEPS).size).toBe(AUTO_STEPS.length);
  });

  // EL NÚCLEO DEL BUG. winback_steps() emite day_7/30/60, idénticas a las de
  // lifecycle_steps(). Solo el prefijo las separa, y la búsqueda de plantilla no
  // tiene ningún otro criterio para distinguirlas.
  it('ninguna clave de recuperación choca con una de ciclo de vida', () => {
    const life = new Set(SERVER_EMITTED_STEPS.lifecycle);
    for (const k of SERVER_EMITTED_STEPS.winback) {
      expect(life.has(k), `"${k}" colisiona con un paso del ciclo de vida`).toBe(false);
    }
  });

  it('toda clave de recuperación lleva el prefijo que pone fire_winback_email', () => {
    for (const k of SERVER_EMITTED_STEPS.winback) {
      expect(k.startsWith('winback_')).toBe(true);
    }
  });

  // Las tres que emite winback_steps(), ni una más ni una menos: 0402:77.
  it('están los tres pasos de recuperación que emite winback_steps()', () => {
    expect(SERVER_EMITTED_STEPS.winback).toEqual(
      ['winback_day_7', 'winback_day_30', 'winback_day_60'],
    );
  });

  // day_5 y day_60 los añadió la 0420 sobre la 0400. Leer solo la 0400 hace
  // creer que estas dos claves están muertas, y no lo están.
  it('incluye day_5 y day_60, que amplió la 0420', () => {
    expect(SERVER_EMITTED_STEPS.lifecycle).toContain('day_5');
    expect(SERVER_EMITTED_STEPS.lifecycle).toContain('day_60');
  });
});

describe('la familia de cada momento', () => {
  it('reparte cada clave a su generador', () => {
    expect(scopeForStep('day_1')).toBe('lifecycle');
    expect(scopeForStep('day_60')).toBe('lifecycle');
    expect(scopeForStep('winback_day_7')).toBe('winback');
    expect(scopeForStep('classes')).toBe('classes');
    expect(scopeForStep(null)).toBeNull();
  });

  // El ámbito decide qué variables tienen sentido: a alguien que canceló no se
  // le puede prometer «tu plan de hoy». Si un winback_* se leyera como
  // lifecycle, send-automated-email dejaría de vaciar today_plan_*.
  it('ningún momento de recuperación se lee como ciclo de vida', () => {
    for (const k of SERVER_EMITTED_STEPS.winback) {
      expect(scopeForStep(k)).toBe('winback');
    }
    for (const k of SERVER_EMITTED_STEPS.lifecycle) {
      expect(scopeForStep(k)).toBe('lifecycle');
    }
  });
});

describe('etiquetas', () => {
  it('cae a la clave cruda antes que a una cadena vacía', () => {
    const t = (_key, fallback) => fallback;
    expect(stepLabel(t, 'winback_day_30')).toBe('winback_day_30');
  });

  it('usa la traducción cuando existe', () => {
    const t = (key) => (key === 'admin.emailTemplates.step.day_7' ? 'Día 7' : '');
    expect(stepLabel(t, 'day_7')).toBe('Día 7');
  });
});
