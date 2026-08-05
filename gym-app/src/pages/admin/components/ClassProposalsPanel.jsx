import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Clock, X, Plus, AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { Avatar } from '../../../components/admin';

/**
 * ClassProposalsPanel — las propuestas de clase de los entrenadores, por fin
 * visibles.
 *
 * Hasta la migración 0692 una propuesta se escribía en admin_audit_log y se
 * anunciaba por notificación, pero no había NINGUNA pantalla que la leyera: el
 * admin recibía un aviso sobre algo que no podía ver ni aceptar ni rechazar, y
 * el entrenador nunca sabía en qué había quedado.
 *
 * Va arriba de la pestaña Clases y no en una pestaña propia a propósito: la
 * notificación ya enruta a /admin/classes (0535:154), y una pestaña que casi
 * siempre está vacía no la abre nadie.
 */
export default function ClassProposalsPanel({ gymId, onCreateFromProposal, t, tc }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);

  const k = (key, fallback, opts) =>
    t(`admin.classProposals.${key}`, { defaultValue: fallback, ...(opts || {}) });

  const queryKey = ['admin', 'class-proposals', gymId];

  const { data: proposals = [], isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_proposals')
        .select('id, name, description, suggested_day, suggested_time, duration_minutes, created_at, trainer_id, trainer:trainer_id(id, full_name, avatar_url)')
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50);
      // Antes de aplicar la 0692 la tabla no existe, y eso NO es un fallo que
      // merezca una banda roja en la página de Clases de todos los gimnasios:
      // es simplemente "esta función todavía no está encendida". 42P01 =
      // undefined_table; PGRST205 = PostgREST no la encuentra en su caché de
      // esquema. Mismo criterio que isMissingColumnError en batchedSelect.
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205'
            || /does not exist|schema cache/i.test(error.message || '')) {
          return [];
        }
        // Cualquier otro error SÍ se lanza: "no hay propuestas" y "no se pudo
        // cargar" se dibujan igual y significan lo contrario.
        throw error;
      }
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 60_000,
  });

  const dismiss = async (proposal) => {
    setBusyId(proposal.id);
    try {
      const { data, error } = await supabase.rpc('decide_class_proposal', {
        p_proposal_id: proposal.id,
        p_status: 'dismissed',
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'failed');
      showToast(k('dismissed', 'Proposal dismissed'), 'success');
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      logger.error('ClassProposalsPanel: dismiss failed:', err);
      showToast(k('actionFailed', "Couldn't update the proposal"), 'error');
    }
    setBusyId(null);
  };

  // Nada que enseñar y nada roto: el panel desaparece del todo.
  if (!isError && proposals.length === 0) return null;

  // Domingo = 0, como en toda la app. `tc` es el traductor del namespace
  // `common`, que es donde viven days.* — con `t` (namespace `pages`) la clave
  // no resolvería y saldría el literal.
  const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayLabel = (d) =>
    (d === null || d === undefined) ? null : tc(`days.${DAY_KEYS[d]}`);

  return (
    <div
      className="rounded-[14px] overflow-hidden mb-5"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }}
      >
        <Lightbulb size={15} style={{ color: 'var(--color-accent)' }} />
        <span className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
          {k('title', 'Class proposals from your trainers')}
        </span>
        {proposals.length > 0 && (
          <span
            className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {proposals.length}
          </span>
        )}
      </div>

      {isError ? (
        <div className="px-4 py-6 text-center">
          <AlertTriangle size={22} className="mx-auto mb-2" style={{ color: 'var(--color-danger)' }} />
          <p className="text-[12.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>
            {k('loadFailed', "Couldn't load proposals")}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 px-3 py-1.5 rounded-[9px] text-[12px] font-bold"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-admin-text)', border: '1px solid var(--color-admin-border)' }}
          >
            {k('retry', 'Try again')}
          </button>
        </div>
      ) : (
        proposals.map((p, i) => {
          const day = dayLabel(p.suggested_day);
          const time = p.suggested_time ? String(p.suggested_time).slice(0, 5) : null;
          return (
            <div
              key={p.id}
              className="flex items-start gap-3 px-4 py-3"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
            >
              <Avatar name={p.trainer?.full_name} src={p.trainer?.avatar_url} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--color-admin-text)' }}>
                  {p.name}
                </p>
                <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                  {k('proposedBy', 'Proposed by {{name}}', { name: p.trainer?.full_name || '—' })}
                </p>
                {/* El día, la hora y la duración: los tres datos que el
                    entrenador escribió y que hasta ahora no salían por ningún
                    sitio — ni en el cuerpo de la notificación, que solo lleva
                    el nombre. */}
                {(day || time || p.duration_minutes) && (
                  <p className="text-[11.5px] mt-1 inline-flex items-center gap-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
                    <Clock size={11} />
                    {[day, time, p.duration_minutes ? k('minutes', '{{n}} min', { n: p.duration_minutes }) : null]
                      .filter(Boolean).join(' · ')}
                  </p>
                )}
                {p.description && (
                  <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: 'var(--color-admin-text-sub)' }}>
                    {p.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => dismiss(p)}
                  aria-label={k('dismiss', 'Dismiss')}
                  title={k('dismiss', 'Dismiss')}
                  className="grid place-items-center rounded-[9px] border transition-colors hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                  style={{ width: 32, height: 32, borderColor: 'var(--color-admin-border)', background: 'var(--color-bg-card)' }}
                >
                  <X size={14} style={{ color: 'var(--color-admin-text-sub)' }} />
                </button>
                <button
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => onCreateFromProposal(p)}
                  className="inline-flex items-center gap-1.5 rounded-[9px] font-bold transition-colors disabled:opacity-50"
                  style={{
                    padding: '8px 13px',
                    fontSize: 12.5,
                    color: 'var(--color-accent)',
                    background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
                  }}
                >
                  <Plus size={13} strokeWidth={2} /> {k('createClass', 'Create class')}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
