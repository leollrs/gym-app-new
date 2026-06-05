import { useEffect, useState, useMemo } from 'react';
import { Plus, Megaphone, Trash2, Calendar, Pencil, Repeat, ChevronDown, Clock, Check, Users, Inbox } from 'lucide-react';
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
import { ToneIconChip, TonePill } from '../../lib/admin/adminTones';

// Hard caps on announcement copy. Keep these in sync with any server-side
// validation you add later. Caps prevent the worst spam / abuse vectors and
// keep push payloads under APNs/FCM size limits.
const TITLE_MAX = 100;
const BODY_MAX = 500;

// Must match the announcement_type enum in the DB schema
// Pill tones map to admin-* idiom per HTML reference. Selected-button styles
// use theme CSS variables so white-label gyms inherit their accent palette
// instead of being locked to the legacy gold (#D4AF37) etc.
const TYPE_OPTS = [
  { value: 'news',        labelKey: 'news',        pill: 'admin-pill--info',  selectedStyle: { color: 'var(--color-info)',    background: 'color-mix(in srgb, var(--color-info) 12%, transparent)' } },
  { value: 'event',       labelKey: 'event',       pill: '',                  selectedStyle: { color: 'var(--color-accent)',  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } },
  { value: 'challenge',   labelKey: 'challenge',   pill: 'admin-pill--coach', selectedStyle: { color: 'var(--color-coach)',   background: 'color-mix(in srgb, var(--color-coach) 12%, transparent)' } },
  { value: 'maintenance', labelKey: 'maintenance', pill: 'admin-pill--hot',   selectedStyle: { color: 'var(--color-warning)', background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)' } },
];

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

// announcement type → category tone (matches the design's CATS taxonomy).
const TYPE_TONE = { news: 'coach', event: 'teal', challenge: 'good', maintenance: 'warn' };

// Square ghost action button (edit / delete). danger → red icon.
function GhostBtn({ icon: Icon, onClick, label, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid place-items-center rounded-[10px] border transition-colors hover:bg-[var(--color-bg-hover)]"
      style={{ width: 34, height: 34, borderColor: 'var(--color-admin-border)', background: 'var(--color-bg-card)' }}
    >
      <Icon size={15} strokeWidth={2} style={{ color: danger ? 'var(--color-danger)' : 'var(--color-admin-text-sub)' }} />
    </button>
  );
}

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
      // Strip HTML tags via DOMPurify, then enforce length caps. Use the
      // gentler "truncate with ellipsis" approach so a slightly-too-long
      // message still publishes rather than blocking the admin.
      const cleanTitle = sanitize(form.title).trim();
      const cleanMessage = sanitize(form.message).trim();
      if (!cleanTitle || !cleanMessage) {
        throw new Error(t('admin.announcements.titleMessageRequired', 'Title and message are required.'));
      }
      const finalTitle = cleanTitle.length > TITLE_MAX
        ? `${cleanTitle.slice(0, TITLE_MAX - 1).trimEnd()}…`
        : cleanTitle;
      const finalMessage = cleanMessage.length > BODY_MAX
        ? `${cleanMessage.slice(0, BODY_MAX - 1).trimEnd()}…`
        : cleanMessage;
      const { error: err } = await supabase.from('announcements').insert({
        gym_id:      gymId,
        created_by:  adminId,
        title:       finalTitle,
        message:     finalMessage,
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
      return { finalTitle, finalMessage };
    },
    onSuccess: ({ finalTitle, finalMessage }) => {
      logAdminAction('create_announcement', 'announcement', null, { title: finalTitle });
      posthog?.capture('admin_announcement_sent', { type: form.type });
      queryClient.invalidateQueries({ queryKey: adminKeys.announcements(gymId) });
      // A future-dated announcement must NOT push now — the member-facing feed
      // (MyGym / Notifications) already hides it until published_at via a
      // `.lte('published_at', now)` filter, and the broadcast_due_announcements
      // cron (migration 0490) fires the push when published_at passes. Pushing
      // here would notify everyone immediately, defeating the schedule.
      const isScheduled = form.scheduled_for && isFuture(new Date(form.scheduled_for));
      showToast(
        isScheduled
          ? t('admin.announcements.scheduled', 'Announcement scheduled')
          : t('admin.announcements.published', 'Announcement published'),
        'success',
      );
      if (!isScheduled) {
        // Forward the form-selected type so per-type opt-outs are honored —
        // broadcastNotification → sendPushToUser passes `type` through as
        // `notification_type` to the edge function, which gates on
        // notif_<type>_enabled per recipient.
        broadcastNotification({
          gymId,
          type: form.type || 'announcement',
          title: finalTitle,
          body: finalMessage,
          dedupKey: `announcement_${form.type || 'announcement'}_${finalTitle.replace(/\s+/g, '_').slice(0, 40)}_${Date.now() / 60000 | 0}`,
        });
      }
      onClose();
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  return (
    <AdminModal isOpen={isOpen} onClose={onClose} title={t('admin.announcements.newAnnouncement', 'New Announcement')} titleIcon={Megaphone}
      footer={
        <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
          className="w-full py-3 rounded-xl font-bold text-[14px] text-[var(--color-text-on-accent)] bg-[var(--color-accent)] disabled:opacity-50">
          {createMutation.isPending ? t('admin.announcements.publishing', 'Publishing...') : form.scheduled_for ? t('admin.announcements.schedule', 'Schedule') : t('admin.announcements.publishNow', 'Publish Now')}
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] font-medium text-[var(--color-admin-text-sub)] mb-1.5">{t('admin.announcements.titleLabel', 'Title')}</label>
          <input value={form.title} onChange={e => set('title', e.target.value)}
            placeholder={t('admin.announcements.titlePlaceholder')}
            maxLength={TITLE_MAX}
            className="w-full bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] rounded-xl px-4 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder:text-[var(--color-admin-text-faint)] outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none" />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[var(--color-admin-text-sub)] mb-1.5">{t('admin.announcements.messageLabel')}</label>
          <textarea value={form.message} onChange={e => set('message', e.target.value)} rows={3}
            placeholder={t('admin.announcements.messagePlaceholder')}
            maxLength={BODY_MAX}
            className="w-full bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] rounded-xl px-4 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder:text-[var(--color-admin-text-faint)] outline-none focus:border-[var(--color-accent)] resize-none" />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[var(--color-admin-text-sub)] mb-1.5">{t('admin.announcements.typeLabel', 'Type')}</label>
          <div className="flex gap-2 flex-wrap">
            {TYPE_OPTS.map(opt => (
              <button key={opt.value} onClick={() => set('type', opt.value)}
                className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                  form.type === opt.value ? '' : 'bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] text-[var(--color-admin-text-sub)]'
                }`}
                style={form.type === opt.value ? opt.selectedStyle : undefined}>
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
            className="flex items-center gap-2 text-[12px] font-medium text-[var(--color-admin-text-sub)] hover:text-[var(--color-admin-text)] transition-colors"
          >
            <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            {t('admin.announcements.advancedOptions', 'Advanced Options')}
            {(form.scheduled_for || form.is_recurring) && (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} />
            )}
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[var(--color-admin-text-sub)] mb-1.5">
                  {t('admin.announcements.scheduleLabel', 'Schedule (optional -- leave blank to publish now)')}
                </label>
                <input type="datetime-local" value={form.scheduled_for} onChange={e => set('scheduled_for', e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none"
                  style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                <p className="text-[10px] text-[var(--color-admin-text-muted)] mt-1">
                  {t('admin.announcements.timezoneHint', 'Times are in your device\'s local timezone')}
                </p>
              </div>
              {/* Recurring toggle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12px] font-medium text-[var(--color-admin-text-sub)]">{t('admin.announcements.recurring', 'Recurring')}</label>
                  <button
                    onClick={() => set('is_recurring', !form.is_recurring)}
                    className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
                    style={{ backgroundColor: form.is_recurring ? 'var(--color-accent)' : 'var(--color-admin-text-sub)' }}
                  >
                    <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                      style={{ left: form.is_recurring ? 'calc(100% - 18px)' : '2px' }} />
                  </button>
                </div>
                {form.is_recurring && (
                  <div className="space-y-3 rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--color-admin-text-muted)] mb-1">{t('admin.announcements.frequency', 'Frequency')}</label>
                      <div className="flex gap-2">
                        {['daily', 'weekly', 'biweekly', 'monthly'].map(r => (
                          <button key={r} onClick={() => set('recurrence_rule', r)}
                            className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold capitalize transition-colors"
                            style={form.recurrence_rule === r
                              ? { background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }
                              : { background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)', border: '1px solid var(--color-admin-border)' }}>
                            {t(`admin.announcements.recurrence.${r}`, r)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {form.recurrence_rule === 'weekly' || form.recurrence_rule === 'biweekly' ? (
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--color-admin-text-muted)] mb-1">{t('admin.announcements.dayOfWeek', 'Day of week')}</label>
                        <div className="flex gap-1.5">
                          {DAY_LABELS.map((d, i) => (
                            <button key={d} onClick={() => set('recurrence_day', i)}
                              className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-colors"
                              style={form.recurrence_day === i
                                ? { background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }
                                : { background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)' }}>{d}</button>
                          ))}
                        </div>
                      </div>
                    ) : form.recurrence_rule === 'monthly' ? (
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--color-admin-text-muted)] mb-1">{t('admin.announcements.dayOfMonth', 'Day of month')}</label>
                        <input type="number" min="1" max="28" value={form.recurrence_day || 1}
                          onChange={e => set('recurrence_day', parseInt(e.target.value) || 1)}
                          className="w-20 rounded-xl px-3 py-2 text-[13px] outline-none"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                      </div>
                    ) : null}
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--color-admin-text-muted)] mb-1">{t('admin.announcements.endDate', 'End date (optional)')}</label>
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
        {error && <p className="text-[12px] text-[var(--color-danger)]">{error}</p>}
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
  const [editForm, setEditForm] = useState({ title: '', message: '', type: 'news', scheduled_for: '', is_recurring: false, recurrence_rule: 'weekly', recurrence_day: 1, recurrence_end: '' });
  const [editShowAdvanced, setEditShowAdvanced] = useState(false);
  const EDIT_DAY_LABELS = [
    t('admin.announcements.daySun', 'Sun'),
    t('admin.announcements.dayMon', 'Mon'),
    t('admin.announcements.dayTue', 'Tue'),
    t('admin.announcements.dayWed', 'Wed'),
    t('admin.announcements.dayThu', 'Thu'),
    t('admin.announcements.dayFri', 'Fri'),
    t('admin.announcements.daySat', 'Sat'),
  ];
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
      const cleanTitle = sanitize(editForm.title).trim();
      const cleanMessage = sanitize(editForm.message).trim();
      if (!cleanTitle || !cleanMessage) {
        throw new Error(t('admin.announcements.titleMessageRequired', 'Title and message are required.'));
      }
      const finalTitle = cleanTitle.length > TITLE_MAX
        ? `${cleanTitle.slice(0, TITLE_MAX - 1).trimEnd()}…`
        : cleanTitle;
      const finalMessage = cleanMessage.length > BODY_MAX
        ? `${cleanMessage.slice(0, BODY_MAX - 1).trimEnd()}…`
        : cleanMessage;
      const updatePayload = {
        title: finalTitle,
        message: finalMessage,
        type: editForm.type,
        is_recurring: editForm.is_recurring,
        recurrence_rule: editForm.is_recurring ? editForm.recurrence_rule : null,
        recurrence_day: editForm.is_recurring ? editForm.recurrence_day : null,
        recurrence_end: editForm.is_recurring && editForm.recurrence_end ? editForm.recurrence_end : null,
      };
      // Only update published_at when admin explicitly picks a new schedule —
      // leaving the field blank preserves whatever was there before.
      if (editForm.scheduled_for) {
        updatePayload.published_at = new Date(editForm.scheduled_for).toISOString();
      }
      const { error: err } = await supabase
        .from('announcements')
        .update(updatePayload)
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
    // datetime-local needs "YYYY-MM-DDTHH:mm" — slice off seconds + timezone.
    const scheduledFor = a.published_at && isFuture(new Date(a.published_at))
      ? format(new Date(a.published_at), "yyyy-MM-dd'T'HH:mm")
      : '';
    setEditForm({ title: a.title, message: a.message, type: a.type, scheduled_for: scheduledFor, is_recurring: a.is_recurring || false, recurrence_rule: a.recurrence_rule || 'weekly', recurrence_day: a.recurrence_day ?? 1, recurrence_end: a.recurrence_end || '' });
    setEditShowAdvanced(Boolean(scheduledFor || a.is_recurring));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({ title: '', message: '', type: 'news', scheduled_for: '', is_recurring: false, recurrence_rule: 'weekly', recurrence_day: 1, recurrence_end: '' });
    setEditShowAdvanced(false);
  };

  // Compute counts per status for tab badges
  const statusCounts = useMemo(() => {
    const scheduled = announcements.filter(a => a.published_at && isFuture(new Date(a.published_at))).length;
    const sent = announcements.filter(a => !a.published_at || !isFuture(new Date(a.published_at))).length;
    const recurring = announcements.filter(a => a.is_recurring).length;
    return { all: announcements.length, scheduled, sent, recurring };
  }, [announcements]);

  return (
    <div className="px-3 sm:px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto" data-admin-tour="announcements">
      <PageHeader
        title={t('admin.announcements.title', 'Announcements')}
        subtitle={t('admin.announcements.subtitle', 'Messages broadcast to all members')}
        actions={
          <button onClick={() => setShowCreate(true)}
            className="flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04] whitespace-nowrap flex-shrink-0"
            style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}>
            <Plus size={16} strokeWidth={2.6} /> {t('admin.announcements.newAnnouncement', 'New Announcement')}
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
        <AdminCard>
          <div className="flex flex-col items-center text-center gap-3.5 py-14 px-6">
            <ToneIconChip icon={Inbox} tone="neutral" size={52} />
            <div>
              <p style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 17, color: 'var(--color-admin-text)', letterSpacing: '-0.3px' }}>
                {t('admin.announcements.emptyTitle', 'Nothing here yet')}
              </p>
              <p className="text-[13px] mt-1.5 mx-auto" style={{ color: 'var(--color-admin-text-muted)', maxWidth: 340 }}>
                {t('admin.announcements.noAnnouncements', 'No announcements yet')}
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}
            >
              <Plus size={16} strokeWidth={2.6} /> {t('admin.announcements.createFirst', 'Create your first announcement')}
            </button>
          </div>
        </AdminCard>
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
              <AdminCard>
                <div className="flex flex-col items-center text-center gap-2 py-12 px-6">
                  <ToneIconChip icon={Inbox} tone="neutral" size={46} />
                  <p className="text-[13px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.announcements.noMatchingAnnouncements', 'No announcements match this filter')}</p>
                </div>
              </AdminCard>
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
                              <label className="block text-[12px] font-medium text-[var(--color-admin-text-sub)] mb-1.5">{t('admin.announcements.titleLabel', 'Title')}</label>
                              <input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                                maxLength={TITLE_MAX}
                                className="w-full bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] rounded-xl px-4 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder:text-[var(--color-admin-text-faint)] outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-[12px] font-medium text-[var(--color-admin-text-sub)] mb-1.5">{t('admin.announcements.messageLabel')}</label>
                              <textarea value={editForm.message} onChange={e => setEditForm(p => ({ ...p, message: e.target.value }))} rows={3}
                                maxLength={BODY_MAX}
                                className="w-full bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] rounded-xl px-4 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder:text-[var(--color-admin-text-faint)] outline-none focus:border-[var(--color-accent)] resize-none" />
                            </div>
                            <div>
                              <label className="block text-[12px] font-medium text-[var(--color-admin-text-sub)] mb-1.5">{t('admin.announcements.typeLabel', 'Type')}</label>
                              <div className="flex gap-2 flex-wrap">
                                {TYPE_OPTS.map(opt => (
                                  <button key={opt.value} onClick={() => setEditForm(p => ({ ...p, type: opt.value }))}
                                    className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                                      editForm.type === opt.value ? '' : 'bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] text-[var(--color-admin-text-sub)]'
                                    }`}
                                    style={editForm.type === opt.value ? opt.selectedStyle : undefined}>
                                    {t(`admin.announcementTypes.${opt.labelKey}`)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* Advanced — schedule + recurrence (mirrors Create modal). */}
                            <div>
                              <button
                                type="button"
                                onClick={() => setEditShowAdvanced(!editShowAdvanced)}
                                className="flex items-center gap-2 text-[12px] font-medium text-[var(--color-admin-text-sub)] hover:text-[var(--color-admin-text)] transition-colors"
                              >
                                <ChevronDown size={14} className={`transition-transform ${editShowAdvanced ? 'rotate-180' : ''}`} />
                                {t('admin.announcements.advancedOptions', 'Advanced Options')}
                                {(editForm.scheduled_for || editForm.is_recurring) && (
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} />
                                )}
                              </button>
                              {editShowAdvanced && (
                                <div className="mt-3 space-y-4">
                                  <div>
                                    <label className="block text-[12px] font-medium text-[var(--color-admin-text-sub)] mb-1.5">
                                      {t('admin.announcements.scheduleLabel', 'Schedule (optional -- leave blank to publish now)')}
                                    </label>
                                    <input type="datetime-local" value={editForm.scheduled_for} onChange={e => setEditForm(p => ({ ...p, scheduled_for: e.target.value }))}
                                      className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none"
                                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                                    <p className="text-[10px] text-[var(--color-admin-text-muted)] mt-1">
                                      {t('admin.announcements.timezoneHint', 'Times are in your device\'s local timezone')}
                                    </p>
                                  </div>
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <label className="text-[12px] font-medium text-[var(--color-admin-text-sub)]">{t('admin.announcements.recurring', 'Recurring')}</label>
                                      <button
                                        onClick={() => setEditForm(p => ({ ...p, is_recurring: !p.is_recurring }))}
                                        className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
                                        style={{ backgroundColor: editForm.is_recurring ? 'var(--color-accent)' : 'var(--color-admin-text-sub)' }}
                                      >
                                        <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                                          style={{ left: editForm.is_recurring ? 'calc(100% - 18px)' : '2px' }} />
                                      </button>
                                    </div>
                                    {editForm.is_recurring && (
                                      <div className="space-y-3 rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                                        <div>
                                          <label className="block text-[11px] font-medium text-[var(--color-admin-text-muted)] mb-1">{t('admin.announcements.frequency', 'Frequency')}</label>
                                          <div className="flex gap-2">
                                            {['daily', 'weekly', 'biweekly', 'monthly'].map(r => (
                                              <button key={r} onClick={() => setEditForm(p => ({ ...p, recurrence_rule: r }))}
                                                className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold capitalize transition-colors"
                                                style={editForm.recurrence_rule === r
                                                  ? { background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }
                                                  : { background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)', border: '1px solid var(--color-admin-border)' }}>
                                                {t(`admin.announcements.recurrence.${r}`, r)}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        {editForm.recurrence_rule === 'weekly' || editForm.recurrence_rule === 'biweekly' ? (
                                          <div>
                                            <label className="block text-[11px] font-medium text-[var(--color-admin-text-muted)] mb-1">{t('admin.announcements.dayOfWeek', 'Day of week')}</label>
                                            <div className="flex gap-1.5">
                                              {EDIT_DAY_LABELS.map((d, i) => (
                                                <button key={d} onClick={() => setEditForm(p => ({ ...p, recurrence_day: i }))}
                                                  className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-colors"
                                                  style={editForm.recurrence_day === i
                                                    ? { background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }
                                                    : { background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)' }}>{d}</button>
                                              ))}
                                            </div>
                                          </div>
                                        ) : editForm.recurrence_rule === 'monthly' ? (
                                          <div>
                                            <label className="block text-[11px] font-medium text-[var(--color-admin-text-muted)] mb-1">{t('admin.announcements.dayOfMonth', 'Day of month')}</label>
                                            <input type="number" min="1" max="28" value={editForm.recurrence_day || 1}
                                              onChange={e => setEditForm(p => ({ ...p, recurrence_day: parseInt(e.target.value) || 1 }))}
                                              className="w-20 rounded-xl px-3 py-2 text-[13px] outline-none"
                                              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                                          </div>
                                        ) : null}
                                        <div>
                                          <label className="block text-[11px] font-medium text-[var(--color-admin-text-muted)] mb-1">{t('admin.announcements.endDate', 'End date (optional)')}</label>
                                          <input type="date" value={editForm.recurrence_end} onChange={e => setEditForm(p => ({ ...p, recurrence_end: e.target.value }))}
                                            className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                                            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={cancelEditing}
                                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-[var(--color-admin-panel)]text-[var(--color-admin-text-sub)] border border-[var(--color-admin-border)] hover:text-[var(--color-admin-text)] transition-colors">
                                {t('admin.announcements.cancel', 'Cancel')}
                              </button>
                              <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending || !editForm.title || !editForm.message}
                                className="flex-1 py-2.5 rounded-xl font-bold text-[13px] text-[var(--color-text-on-accent)] bg-[var(--color-accent)] disabled:opacity-50">
                                {editMutation.isPending ? t('admin.announcements.saving', 'Saving...') : t('admin.announcements.save', 'Save')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-4">
                            <ToneIconChip icon={Megaphone} tone="hot" size={46} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                                <span className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 16, color: 'var(--color-admin-text)', letterSpacing: '-0.3px' }}>{sanitize(a.title)}</span>
                                <TonePill tone={TYPE_TONE[a.type] || 'neutral'}>{t(`admin.announcementTypes.${a.type}`, a.type)}</TonePill>
                                {(() => {
                                  const st = a.is_recurring
                                    ? { tone: 'coach', icon: Repeat, label: t('admin.announcements.filterRecurring', 'Recurring') }
                                    : isScheduled
                                      ? { tone: 'warn', icon: Clock, label: t('admin.announcements.scheduled', 'Scheduled') }
                                      : { tone: 'good', icon: Check, label: t('admin.announcements.filterSent', 'Sent') };
                                  return <TonePill tone={st.tone} icon={st.icon}>{st.label}</TonePill>;
                                })()}
                              </div>
                              <p className="truncate" style={{ fontSize: 13, color: 'var(--color-admin-text-sub)' }}>{sanitize(a.message)}</p>
                              <div className="flex items-center gap-4 mt-2.5 flex-wrap">
                                {a.published_at && (
                                  <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-admin-text-muted)', fontWeight: 500 }}>
                                    <Calendar size={13} />
                                    {isScheduled ? t('admin.announcements.scheduledFor', 'Scheduled for') : t('admin.announcements.publishedOn', 'Published')}{' '}
                                    {format(new Date(a.published_at), 'MMM d, yyyy', dateFnsLocale)}
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-admin-text-muted)', fontWeight: 500 }}>
                                  <Users size={13} /> {t('admin.announcements.allMembers', 'All members')}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {confirmDeleteId === a.id ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.announcements.deleteConfirm')}</span>
                                  <button onClick={() => deleteMutation.mutate(a.id)}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors"
                                    style={{ color: 'var(--color-danger)', background: 'var(--color-danger-soft)' }}>
                                    {t('admin.announcements.confirm', 'Confirm')}
                                  </button>
                                  <button onClick={() => setConfirmDeleteId(null)}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                                    style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-admin-panel)' }}>
                                    {t('admin.announcements.cancel', 'Cancel')}
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <GhostBtn icon={Pencil} label={t('admin.announcements.editAria', 'Edit announcement')} onClick={() => startEditing(a)} />
                                  <GhostBtn icon={Trash2} danger label={t('admin.announcements.deleteAria', 'Delete announcement')} onClick={() => setConfirmDeleteId(a.id)} />
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
