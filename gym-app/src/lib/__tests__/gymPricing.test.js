import { describe, it, expect } from 'vitest';
import { centsToInput, inputToCents, formatMoney, offerLive } from '../admin/gymPricing';

describe('dinero: centavos enteros, ida y vuelta', () => {
  it('round-trips what an admin actually types', () => {
    expect(inputToCents('45')).toBe(4500);
    expect(inputToCents('45.00')).toBe(4500);
    expect(inputToCents('45.50')).toBe(4550);
    expect(inputToCents('0.99')).toBe(99);
    expect(centsToInput(4500)).toBe('45');
    expect(centsToInput(4550)).toBe('45.50');
  });

  // En Puerto Rico se teclean las dos. Sin esto, "45,50" daba NaN → null, o sea
  // que el precio se convertía en «Consultar» sin decir nada.
  it('accepts the comma as a decimal separator', () => {
    expect(inputToCents('45,50')).toBe(4550);
  });

  // `null` es «Consultar» —el plan corporativo se cotiza— y NO es cero. Un cero
  // dice «gratis», que es una promesa distinta.
  it('keeps “on request” and “free” apart', () => {
    expect(inputToCents('')).toBeNull();
    expect(inputToCents('   ')).toBeNull();
    expect(inputToCents('0')).toBe(0);
    expect(centsToInput(null)).toBe('');
    expect(centsToInput(0)).toBe('0');
  });

  it('refuses junk and negatives instead of storing them', () => {
    expect(inputToCents('abc')).toBeNull();
    expect(inputToCents('-10')).toBeNull();
  });

  // Enteros justamente para esto: en coma flotante 0.1+0.2 no es 0.3, y en un
  // precio ese redondeo se ve.
  it('never leaks a floating-point tail', () => {
    expect(inputToCents('19.99')).toBe(1999);
    expect(centsToInput(1999)).toBe('19.99');
    expect(centsToInput(inputToCents('0.07'))).toBe('0.07');
  });

  it('formats with the currency and falls back rather than throwing', () => {
    expect(formatMoney(4500, 'USD', 'en', '—')).toContain('45');
    expect(formatMoney(null, 'USD', 'es', 'Consultar')).toBe('Consultar');
    expect(formatMoney(4500, 'NOPE', 'en', '—')).toBe('$45.00');
  });
});

describe('vigencia de una oferta', () => {
  // Los nombres son los de `gym_offers` (0185), no unos inventados: la tabla ya
  // existía y la ven los miembros en MyGym.
  const base = { is_public: true, is_active: true, valid_from: null, valid_until: null };
  const TODAY = '2026-08-15';

  it('shows an offer with no dates', () => {
    expect(offerLive(base, TODAY)).toBe(true);
  });

  it('shows one inside its window, including both ends', () => {
    expect(offerLive({ ...base, valid_from: '2026-08-01', valid_until: '2026-08-31' }, TODAY)).toBe(true);
    expect(offerLive({ ...base, valid_from: TODAY, valid_until: TODAY }, TODAY)).toBe(true);
  });

  // LO QUE ESTO EXISTE PARA EVITAR: la promo de agosto puesta en diciembre.
  it('hides one whose end date has passed', () => {
    expect(offerLive({ ...base, valid_until: '2026-08-14' }, TODAY)).toBe(false);
  });

  it('hides one that has not started yet', () => {
    expect(offerLive({ ...base, valid_from: '2026-08-16' }, TODAY)).toBe(false);
  });

  // Publicar y estar activo son cosas distintas: una oferta puede seguir vigente
  // en recepción y no querer publicarse.
  it('hides one that is not published, and one that is not active', () => {
    expect(offerLive({ ...base, is_public: false }, TODAY)).toBe(false);
    expect(offerLive({ ...base, is_active: false }, TODAY)).toBe(false);
  });

  // Se comparan CADENAS ISO a propósito. `new Date('2026-08-31')` se interpreta
  // como UTC y en Puerto Rico (UTC-4) retrocede un día: una oferta que termina
  // el 31 dejaría de verse el 30 por la tarde.
  it('compares ISO strings so the timezone cannot move the last day', () => {
    expect(offerLive({ ...base, valid_until: '2026-08-31' }, '2026-08-31')).toBe(true);
    expect(offerLive({ ...base, valid_until: '2026-08-31' }, '2026-09-01')).toBe(false);
  });

  it('survives a missing row instead of throwing', () => {
    expect(offerLive(null, TODAY)).toBe(false);
  });
});
