import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarOff, Plus, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { supabase } from '../../../lib/supabase';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, SectionLabel, FadeIn } from '../../../components/admin';

/**
 * Manages gym closure days (holidays, maintenance, etc.) from Settings → General.
 * Owns its own query and CRUD so the parent page doesn't need to thread closure
 * state through. Reads/writes `gym_closures` directly; expects gymId from props.
 */
export default function GymClosuresCard({ gymId, delay = 60, id }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const { profile } = useAuth();

  const [closures, setClosures] = useState([]);
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('holiday');
  const [closureName, setClosureName] = useState('');
  const [closureSaving, setClosureSaving] = useState(false);
  const [editingClosureId, setEditingClosureId] = useState(null);

  useEffect(() => {
    if (!gymId) return;
    supabase
      .from('gym_closures')
      .select('*')
      .eq('gym_id', gymId)
      .gte('closure_date', new Date().toISOString().slice(0, 10))
      .order('closure_date')
      .then(({ data }) => setClosures(data || []))
      .catch(() => {});
  }, [gymId]);

  const handleAddClosure = async () => {
    if (!closureDate) return;
    setClosureSaving(true);
    try {
      if (editingClosureId) {
        const { data, error: updErr } = await supabase
          .from('gym_closures')
          .update({ closure_date: closureDate, reason: closureReason, name: closureName || null })
          .eq('id', editingClosureId)
          .eq('gym_id', gymId)
          .select()
          .single();
        if (updErr) throw updErr;
        logAdminAction('update_closures', 'gym', gymId);
        setClosures(prev => prev.map(c => c.id === editingClosureId ? data : c).sort((a, b) => a.closure_date.localeCompare(b.closure_date)));
        showToast(t('admin.closures.updated', 'Cierre actualizado'), 'success');
      } else {
        const { data, error: insertErr } = await supabase
          .from('gym_closures')
          .insert({
            gym_id: gymId,
            closure_date: closureDate,
            reason: closureReason,
            name: closureName || null,
            created_by: profile?.id,
          })
          .select()
          .single();
        if (insertErr) throw insertErr;
        logAdminAction('update_closures', 'gym', gymId);
        setClosures(prev => [...prev, data].sort((a, b) => a.closure_date.localeCompare(b.closure_date)));
        showToast(t('admin.closures.added'), 'success');
      }
      setClosureDate('');
      setClosureName('');
      setClosureReason('holiday');
      setEditingClosureId(null);
    } catch (err) {
      showToast(err.message, 'error');
    }
    setClosureSaving(false);
  };

  const handleEditClosure = (c) => {
    setEditingClosureId(c.id);
    setClosureDate(c.closure_date);
    setClosureReason(c.reason || 'holiday');
    setClosureName(c.name || '');
  };

  const handleCancelEditClosure = () => {
    setEditingClosureId(null);
    setClosureDate('');
    setClosureReason('holiday');
    setClosureName('');
  };

  const handleDeleteClosure = async (id) => {
    try {
      const { error: delErr } = await supabase.from('gym_closures').delete().eq('id', id).eq('gym_id', gymId);
      if (delErr) throw delErr;
      logAdminAction('delete_closure', 'gym_closure', id);
      setClosures(prev => prev.filter(c => c.id !== id));
      showToast(t('admin.closures.removed'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <FadeIn delay={delay} className="xl:col-span-6 min-w-0">
      <AdminCard id={id} hover padding="p-4 sm:p-5">
        <SectionLabel icon={CalendarOff} className="mb-4">{t('admin.closures.sectionTitle')}</SectionLabel>
        <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.description')}</p>

        {/* Add closure form */}
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.date')}</label>
              <input
                type="date"
                value={closureDate}
                onChange={e => setClosureDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.reason')}</label>
              <select
                value={closureReason}
                onChange={e => setClosureReason(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none appearance-none transition-colors"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
              >
                <option value="holiday">{t('admin.closures.reasonHoliday')}</option>
                <option value="maintenance">{t('admin.closures.reasonMaintenance')}</option>
                <option value="special_event">{t('admin.closures.reasonSpecialEvent')}</option>
                <option value="other">{t('admin.closures.reasonOther')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.name')}</label>
            <input
              type="text"
              value={closureName}
              onChange={e => setClosureName(e.target.value)}
              placeholder={t('admin.closures.namePlaceholder')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="flex justify-end gap-2">
            {editingClosureId && (
              <button
                onClick={handleCancelEditClosure}
                disabled={closureSaving}
                className="px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
              >
                {t('admin.closures.cancelEdit', 'Cancelar')}
              </button>
            )}
            <button
              onClick={handleAddClosure}
              disabled={!closureDate || closureSaving}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                color: 'var(--color-accent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
              }}
            >
              <Plus size={14} />
              {closureSaving
                ? (editingClosureId ? t('admin.closures.saving', 'Guardando...') : t('admin.closures.adding'))
                : (editingClosureId ? t('admin.closures.saveChanges', 'Guardar cambios') : t('admin.closures.addClosure'))}
            </button>
          </div>
        </div>

        {/* Upcoming closures list */}
        {closures.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('admin.closures.upcoming')}</p>
            {closures.map(c => (
              <div key={c.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {c.name || t(`admin.closures.reason${c.reason?.charAt(0).toUpperCase()}${c.reason?.slice(1)?.replace('_', '')}`, c.reason)}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(c.closure_date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    {c.reason && <span className="ml-2" style={{ color: 'var(--color-text-subtle)' }}>({t(`admin.closures.reason${c.reason?.charAt(0).toUpperCase()}${c.reason?.slice(1)?.replace('_', '')}`, c.reason)})</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleEditClosure(c)}
                    className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                    style={{ color: editingClosureId === c.id ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                    aria-label={t('admin.closures.edit', 'Editar')}
                    title={t('admin.closures.edit', 'Editar')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteClosure(c.id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label={t('admin.closures.remove')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>{t('admin.closures.noClosure')}</p>
        )}
      </AdminCard>
    </FadeIn>
  );
}
