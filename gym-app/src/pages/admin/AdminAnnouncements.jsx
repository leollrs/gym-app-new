import { useEffect, useState, useMemo } from 'react';
import { Plus, Megaphone, Trash2, Calendar, Pencil, Repeat, ChevronDown } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format, isFuture } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { sanitize } from '../../lib/sanitize';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import posthog from 'posthog-js';
import { broadcastNotification } from '../../lib/notifications';
import { PageHeader, AdminCard, AdminModal, FadeIn, CardSkeleton, AdminTabs } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';

// Must match the announcement_type enum in the DB schema
const TYPE_OPTS = [
  { value: 'news',        labelKey: 'news',        color: 'text-blue-400 bg-blue-500/10' },
  { value: 'event',       labelKey: 'event',       color: 'text-[#D4AF37] bg-[#D4AF37]/10' },
  { value: 'challenge',   labelKey: 'challenge',   color: 'text-emerald-400 bg-emerald-500/10' },
  { value: 'maintenance', labelKey: 'maintenance', color: 'text-red-400 bg-red-500/10' },
];

const CreateModal = ({ isOpen, onClose, gymId, adminId }) => {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: '', message: '', type: 'news', scheduled_for: '', is_recurring: false, recurrence_rule: 'weekly', recurrence_day: 1, recurrence_end: '' });
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const DAY_LABELS = [
    t('admin.announcements.daySun', 'Sun'),
    t('admin.announcements.dayMon', 'Mon'),
    t('admin.announcements.dayTue', 'Tue'),
    t('admin.announcements.dayWed', 'Wed'),
    t('admin.announcements.dayThu', 'Thu'),
    t('admin.announcements.dayFri', 'Fri'),
    t('admin.announcements.daySat', 'Sat'),
  ];

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.title || !form.message) throw new Error(t('admin.announcements.titleMessageRequired', 'Title and message are required.'));
      const { error: err } = await supabase.from('announcements').insert({
        gym_id:      gymId,
        created_by:  adminId,
        title:       form.title,
        message:     form.message,
        type:        form.type,
        published_at: form.scheduled_for
          ? new Date(form.scheduled_for).toISOString()
          : new Date().toISOString(),
        is_recurring: form.is_recurring,
        recurrence_rule: form.is_recurring ? form.recurrence_rule : null,
        recurrence_day: form.is_recurring ? form.recurrence_day : null,
        recurrence_end: form.is_recurring && form.recurrence_end ? form.recurrence_end : null,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      logAdminAction('create_announcement', 'announcement', null, { title: form.title });
      posthog?.capture('admin_announcement_sent', { type: form.type });
      queryClient.invalidateQueries({ queryKey: adminKeys.announcements(gymId) });
      showToast(t('admin.announcements.published', 'Announcement published'), 'success');
      broadcastNotification({
        gymId,
        type: 'announcement',
        title: form.title,
        body: form.message,
        dedupKey: `announcement_${form.title.replace(/\s+/g, '_').slice(0, 40)}_${Date.now() / 60000 | 0}`,
      });
      onClose();
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  return (
    <AdminModal isOpen={isOpen} onClose={onClose} title={t('admin.announcements.newAnnouncement', 'New Announcement')} titleIcon={Megaphone}
      footer={
        <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
          className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50">
          {createMutation.isPending ? t('admin.announcements.publishing', 'Publishing...') : form.scheduled_for ? t('admin.announcements.schedule', 'Schedule') : t('admin.announcements.publishNow', 'Publish Now')}
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.announcements.titleLabel', 'Title')}</label>
          <input value={form.title} onChange={e => set('title', e.target.value)}
            placeholder={t('admin.announcements.titlePlaceholder')}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.announcements.messageLabel')}</label>
          <textarea value={form.message} onChange={e => set('message', e.target.value)} rows={3}
            placeholder={t('admin.announcements.messagePlaceholder')}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none" />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.announcements.typeLabel', 'Type')}</label>
          <div className="flex gap-2 flex-wrap">
            {TYPE_OPTS.map(opt => (
              <button key={opt.value} onClick={() => set('type', opt.value)}
                className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                  form.type === opt.value ? opt.color : 'bg-[#111827] border border-white/6 text-[#9CA3AF]'
                }`}>
                {t(`admin.announcementTypes.${opt.labelKey}`)}
              </button>
            ))}
          </div>
        </div>
        {/* Advanced Options — progressive disclosure for scheduling & recurring */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
          >
            <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            {t('admin.announcements.advancedOptions', 'Advanced Options')}
            {(form.scheduled_for || form.is_recurring) && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />
            )}
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">
                  {t('admin.announcements.scheduleLabel', 'Schedule (optional -- leave blank to publish now)')}
                </label>
                <input type="datetime-local" value={form.scheduled_for} onChange={e => set('scheduled_for', e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none"
                  style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                <p className="text-[10px] text-[#6B7280] mt-1">
                  {t('admin.announcements.timezoneHint', 'Times are in your device\'s local timezone')}
                </p>
              </div>
              {/* Recurring toggle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12px] font-medium text-[#9CA3AF]">{t('admin.announcements.recurring', 'Recurring')}</label>
                  <button
                    onClick={() => set('is_recurring', !form.is_recurring)}
                    className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
                    style={{ backgroundColor: form.is_recurring ? '#D4AF37' : '#6B7280' }}
                  >
                    <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                      style={{ left: form.is_recurring ? 'calc(100% - 18px)' : '2px' }} />
                  </button>
                </div>
                {form.is_recurring && (
                  <div className="space-y-3 rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                    <div>
                      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.announcements.frequency', 'Frequency')}</label>
                      <div className="flex gap-2">
                        {['daily', 'weekly', 'biweekly', 'monthly'].map(r => (
                          <button key={r} onClick={() => set('recurrence_rule', r)}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold capitalize transition-colors ${
                              form.recurrence_rule === r ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25' : 'bg-white/4 text-[#6B7280] border border-white/6'
                            }`}>{t(`admin.announcements.recurrence.${r}`, r)}</button>
                        ))}
                      </div>
                    </div>
                    {form.recurrence_rule === 'weekly' || form.recurrence_rule === 'biweekly' ? (
                      <div>
                        <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.announcements.dayOfWeek', 'Day of week')}</label>
                        <div className="flex gap-1.5">
                          {DAY_LABELS.map((d, i) => (
                            <button key={d} onClick={() => set('recurrence_day', i)}
                              className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
                                form.recurrence_day === i ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-white/4 text-[#6B7280]'
                              }`}>{d}</button>
                          ))}
                        </div>
                      </div>
                    ) : form.recurrence_rule === 'monthly' ? (
                      <div>
                        <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.announcements.dayOfMonth', 'Day of month')}</label>
                        <input type="number" min="1" max="28" value={form.recurrence_day || 1}
                          onChange={e => set('recurrence_day', parseInt(e.target.value) || 1)}
                          className="w-20 rounded-xl px-3 py-2 text-[13px] outline-none"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                      </div>
                    ) : null}
                    <div>
                      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.announcements.endDate', 'End date (optional)')}</label>
                      <input type="date" value={form.recurrence_end} onChange={e => set('recurrence_end', e.target.value)}
                        className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                        style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {error && <p className="text-[12px] text-red-400">{error}</p>}
      </div>
    </AdminModal>
  );
};

export default function AdminAnnouncements() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', message: '', type: 'news', is_recurring: false, recurrence_rule: 'weekly', recurrence_day: 1, recurrence_end: '' });
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { document.title = t('admin.announcements.pageTitle', `Admin - Announcements | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

  // ── Fetch announcements ──
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: adminKeys.announcements(gymId),
    queryFn: async () => {
      const { data } = await supabase
        .from('announcements')
        .select('*')
        .eq('gym_id', gymId)
        .order('published_at', { ascending: false });
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('announcements').delete().eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.announcements(gymId) });
      setConfirmDeleteId(null);
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  // ── Edit mutation ──
  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editForm.title || !editForm.message) throw new Error(t('admin.announcements.titleMessageRequired', 'Title and message are required.'));
      const { error: err } = await supabase
        .from('announcements')
        .update({ title: editForm.title, message: editForm.message, type: editForm.type, is_recurring: editForm.is_recurring, recurrence_rule: editForm.is_recurring ? editForm.recurrence_rule : null, recurrence_day: editForm.is_recurring ? editForm.recurrence_day : null, recurrence_end: editForm.is_recurring && editForm.recurrence_end ? editForm.recurrence_end : null })
        .eq('id', editingId)
        .eq('gym_id', gymId);
      if (err) throw err;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.announcements(gymId) });
      cancelEditing();
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const startEditing = (a) => {
    setEditingId(a.id);
    setEditForm({ title: a.title, message: a.message, type: a.type, is_recurring: a.is_recurring || false, recurrence_rule: a.recurrence_rule || 'weekly', recurrence_day: a.recurrence_day ?? 1, recurrence_end: a.recurrence_end || '' });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({ title: '', message: '', type: 'news', is_recurring: false, recurrence_rule: 'weekly', recurrence_day: 1, recurrence_end: '' });
  };

  // Compute counts per status for tab badges
  const statusCounts = useMemo(() => {
    const scheduled = announcements.filter(a => a.published_at && isFuture(new Date(a.published_at))).length;
    const sent = announcements.filter(a => !a.published_at || !isFuture(new Date(a.published_at))).length;
    const recurring = announcements.filter(a => a.is_recurring).length;
    return { all: announcements.length, scheduled, sent, recurring };
  }, [announcements]);

  const typeStyle = (type) =>
    TYPE_OPTS.find(opt => opt.value === type)?.color ?? 'text-[#9CA3AF] bg-white/6';

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('admin.announcements.title', 'Announcements')}
        subtitle={t('admin.announcements.subtitle', 'Messages broadcast to all members')}
        actions={
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[14px] rounded-xl hover:bg-[#C4A030] transition-colors whitespace-nowrap flex-shrink-0">
            <Plus size={15} /> {t('admin.announcements.newAnnouncement', 'New Announcement')}
          </button>
        }
        className="mb-6"
      />

      {/* Status filter tabs */}
      {announcements.length > 0 && (
        <AdminTabs
          tabs={[
            { key: 'all', label: t('admin.announcements.filterAll', 'All'), count: statusCounts.all },
            { key: 'scheduled', label: t('admin.announcements.filterScheduled', 'Scheduled'), count: statusCounts.scheduled },
            { key: 'sent', label: t('admin.announcements.filterSent', 'Sent'), count: statusCounts.sent },
            { key: 'recurring', label: t('admin.announcements.filterRecurring', 'Recurring'), count: statusCounts.recurring },
          ]}
          active={statusFilter}
          onChange={setStatusFilter}
          className="mb-4"
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <CardSkeleton key={i} h="h-[80px]" />)}
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-20">
          <Megaphone size={32} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">{t('admin.announcements.noAnnouncements', 'No announcements yet')}</p>
        </div>
      ) : (
        <SwipeableTabContent
          tabs={[
            { key: 'all', label: t('admin.announcements.filterAll', 'All'), count: statusCounts.all },
            { key: 'scheduled', label: t('admin.announcements.filterScheduled', 'Scheduled'), count: statusCounts.scheduled },
            { key: 'sent', label: t('admin.announcements.filterSent', 'Sent'), count: statusCounts.sent },
            { key: 'recurring', label: t('admin.announcements.filterRecurring', 'Recurring'), count: statusCounts.recurring },
          ]}
          active={statusFilter}
          onChange={setStatusFilter}
        >
          {(tabKey) => {
            const filtered = announcements.filter(a => {
              if (tabKey === 'all') return true;
              const isScheduled = a.published_at && isFuture(new Date(a.published_at));
              if (tabKey === 'scheduled') return isScheduled;
              if (tabKey === 'sent') return !isScheduled;
              if (tabKey === 'recurring') return a.is_recurring;
              return true;
            });
            return filtered.length === 0 ? (
              <div className="text-center py-12">
                <Megaphone size={28} className="text-[#6B7280] mx-auto mb-2" />
                <p className="text-[13px] text-[#6B7280]">{t('admin.announcements.noMatchingAnnouncements', 'No announcements match this filter')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((a, idx) => {
                  const isScheduled = a.published_at && isFuture(new Date(a.published_at));
                  const isEditing = editingId === a.id;
                  return (
                    <FadeIn key={a.id} delay={idx * 40}>
                      <AdminCard hover>
                        {isEditing ? (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.announcements.titleLabel', 'Title')}</label>
                              <input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.announcements.messageLabel')}</label>
                              <textarea value={editForm.message} onChange={e => setEditForm(p => ({ ...p, message: e.target.value }))} rows={3}
                                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none" />
                            </div>
                            <div>
                              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.announcements.typeLabel', 'Type')}</label>
                              <div className="flex gap-2 flex-wrap">
                                {TYPE_OPTS.map(opt => (
                                  <button key={opt.value} onClick={() => setEditForm(p => ({ ...p, type: opt.value }))}
                                    className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                                      editForm.type === opt.value ? opt.color : 'bg-[#111827] border border-white/6 text-[#9CA3AF]'
                                    }`}>
                                    {t(`admin.announcementTypes.${opt.labelKey}`)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={cancelEditing}
                                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors">
                                {t('admin.announcements.cancel', 'Cancel')}
                              </button>
                              <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending || !editForm.title || !editForm.message}
                                className="flex-1 py-2.5 rounded-xl font-bold text-[13px] text-black bg-[#D4AF37] disabled:opacity-50">
                                {editMutation.isPending ? t('admin.announcements.saving', 'Saving...') : t('admin.announcements.save', 'Save')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{sanitize(a.title)}</p>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${typeStyle(a.type)}`}>
                                  {t(`admin.announcementTypes.${a.type}`, a.type)}
                                </span>
                                {isScheduled && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-amber-400 bg-amber-500/10">
                                    {t('admin.announcements.scheduled', 'Scheduled')}
                                  </span>
                                )}
                                {a.is_recurring && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-blue-400 bg-blue-500/10 flex items-center gap-1">
                                    <Repeat size={9} /> {t(`admin.announcements.recurrence.${a.recurrence_rule}`, a.recurrence_rule)}
                                  </span>
                                )}
                              </div>
                              <p className="text-[13px] text-[#9CA3AF] leading-relaxed">{sanitize(a.message)}</p>
                              {a.published_at && (
                                <div className="flex items-center gap-1 mt-2">
                                  <Calendar size={11} className="text-[#6B7280]" />
                                  <p className="text-[11px] text-[#6B7280]">
                                    {isScheduled ? t('admin.announcements.scheduledFor', 'Scheduled for') : t('admin.announcements.publishedOn', 'Published')}{' '}
                                    {format(new Date(a.published_at), 'MMM d, yyyy · h:mm a', dateFnsLocale)}
                                  </p>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {confirmDeleteId === a.id ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-[#9CA3AF]">{t('admin.announcements.deleteConfirm')}</span>
                                  <button onClick={() => deleteMutation.mutate(a.id)}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
                                    {t('admin.announcements.confirm', 'Confirm')}
                                  </button>
                                  <button onClick={() => setConfirmDeleteId(null)}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/5 text-[#9CA3AF] hover:bg-white/10 transition-colors">
                                    {t('admin.announcements.cancel', 'Cancel')}
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <button onClick={() => startEditing(a)} aria-label={t('admin.announcements.editAria', 'Edit announcement')} className="text-[#6B7280] hover:text-[#D4AF37] transition-colors p-1 min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                                    <Pencil size={15} />
                                  </button>
                                  <button onClick={() => setConfirmDeleteId(a.id)} aria-label={t('admin.announcements.deleteAria', 'Delete announcement')} className="text-[#6B7280] hover:text-red-400 transition-colors p-1 min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
                                    <Trash2 size={15} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </AdminCard>
                    </FadeIn>
                  );
                })}
              </div>
            );
          }}
        </SwipeableTabContent>
      )}

      {showCreate && (
        <CreateModal isOpen={showCreate} onClose={() => setShowCreate(false)} gymId={gymId} adminId={user.id} />
      )}
    </div>
  );
}
