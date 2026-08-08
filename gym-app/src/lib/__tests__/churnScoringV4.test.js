import { describe, it, expect } from 'vitest';
import { calculateChurnScore } from '../churn/riskScoring.js';
import { buildRhythm } from '../churn/rhythm.js';

// El modelo de churn es lo más importante de la app y no tenía una sola prueba.
// Estos casos SON la especificación: cada uno es un socio concreto al que v3
// puntuaba mal, y la razón por la que se reescribió.

const TODAY = 20000; // día natural arbitrario; todo es relativo a él

/** Genera días de visita cada `everyN` días, terminando `gapDays` antes de hoy. */
function series({ everyN, spanDays, gapDays }) {
  const days = [];
  const last = TODAY - gapDays;
  for (let d = last; d > last - spanDays; d -= everyN) days.push(d);
  return days;
}

function score(visitDays, extra = {}) {
  return calculateChurnScore({
    rhythm: buildRhythm(visitDays, TODAY),
    accountAgeDays: 400,
    appActivity: { baseline: null, recent: 0 },
    ...extra,
  });
}

describe('v4 · cada socio contra sí mismo', () => {
  it('el constante sale sano', () => {
    // 3×/semana desde siempre, vino ayer.
    const r = score(series({ everyN: 2, spanDays: 88, gapDays: 1 }));
    expect(r.tier).toBe('low');
    expect(r.primaryDriver).toBe('healthy');
  });

  it('el que se está apagando SE VE, aunque vino anteayer', () => {
    // v3 le daba 20 (Riesgo bajo): la media de 4 semanas todavía arrastraba las
    // semanas buenas y la recencia decía "vino hace nada". Es el caso más
    // recuperable que existe y era invisible.
    const base = series({ everyN: 2, spanDays: 69, gapDays: 21 }); // ~3.5×/sem antes
    const recent = [TODAY - 2, TODAY - 9, TODAY - 16];             // ~1×/sem ahora
    const r = score([...base, ...recent]);
    expect(r.score).toBeGreaterThanOrEqual(25);
    expect(['drop', 'both', 'volume']).toContain(r.primaryDriver);
  });

  it('12 días sin venir es una alarma para quien viene a diario', () => {
    // v3: 30 (Medio) — y no saltaba a Crítico hasta el día 30, cuando ya no hay
    // nada que intervenir.
    const r = score(series({ everyN: 2, spanDays: 88, gapDays: 12 }));
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(r.primaryDriver).toBe('gap');
  });

  it('30 días sin venir NO es alarma para quien viene una vez al mes', () => {
    // v3 le clavaba 95 Crítico por el override de los 30 días. Ese señor no ha
    // faltado a nada: ese es su ritmo de siempre.
    const r = score(series({ everyN: 21, spanDays: 88, gapDays: 30 }));
    expect(r.tier).not.toBe('critical');
    expect(r.score).toBeLessThan(70);
  });

  it('el veterano YA NO es inmune', () => {
    // v3 multiplicaba por 0,85 el subtotal de un socio de 12+ meses, sobre un
    // máximo de 81: su techo era 69, o sea que no podía ser Crítico ni
    // desapareciendo del todo. Aquí la antigüedad no toca el número.
    const r = score(series({ everyN: 2, spanDays: 60, gapDays: 28 }), { tenureMonths: 14 });
    expect(r.tier).toBe('critical');
  });

  it('no usar la app no penaliza', () => {
    // Viene a diario y nunca ha tocado el móvil: la lente de app no existe para
    // él, ni siquiera como cero que diluya.
    const r = score(series({ everyN: 1, spanDays: 88, gapDays: 1 }), {
      appActivity: { baseline: null, recent: 0 },
    });
    expect(r.score).toBe(0);
    expect(r.signals.app_withdrawal).toBeUndefined();
  });

  it('dejar de usar la app es un susurro, no una alarma', () => {
    const r = score(series({ everyN: 2, spanDays: 88, gapDays: 1 }), {
      appActivity: { baseline: 20, recent: 0 },
    });
    expect(r.signals.app_withdrawal.score).toBeGreaterThan(0);
    expect(r.tier).toBe('low'); // por sí sola nunca pasa de Medio bajo
  });
});

describe('v4 · estados', () => {
  it('el fantasma de tres años sale de la cola', () => {
    // v3 lo dejaba en 78 Alto PARA SIEMPRE, ordenando por encima de gente
    // recuperable, porque «nunca activó» se evaluaba antes que «perdido».
    const r = score([], { accountAgeDays: 1100 });
    expect(r.tier).toBe('churned');
  });

  it('matriculado hace 30 días sin pisar el gym: riesgo, no «sin datos»', () => {
    const r = score([], { accountAgeDays: 30 });
    expect(r.primaryDriver).toBe('never_activated');
    expect(r.score).toBeGreaterThanOrEqual(55);
    expect(r.tier).not.toBe('critical'); // por debajo de quien SÍ vino y se apagó
  });

  it('un roster recién importado no marca a nadie el día uno', () => {
    const r = score([], { accountAgeDays: 5, tenureMonths: 36 });
    expect(r.state).toBe('insufficient_data');
  });

  it('la pausa saca al socio del cálculo', () => {
    const r = score(series({ everyN: 2, spanDays: 60, gapDays: 40 }), { isPaused: true });
    expect(r.tier).toBe('paused');
    expect(r.score).toBe(0);
  });
});

describe('v4 · el ritmo se adapta solo', () => {
  it('mismo hueco, alarmas distintas según el socio', () => {
    const gap = 10;
    const box = score(series({ everyN: 1, spanDays: 88, gapDays: gap }));      // ~5×/sem
    const boutique = score(series({ everyN: 7, spanDays: 88, gapDays: gap })); // ~1×/sem
    // Diez días es una eternidad para el primero y nada para el segundo, con la
    // MISMA fórmula y sin calibrar un solo peso por gimnasio.
    expect(box.score).toBeGreaterThan(boutique.score);
  });

  it('sin historial suficiente, la confianza lo dice', () => {
    const r = score([TODAY - 3, TODAY - 10]);
    expect(r.confidence).toBe('low');
  });
});
