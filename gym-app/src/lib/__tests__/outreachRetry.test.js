import { describe, it, expect, vi, beforeEach } from 'vitest';

// La cadena de módulos de `outreachSender` arrastra media app (supabase,
// notificaciones, auditoría). Se sustituye lo justo para poder observar QUÉ
// invocaciones se hacen y qué devuelven.
const invoke = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: (...a) => invoke(...a) },
    from: () => ({ insert: async () => ({ error: null }) }),
  },
  authHeader: async () => ({ Authorization: 'Bearer t' }),
}));
vi.mock('../notifications', () => ({ sendNotification: async () => {} }));
vi.mock('../logger', () => ({ default: { warn: () => {}, error: () => {} } }));
vi.mock('../adminAudit', () => ({ logAdminAction: async () => {} }));
vi.mock('../admin/outreachPersonalization', () => ({
  fetchMemberStats: async () => ({}),
  tokensNeeded: () => [],
}));

const { sendOutreach } = await import('../admin/outreachSender');

/** Un error tal y como lo devuelve `functions.invoke`: el cuerpo va en context. */
const fnError = (status, body) => ({
  context: { status, json: async () => body },
  message: body?.error || 'error',
});

const people = (n) => Array.from({ length: n }, (_, i) => ({
  id: `m${i}`, full_name: `Miembro ${i}`, email: `m${i}@x.com`, phone: null,
}));

const run = (recipients) => sendOutreach({
  gymId: 'g1', recipients, channels: { email: true }, subject: 'Asunto', body: 'Cuerpo',
});

beforeEach(() => { invoke.mockReset(); });

describe('reintento en 429 del proveedor', () => {
  // Un 429 de Resend significa "vas muy rápido", no "este correo es imposible".
  // Antes se contaba como fallo y a ese miembro no le llegaba nada nunca.
  it('retries a provider rate limit and lands the send', async () => {
    let calls = 0;
    invoke.mockImplementation(async () => {
      calls++;
      // send-admin-email devuelve 502 con el estado del proveedor dentro.
      if (calls === 1) return { data: null, error: fnError(502, { error: 'refused', providerStatus: 429 }) };
      return { data: { success: true }, error: null };
    });
    const r = await run(people(1));
    expect(r.email.sent).toBe(1);
    expect(r.email.failed).toBe(0);
    expect(r.email.retried).toBe(1);
    expect(calls).toBe(2);
  }, 15000);

  it('gives up after a bounded number of tries instead of looping forever', async () => {
    invoke.mockResolvedValue({ data: null, error: fnError(502, { error: 'refused', providerStatus: 429 }) });
    const r = await run(people(1));
    expect(r.email.failed).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(r.email.reasons.rate_limited).toBe(1);
  }, 15000);

  // Un miembro dado de baja o inexistente no mejora por insistir.
  it('does not retry a plain client error', async () => {
    invoke.mockResolvedValue({ data: null, error: fnError(404, { error: 'member_not_found' }) });
    const r = await run(people(1));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(r.email.reasons.member_not_found).toBe(1);
  });
});

describe('cortar el lote cuando el fallo condena al resto', () => {
  // ESTE es el cambio que importa. El tope horario va a fallar igual en los 19
  // que quedan: seguir adelante no envía ni uno más, solo convierte un problema
  // legible en diecinueve fallos mudos.
  it('stops on the hourly cap instead of burning through the audience', async () => {
    let calls = 0;
    invoke.mockImplementation(async () => {
      calls++;
      if (calls <= 2) return { data: { success: true }, error: null };
      return { data: null, error: fnError(429, { error: 'admin_hourly_limit_exceeded', limit: 5000 }) };
    });
    const r = await run(people(20));
    expect(r.aborted).toEqual({ reason: 'admin_hourly_limit_exceeded', channel: 'email' });
    expect(invoke.mock.calls.length).toBeLessThan(20);
    expect(r.email.sent).toBe(2);
  });

  it('reports who was left out so the retry can target them', async () => {
    invoke.mockResolvedValue({ data: null, error: fnError(429, { error: 'admin_hourly_limit_exceeded' }) });
    const r = await run(people(20));
    expect(r.pending.length).toBeGreaterThan(0);
    expect(r.pending.every((id) => id.startsWith('m'))).toBe(true);
    // Ni un enviado ni un id repetido: la lista sirve para reintentar tal cual.
    expect(new Set(r.pending).size).toBe(r.pending.length);
  });

  it('stops on an expired session too — every remaining call would 401', async () => {
    invoke.mockResolvedValue({ data: null, error: fnError(401, { error: 'Unauthorized' }) });
    const r = await run(people(20));
    expect(r.aborted.reason).toBe('Unauthorized');
    expect(invoke.mock.calls.length).toBeLessThan(20);
  });
});

describe('motivos', () => {
  // "12 fallidos" a secas no dice si hay que verificar el dominio, esperar o
  // arreglar las direcciones. Y `logger.warn` es no-op en producción, así que
  // el resumen es el único sitio donde puede aparecer.
  it('groups failures by cause instead of one mute counter', async () => {
    let calls = 0;
    invoke.mockImplementation(async () => {
      calls++;
      if (calls % 2) return { data: null, error: fnError(400, { error: 'invalid_email' }) };
      return { data: null, error: fnError(500, { error: 'boom' }) };
    });
    const r = await run(people(4));
    expect(r.email.failed).toBe(4);
    expect(r.email.reasons.invalid_email).toBe(2);
    expect(r.email.reasons.boom).toBe(2);
  });

  it('counts an opt-out as skipped, never as sent', async () => {
    invoke.mockResolvedValue({ data: { sent: false, reason: 'opted_out' }, error: null });
    const r = await run(people(3));
    expect(r.email.sent).toBe(0);
    expect(r.skipped.optedOut).toBe(3);
  });
});
