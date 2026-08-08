import { describe, it, expect } from 'vitest';
import { toReachSets, computeReach } from '../admin/outreachReach';

// La caché de React Query se persiste a localStorage (main.jsx, 24 h). Todo lo
// que devuelve un queryFn tiene que sobrevivir a `JSON.parse(JSON.stringify(x))`.
// Devolver un Set no sobrevive: sale `{}`, sin `.has`, y la página entera cae
// con «facts.push.has is not a function» — y no en la primera carga, sino al
// volver, que es lo que lo hace difícil de ver.
const roundTrip = (x) => JSON.parse(JSON.stringify(x));

const MEMBERS = [
  { id: 'a', phone: '+1787' },
  { id: 'b', phone: null },
  { id: 'c', phone: '+1939' },
];

describe('alcance · sobrevive a la caché persistida', () => {
  it('los hechos siguen siendo hechos después del viaje por localStorage', () => {
    const fromServer = { pushIds: ['a', 'b'], emailOkIds: ['a', 'c'] };
    const facts = toReachSets(roundTrip(fromServer));

    const reach = computeReach(MEMBERS, facts, { push: true, email: true, sms: true });
    expect(reach.per.push).toBe(2);
    expect(reach.per.email).toBe(2);
    expect(reach.per.sms).toBe(2);
    expect(reach.unique).toBe(3);
  });

  it('un Set persistido (la caché rota de antes) no tumba la página', () => {
    // Así es EXACTAMENTE como quedaba en localStorage la versión con el bug.
    const broken = roundTrip({ push: new Set(['a']), emailOk: new Set(['a']) });
    expect(broken).toEqual({ push: {}, emailOk: {} });

    const facts = toReachSets(broken);
    expect(() => computeReach(MEMBERS, facts, { push: true })).not.toThrow();
    expect(computeReach(MEMBERS, facts, { push: true }).per.push).toBe(0);
  });

  it('sin hechos todavía, cuenta cero en vez de reventar', () => {
    const facts = toReachSets(undefined);
    const reach = computeReach(MEMBERS, facts, { push: true, sms: true });
    expect(reach.per.push).toBe(0);
    expect(reach.per.sms).toBe(2); // el teléfono viene en la fila, no en los hechos
  });

  it('in-app llega a todos y no depende de ningún hecho', () => {
    const reach = computeReach(MEMBERS, toReachSets({}), { inApp: true });
    expect(reach.per.inApp).toBe(3);
    expect(reach.missing).toHaveLength(0);
  });
});
