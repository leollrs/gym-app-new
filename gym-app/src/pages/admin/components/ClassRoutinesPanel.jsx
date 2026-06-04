import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Dumbbell, Edit3, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { useToast } from '../../../contexts/ToastContext';
import { AdminCard, FadeIn } from '../../../components/admin';
import ClassRoutineBuilderModal from './ClassRoutineBuilderModal';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

/**
 * "Rutinas de Clase" panel on the Programs page. Lets an admin author the
 * workout routines that can be attached to gym classes (the class form's
 * "Plantilla de entreno" picker lists staff-created routines).
 *
 * Scope = the admin's OWN routines (created_by = userId). That's both
 * RLS-clean (routine_exercises can only be mutated for routines you created)
 * and accurate — post-0495 admins have no member Workout Builder, so every
 * routine they own is one of these class routines.
 */
export default function ClassRoutinesPanel({ gymId, userId, t, tc }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(null); // 'new' | routineRow
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const { data: routines = [], isLoading } = useQuery({
    queryKey: ['admin', 'class-routines', gymId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routines')
        .select('id, name, description, estimated_duration_min, routine_exercises(count)')
        .eq('gym_id', gymId)
        .eq('created_by', userId)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId && !!userId,
  });

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'class-routines', gymId, userId] });
    // So the class form's "Plantilla de entreno" picker reflects the change.
    queryClient.invalidateQueries({ queryKey: adminKeys.classes.routines(gymId) });
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      const { error } = await supabase.from('routines').delete().eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction('delete_class_routine', 'routine', id);
      setConfirmDeleteId(null);
      refetchAll();
      showToast(tc('success'), 'success');
    } catch (err) {
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <FadeIn>
      {/* Header row: hint + create */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-[12.5px]" style={{ color: 'var(--color-admin-text-muted)', maxWidth: 620 }}>
          {t('admin.programs.classRoutines.intro', 'Build workout routines you can attach to classes. Trainers’ routines also appear in the class picker.')}
        </p>
        <button onClick={() => setModal('new')}
          className="flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04] flex-shrink-0"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}>
          <Plus size={16} strokeWidth={2.6} /> {t('admin.programs.classRoutines.new', 'New Routine')}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-admin-text-muted)' }} />
        </div>
      ) : routines.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'var(--color-admin-panel)' }}>
            <Dumbbell size={24} style={{ color: 'var(--color-admin-text-muted)' }} />
          </div>
          <p className="text-[14px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{t('admin.programs.classRoutines.emptyTitle', 'No class routines yet')}</p>
          <p className="text-[12.5px] mt-1 mb-4" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.classRoutines.emptyHint', 'Create a routine to attach to your classes')}</p>
          <button onClick={() => setModal('new')}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all hover:brightness-[1.04]"
            style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}>
            <Plus size={15} strokeWidth={2.6} /> {t('admin.programs.classRoutines.new', 'New Routine')}
          </button>
        </div>
      ) : (
        <AdminCard padding="p-0" clipContent={false}>
          {routines.map((r, idx) => {
            const count = r.routine_exercises?.[0]?.count || 0;
            const isLast = idx === routines.length - 1;
            return (
              <div key={r.id} className="flex items-center gap-3.5 px-4 py-3.5" style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-admin-border)' }}>
                <div className="grid place-items-center flex-shrink-0" style={{ width: 42, height: 42, borderRadius: 12, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
                  <Dumbbell size={20} strokeWidth={2} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px', color: 'var(--color-admin-text)' }}>{r.name}</p>
                  <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                    {count} {t('admin.programs.classRoutines.exercisesLabel', 'exercises')}
                    {r.estimated_duration_min ? ` · ~${r.estimated_duration_min} ${t('admin.programs.classRoutines.min', 'min')}` : ''}
                  </p>
                </div>
                {confirmDeleteId === r.id ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => handleDelete(r.id)} disabled={deletingId === r.id}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50"
                      style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger-ink)' }}>
                      {deletingId === r.id ? '…' : tc('delete')}
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                      style={{ background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)' }}>
                      {tc('cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => setModal(r)} aria-label={tc('edit')}
                      className="grid place-items-center transition-colors hover:bg-[var(--color-bg-hover)]"
                      style={{ width: 32, height: 32, borderRadius: 9, border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)' }}>
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => setConfirmDeleteId(r.id)} aria-label={tc('delete')}
                      className="grid place-items-center transition-colors hover:bg-[var(--color-bg-hover)]"
                      style={{ width: 32, height: 32, borderRadius: 9, border: '1px solid var(--color-admin-border)', color: 'var(--color-danger)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </AdminCard>
      )}

      {modal && (
        <ClassRoutineBuilderModal
          routine={modal === 'new' ? null : modal}
          gymId={gymId}
          userId={userId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refetchAll(); }}
          t={t}
          tc={tc}
        />
      )}
    </FadeIn>
  );
}
