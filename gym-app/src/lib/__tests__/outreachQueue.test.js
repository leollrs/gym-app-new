import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const invoke = vi.fn();
const from = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    functions: { invoke: (...a) => invoke(...a) },
    from: (...a) => from(...a),
  },
  authHeader: async () => ({ Authorization: 'Bearer t' }),
}));
vi.mock('../logger', () => ({ default: { warn: () => {}, error: () => {} } }));
vi.mock('../adminAudit', () => ({ logAdminAction: async () => {} }));

const { enqueueOutreach, nudgeOutreachJob } = await import('../admin/outreachQueue');

const people = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, full_name: `M ${i}` }));

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); from.mockReset(); });

describe('encolar', () => {
  it('passes only the ids and returns the job', async () => {
    rpc.mockResolvedValue({ data: 'job-1', error: null });
    const { jobId } = await enqueueOutreach({ recipients: people(3), subject: 'S', body: 'B', audienceLabel: 'Todos' });
    expect(jobId).toBe('job-1');
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('enqueue_outreach_job');
    expect(args.p_recipients).toEqual(['m0', 'm1', 'm2']);
    expect(args.p_audience_label).toBe('Todos');
  });

  // LA trampa de este repo: el constructor de Supabase RESUELVE con `{error}`,
  // nunca lanza. Un `await` sin mirar `error` convierte un fallo de permisos en
  // un encolado que parece correcto y una campaña que no sale nunca.
  it('throws when the RPC resolves with an error instead of pretending it worked', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_authorised' } });
    await expect(enqueueOutreach({ recipients: people(1), subject: 'S', body: 'B' }))
      .rejects.toThrow('not_authorised');
  });

  it('refuses an empty audience before touching the network', async () => {
    await expect(enqueueOutreach({ recipients: [], subject: 'S', body: 'B' })).rejects.toThrow('no_recipients');
    expect(rpc).not.toHaveBeenCalled();
  });

  // El HTML se guarda con los merge tags LITERALES: se monta una vez para toda
  // la campaña y el procesador sustituye por destinatario.
  it('stores the html as given, tokens and all', async () => {
    rpc.mockResolvedValue({ data: 'job-2', error: null });
    await enqueueOutreach({ recipients: people(1), subject: 'S', body: 'B', html: '<p>Hola {{first_name}}</p>' });
    expect(rpc.mock.calls[0][1].p_html).toContain('{{first_name}}');
  });
});

describe('el empujón', () => {
  it('keeps pushing until the job reports done', async () => {
    let n = 0;
    invoke.mockImplementation(async () => {
      n++;
      return { data: { done: n >= 3, processed: 25 }, error: null };
    });
    await nudgeOutreachJob('job-1');
    expect(n).toBe(3);
  });

  // Si el empujón falla no pasa nada grave: el cron de cada minuto recoge el
  // trabajo. Lo que NO puede hacer es reventar y llevarse por delante el envío.
  it('gives up quietly on error — the cron will pick the job up', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(nudgeOutreachJob('job-1')).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('never loops forever', async () => {
    invoke.mockResolvedValue({ data: { done: false, processed: 25 }, error: null });
    await nudgeOutreachJob('job-1');
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(20);
  });

  // Dos lotes vacíos seguidos = no hay nada reclamable ahora (arriendo o espera
  // de un 429). Insistir no adelanta: el cron lo recoge cada minuto.
  it('stops after two empty batches instead of waiting out the lease', async () => {
    invoke.mockResolvedValue({ data: { done: false, processed: 0 }, error: null });
    await nudgeOutreachJob('job-1');
    expect(invoke).toHaveBeenCalledTimes(2);
  }, 20000);
});
