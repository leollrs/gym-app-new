/**
 * AdminMessageTemplates — browse + override the lifecycle / winback
 * message_templates seeded in migration 0403. Global defaults (gym_id IS NULL)
 * are read-only here; per-gym overrides write rows with the current gym_id.
 *
 * Reset = DELETE the gym row so the global default takes over again.
 * Disable = keep the gym row with enabled=false, which the SQL lookup
 *   functions treat as an explicit opt-out (skips that send entirely).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Loader2, RotateCcw, Save, Mail, Heart } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import {
  PageHeader,
  AdminCard,
  AdminModal,
  AdminTabs,
  SectionLabel,
  Toggle,
} from '../../components/admin';

const FAKE_NAME = 'Maria';

/** Render preview by substituting {{first_name}}. */
function renderPreview(text) {
  return (text || '').replace(/\{\{first_name\}\}/g, FAKE_NAME);
}

/**
 * Group rows by (kind, step_key, language, category) where global default
 * is the base and any gym-specific row layers on top as the override.
 */
function buildRows(allTemplates, gymId) {
  const map = new Map();
  for (const tpl of allTemplates) {
    const key = `${tpl.kind}|${tpl.step_key}|${tpl.language}|${tpl.category ?? '_'}`;
    if (!map.has(key)) {
      map.set(key, { key, kind: tpl.kind, step_key: tpl.step_key, language: tpl.language, category: tpl.category, global: null, override: null });
    }
    const slot = map.get(key);
    if (tpl.gym_id === null) slot.global = tpl;
    else if (tpl.gym_id === gymId) slot.override = tpl;
  }
  return Array.from(map.values());
}

/** Sort step keys like day_1 < day_3 < day_7 < day_14 ... */
function stepWeight(stepKey) {
  const m = /^day_(\d+)$/.exec(stepKey || '');
  return m ? parseInt(m[1], 10) : 9999;
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const sw = stepWeight(a.step_key) - stepWeight(b.step_key);
    if (sw !== 0) return sw;
    if (a.language !== b.language) return a.language < b.language ? -1 : 1;
    const ac = a.category ?? '';
    const bc = b.category ?? '';
    if (ac !== bc) return ac < bc ? -1 : 1;
    return 0;
  });
}

function StatusPill({ status, t }) {
  const map = {
    default: { bg: 'rgba(156,163,175,0.12)', fg: '#9CA3AF', label: t('admin.messageTemplates.statusDefault', 'Default') },
    overridden: { bg: 'color-mix(in srgb, var(--color-accent, #D4AF37) 18%, transparent)', fg: 'var(--color-accent, #D4AF37)', label: t('admin.messageTemplates.statusOverridden', 'Overridden') },
    disabled: { bg: 'rgba(239,68,68,0.14)', fg: '#EF4444', label: t('admin.messageTemplates.statusDisabled', 'Disabled') },
  };
  const cfg = map[status] || map.default;
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {cfg.label}
    </span>
  );
}

export default function AdminMessageTemplates() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  const [kindTab, setKindTab] = useState('lifecycle');
  const [editing, setEditing] = useState(null); // { row, title, body, enabled }

  useEffect(() => {
    document.title = `${t('admin.messageTemplates.title', 'Message Templates')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  const { data: allTemplates = [], isLoading } = useQuery({
    queryKey: adminKeys.messageTemplates(gymId),
    queryFn: async () => {
      // RLS already restricts SELECT to globals + this gym's rows.
      const { data, error } = await supabase
        .from('message_templates')
        .select('id, gym_id, kind, step_key, language, category, title, body, enabled, updated_at')
        .or(`gym_id.is.null,gym_id.eq.${gymId}`);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const rows = useMemo(
    () => sortRows(buildRows(allTemplates, gymId).filter(r => r.kind === kindTab)),
    [allTemplates, gymId, kindTab],
  );

  // Save = upsert per-gym override row.
  const saveMutation = useMutation({
    mutationFn: async ({ row, title, body, enabled }) => {
      if (row.override) {
        const { error } = await supabase
          .from('message_templates')
          .update({ title, body, enabled })
          .eq('id', row.override.id)
          .eq('gym_id', gymId);
        if (error) throw error;
        return { mode: 'update', id: row.override.id };
      } else {
        const { data, error } = await supabase
          .from('message_templates')
          .insert({
            gym_id: gymId,
            kind: row.kind,
            step_key: row.step_key,
            language: row.language,
            category: row.category, // can be null
            title,
            body,
            enabled,
          })
          .select('id')
          .single();
        if (error) throw error;
        return { mode: 'insert', id: data?.id };
      }
    },
    onSuccess: (res) => {
      logAdminAction(
        res.mode === 'insert' ? 'create_message_template_override' : 'update_message_template_override',
        'message_template',
        res.id,
      );
      queryClient.invalidateQueries({ queryKey: adminKeys.messageTemplates(gymId) });
      setEditing(null);
      showToast(t('admin.messageTemplates.saved', 'Template saved'), 'success');
    },
    onError: () => {
      showToast(t('admin.messageTemplates.saveFailed', 'Failed to save template'), 'error');
    },
  });

  // Reset = delete gym row, revealing the global default again.
  const resetMutation = useMutation({
    mutationFn: async (row) => {
      if (!row.override) return null;
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', row.override.id)
        .eq('gym_id', gymId);
      if (error) throw error;
      return row.override.id;
    },
    onSuccess: (id) => {
      if (id) logAdminAction('reset_message_template_override', 'message_template', id);
      queryClient.invalidateQueries({ queryKey: adminKeys.messageTemplates(gymId) });
      setEditing(null);
      showToast(t('admin.messageTemplates.resetDone', 'Reverted to default'), 'success');
    },
    onError: () => {
      showToast(t('admin.messageTemplates.resetFailed', 'Failed to reset'), 'error');
    },
  });

  if (!isAuthorized) {
    return (
      <div className="px-4 md:px-8 py-6 max-w-[1100px] mx-auto">
        <AdminCard>
          <p className="text-[14px] text-[#9CA3AF]">
            {t('admin.messageTemplates.notAuthorized', 'You must be a gym admin to edit message templates.')}
          </p>
        </AdminCard>
      </div>
    );
  }

  const tabs = [
    { key: 'lifecycle', label: t('admin.messageTemplates.tabLifecycle', 'Lifecycle'), icon: Heart },
    { key: 'winback', label: t('admin.messageTemplates.tabWinback', 'Win-Back'), icon: Mail },
  ];

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1100px] mx-auto">
      <PageHeader
        title={t('admin.messageTemplates.title', 'Message Templates')}
        subtitle={t('admin.messageTemplates.subtitle', 'Override the platform defaults for lifecycle and win-back messages. Disable to skip a step entirely at your gym.')}
        className="mb-6"
      />

      <AdminTabs tabs={tabs} active={kindTab} onChange={setKindTab} className="mb-5" />

      {isLoading ? (
        <AdminCard>
          <div className="flex items-center justify-center py-10">
            <Loader2 size={22} className="animate-spin text-[#6B7280]" />
          </div>
        </AdminCard>
      ) : rows.length === 0 ? (
        <AdminCard>
          <div className="text-center py-10">
            <MessageSquare size={28} className="mx-auto text-[#6B7280] mb-3" />
            <p className="text-[14px] text-[#9CA3AF]">
              {t('admin.messageTemplates.empty', 'No templates available.')}
            </p>
          </div>
        </AdminCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((row) => {
            const effective = row.override ?? row.global;
            if (!effective) return null;
            const status = !row.override ? 'default' : (row.override.enabled ? 'overridden' : 'disabled');
            return (
              <button
                key={row.key}
                onClick={() => setEditing({
                  row,
                  title: effective.title,
                  body: effective.body,
                  enabled: row.override ? row.override.enabled : true,
                })}
                className="text-left admin-card admin-card-hover overflow-hidden p-4 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                      {row.step_key.replace(/_/g, ' ')}
                      <span className="mx-1.5 opacity-50">/</span>
                      {row.language.toUpperCase()}
                      {row.category && (
                        <>
                          <span className="mx-1.5 opacity-50">/</span>
                          {row.category}
                        </>
                      )}
                    </p>
                    <p
                      className="text-[14px] font-bold mt-1 truncate"
                      style={{ color: 'var(--color-text-primary, #E5E7EB)' }}
                    >
                      {renderPreview(effective.title)}
                    </p>
                  </div>
                  <StatusPill status={status} t={t} />
                </div>
                <p
                  className="text-[12.5px] leading-relaxed line-clamp-3"
                  style={{ color: 'var(--color-text-muted, #9CA3AF)' }}
                >
                  {renderPreview(effective.body)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <EditModal
          editing={editing}
          setEditing={setEditing}
          onSave={() => saveMutation.mutate(editing)}
          onReset={() => resetMutation.mutate(editing.row)}
          saving={saveMutation.isPending}
          resetting={resetMutation.isPending}
          t={t}
        />
      )}
    </div>
  );
}

function EditModal({ editing, setEditing, onSave, onReset, saving, resetting, t }) {
  const { row, title, body, enabled } = editing;
  const hasOverride = !!row.override;
  const previewTitle = renderPreview(title);
  const previewBody = renderPreview(body);

  const status = !hasOverride ? 'default' : (row.override.enabled ? 'overridden' : 'disabled');

  return (
    <AdminModal
      isOpen={!!editing}
      onClose={() => setEditing(null)}
      title={t('admin.messageTemplates.editTitle', 'Edit message')}
      titleIcon={MessageSquare}
      subtitle={`${row.step_key.replace(/_/g, ' ')} · ${row.language.toUpperCase()}${row.category ? ` · ${row.category}` : ''}`}
      size="lg"
      footer={
        <>
          {hasOverride && (
            <button
              onClick={onReset}
              disabled={resetting || saving}
              className="px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
              style={{
                color: '#EF4444',
                backgroundColor: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.22)',
              }}
            >
              {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              {t('admin.messageTemplates.reset', 'Reset to default')}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setEditing(null)}
            className="px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
            style={{
              color: 'var(--color-text-muted, #9CA3AF)',
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {t('admin.messageTemplates.cancel', 'Cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={saving || !title.trim() || !body.trim()}
            className="px-4 py-2.5 rounded-xl text-[13px] font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: '#000' }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {t('admin.messageTemplates.save', 'Save override')}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <StatusPill status={status} t={t} />
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted, #9CA3AF)' }}>
              {t('admin.messageTemplates.enabled', 'Enabled')}
            </span>
            <Toggle
              checked={enabled}
              onChange={(v) => setEditing({ ...editing, enabled: v })}
              label={t('admin.messageTemplates.enabled', 'Enabled')}
            />
          </div>
        </div>

        {!enabled && hasOverride && (
          <p className="text-[12px] leading-relaxed px-3 py-2 rounded-lg"
            style={{
              color: '#EF4444',
              backgroundColor: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.18)',
            }}>
            {t('admin.messageTemplates.disabledHint', 'Disabled: this step will not send at your gym. The global default is overridden, not used as a fallback.')}
          </p>
        )}

        <div>
          <SectionLabel className="mb-2">{t('admin.messageTemplates.fieldTitle', 'Title')}</SectionLabel>
          <input
            type="text"
            value={title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl text-[14px] focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--color-text-primary, #E5E7EB)',
            }}
            placeholder={t('admin.messageTemplates.titlePlaceholder', 'Title shown in the notification')}
          />
        </div>

        <div>
          <SectionLabel className="mb-2">{t('admin.messageTemplates.fieldBody', 'Body')}</SectionLabel>
          <textarea
            value={body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            rows={5}
            className="w-full px-3 py-2.5 rounded-xl text-[14px] leading-relaxed focus:outline-none focus:ring-2 resize-y"
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--color-text-primary, #E5E7EB)',
            }}
            placeholder={t('admin.messageTemplates.bodyPlaceholder', 'Message body. Use {{first_name}} for personalization.')}
          />
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted, #6B7280)' }}>
            {t('admin.messageTemplates.tokenHint', 'Use {{first_name}} to insert the member\'s first name.')}
          </p>
        </div>

        <div>
          <SectionLabel className="mb-2">{t('admin.messageTemplates.preview', 'Preview')}</SectionLabel>
          <div className="rounded-xl px-4 py-3"
            style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
            <p className="text-[14px] font-bold mb-1"
              style={{ color: 'var(--color-text-primary, #E5E7EB)' }}>
              {previewTitle || (
                <span style={{ color: 'var(--color-text-muted, #6B7280)' }}>
                  {t('admin.messageTemplates.previewEmpty', '(empty title)')}
                </span>
              )}
            </p>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--color-text-muted, #9CA3AF)' }}>
              {previewBody || (
                <span>{t('admin.messageTemplates.previewBodyEmpty', '(empty body)')}</span>
              )}
            </p>
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted, #6B7280)' }}>
            {t('admin.messageTemplates.previewHint', { defaultValue: 'Showing {{first_name}} replaced with "{{name}}" as a sample.', name: FAKE_NAME })}
          </p>
        </div>
      </div>
    </AdminModal>
  );
}
