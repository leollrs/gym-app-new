/**
 * AdminMessageTemplates — browse + override the lifecycle / winback
 * message_templates seeded in migration 0403. Global defaults (gym_id IS NULL)
 * are read-only here; per-gym overrides write rows with the current gym_id.
 *
 * Reset = DELETE the gym row so the global default takes over again.
 * Disable = keep the gym row with enabled=false, which the SQL lookup
 *   functions treat as an explicit opt-out (skips that send entirely).
 *
 * Restyled onto retosKit per the "Plantillas de Mensajes" design: centered
 * header, two icon tabs (lifecycle / win-back), a 2-col grid of template cards
 * each with an inline enable/disable toggle, and a restyled edit modal.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import posthogClient from 'posthog-js';
import { MessageSquare } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { AdminModal, AdminPageShell, FadeIn } from '../../components/admin';
import { TK, FK, TONE, Ico, Card } from './components/retosKit';

const FAKE_NAME = 'Maria';

const PLIC = {
  heart: <path d="M12 20s-7-4.5-9.5-9C1 8 2.5 4.5 6 4.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 6.5C19 15.5 12 20 12 20Z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></>,
  message: <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z" />,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
};

// winback cancel-reason category → tone
const CAT_TONE = { EXPERIENCE: 'info', FINANCIAL: 'good', NO_RESULTS: 'coach', TIME: 'warn', OTHER: 'neutral' };

/** Render preview by substituting {{first_name}}. */
function renderPreview(text) {
  return (text || '').replace(/\{\{first_name\}\}/g, FAKE_NAME);
}

/** Group rows by (kind, step_key, language, category): global default + gym override. */
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

function dayLabel(stepKey, t) {
  const m = /^day_(\d+)$/.exec(stepKey || '');
  if (m) return `${t('admin.messageTemplates.day', { defaultValue: 'Day' })} ${m[1]}`.toUpperCase();
  return (stepKey || '').replace(/_/g, ' ').toUpperCase();
}

// ── small presentational bits ──
function Spin() {
  return <span className="animate-spin" style={{ width: 14, height: 14, borderRadius: 99, border: '2px solid color-mix(in srgb, currentColor 35%, transparent)', borderTopColor: 'currentColor', display: 'inline-block' }} />;
}

function Lbl({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textMute, marginBottom: 8 }}>{children}</div>;
}

function MetaTag({ children, lang = false }) {
  return <span style={{ fontFamily: FK.mono, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: lang ? TK.accent : TK.textFaint }}>{children}</span>;
}

// winback cancel-reason category → human-readable label (DB stores lowercase codes).
function catLabel(cat, t) {
  const key = String(cat || '').toLowerCase();
  const fallbacks = {
    financial: 'Cost', time: 'Time', no_results: 'No results',
    experience: 'Experience', other: 'Other',
  };
  return t(`admin.messageTemplates.categories.${key}`, { defaultValue: fallbacks[key] || (cat || '') });
}

function CatTag({ cat, t }) {
  const tone = CAT_TONE[String(cat || '').toUpperCase()] || 'neutral';
  const c = TONE[tone] || TONE.neutral;
  const neutral = tone === 'neutral';
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, background: neutral ? TK.surface3 : c.bg, border: `1px solid ${neutral ? TK.borderSolid : c.line}`, fontFamily: FK.body, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: neutral ? TK.textMute : c.ink, whiteSpace: 'nowrap' }}>{catLabel(cat, t)}</span>
  );
}

function StatusPill({ status, t }) {
  const map = {
    default: { tone: 'neutral', label: t('admin.messageTemplates.statusDefault', 'Default') },
    overridden: { tone: 'accent', label: t('admin.messageTemplates.statusOverridden', 'Overridden') },
    disabled: { tone: 'hot', label: t('admin.messageTemplates.statusDisabled', 'Disabled') },
  };
  const cfg = map[status] || map.default;
  const c = TONE[cfg.tone] || TONE.neutral;
  const neutral = cfg.tone === 'neutral';
  return (
    <span style={{ fontFamily: FK.body, fontSize: 9.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: neutral ? TK.textFaint : c.ink, background: neutral ? TK.surface3 : c.bg, border: neutral ? `1px solid ${TK.borderSolid}` : `1px solid ${c.line}`, padding: '4px 9px', borderRadius: 6, whiteSpace: 'nowrap' }}>{cfg.label}</span>
  );
}

function Switch({ on, disabled = false }) {
  return (
    <span style={{ width: 38, height: 21, borderRadius: 99, flexShrink: 0, opacity: disabled ? 0.55 : 1, background: on ? TK.accent : TK.surface3, border: `1px solid ${on ? TK.accent : TK.borderSolid}`, position: 'relative', transition: 'background .2s, border-color .2s', display: 'inline-block' }}>
      <span style={{ position: 'absolute', top: 1.5, left: on ? 18.5 : 1.5, width: 16, height: 16, borderRadius: 99, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .2s' }} />
    </span>
  );
}

// ── tab nav (centered icon tabs) ──
function PlTabs({ tabs, active, onPick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${TK.borderSolid}`, margin: '24px auto', maxWidth: 760 }}>
      {tabs.map(tab => {
        const on = tab.key === active;
        return (
          <button key={tab.key} type="button" onClick={() => onPick(tab.key)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '6px 0 16px', position: 'relative', cursor: 'pointer', background: 'transparent', border: 'none' }}>
            <Ico ch={tab.icon} size={18} color={on ? TK.accent : TK.textMute} stroke={on ? 2.1 : 1.9} />
            <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: on ? 700 : 600, color: on ? TK.accent : TK.textMute }}>{tab.label}</span>
            {on && <span style={{ position: 'absolute', left: '35%', right: '35%', bottom: -1, height: 2.5, borderRadius: 99, background: TK.accent }} />}
          </button>
        );
      })}
    </div>
  );
}

// ── template card (inline toggle + click to edit) ──
function TemplateCard({ row, t, onEdit, onToggle, shownEnabled, toggleDisabled }) {
  const effective = row.override ?? row.global;
  if (!effective) return null;
  const status = !row.override ? 'default' : (row.override.enabled ? 'overridden' : 'disabled');
  return (
    <Card onClick={onEdit} style={{ padding: '18px 20px', cursor: 'pointer', opacity: shownEnabled ? 1 : 0.62, transition: 'opacity .2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <MetaTag>{dayLabel(row.step_key, t)}</MetaTag>
          <span style={{ color: TK.textFaint, fontSize: 11 }}>/</span>
          <MetaTag lang>{row.language.toUpperCase()}</MetaTag>
          {row.category && <><span style={{ color: TK.textFaint, fontSize: 11 }}>/</span><CatTag cat={row.category} t={t} /></>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <StatusPill status={status} t={t} />
          <span
            role="switch"
            aria-checked={shownEnabled}
            onClick={(e) => { e.stopPropagation(); if (!toggleDisabled) onToggle(); }}
            style={{ cursor: toggleDisabled ? 'default' : 'pointer', display: 'inline-flex' }}
          >
            <Switch on={shownEnabled} disabled={toggleDisabled} />
          </span>
        </div>
      </div>
      <div style={{ fontFamily: FK.display, fontSize: 17, fontWeight: 800, color: TK.text, letterSpacing: -0.3 }}>{renderPreview(effective.title)}</div>
      <p style={{ margin: '8px 0 0', fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{renderPreview(effective.body)}</p>
    </Card>
  );
}

export default function AdminMessageTemplates() {
  const { profile, availableRoles } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [kindTab, setKindTab] = useState('lifecycle');
  const [editing, setEditing] = useState(null); // { row, title, body, enabled }
  const [pendingToggle, setPendingToggle] = useState(null); // { key, value }

  useEffect(() => {
    document.title = `${t('admin.messageTemplates.title', 'Message Templates')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  const { data: allTemplates = [], isLoading } = useQuery({
    queryKey: adminKeys.messageTemplates(gymId),
    queryFn: async () => {
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

  // Save = upsert per-gym override row (used by the modal AND the inline toggle).
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
          .insert({ gym_id: gymId, kind: row.kind, step_key: row.step_key, language: row.language, category: row.category, title, body, enabled })
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
      posthogClient?.capture('admin_template_saved', { kind: 'message' });
      queryClient.invalidateQueries({ queryKey: adminKeys.messageTemplates(gymId) });
      setEditing(null);
      showToast(t('admin.messageTemplates.saved', 'Template saved'), 'success');
    },
    onError: () => {
      showToast(t('admin.messageTemplates.saveFailed', 'Failed to save template'), 'error');
    },
    onSettled: () => setPendingToggle(null),
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
    onSettled: () => setPendingToggle(null),
  });

  const openEdit = (row) => {
    const effective = row.override ?? row.global;
    if (!effective) return;
    setEditing({ row, title: effective.title, body: effective.body, enabled: row.override ? row.override.enabled : true });
  };

  // Inline toggle: enable/disable this template at the gym.
  const handleToggle = (row, nextEnabled) => {
    const effective = row.override ?? row.global;
    if (!effective) return;
    setPendingToggle({ key: row.key, value: nextEnabled });
    // Re-enabling an override that never changed the wording → delete it so it
    // reverts to a clean "Default" instead of a content-identical "Overridden".
    if (nextEnabled && row.override && row.global
      && row.override.title === row.global.title
      && row.override.body === row.global.body) {
      resetMutation.mutate(row);
      return;
    }
    saveMutation.mutate({ row, title: effective.title, body: effective.body, enabled: nextEnabled });
  };

  if (!isAuthorized) {
    return (
      <AdminPageShell>
        <Card style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute }}>
            {t('admin.messageTemplates.notAuthorized', 'You must be a gym admin to edit message templates.')}
          </p>
        </Card>
      </AdminPageShell>
    );
  }

  const tabs = [
    { key: 'lifecycle', label: t('admin.messageTemplates.tabLifecycle', 'Lifecycle'), icon: PLIC.heart },
    { key: 'winback', label: t('admin.messageTemplates.tabWinback', 'Win-Back'), icon: PLIC.mail },
  ];

  return (
    <AdminPageShell>
      {/* centered header */}
      <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto' }}>
        <h1 className="admin-page-title" style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: -1.1, lineHeight: 1 }}>{t('admin.messageTemplates.title', 'Message Templates')}</h1>
        <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 10, lineHeight: 1.5 }}>{t('admin.messageTemplates.subtitle', 'Override the platform defaults for lifecycle and win-back messages. Disable to skip a step entirely at your gym.')}</div>
      </div>

      <PlTabs tabs={tabs} active={kindTab} onPick={setKindTab} />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[18px]">
          {[...Array(4)].map((_, i) => (
            <Card key={i} style={{ padding: '18px 20px' }}>
              <div className="animate-pulse" style={{ height: 11, width: '38%', background: TK.surface2, borderRadius: 6, marginBottom: 13 }} />
              <div className="animate-pulse" style={{ height: 16, width: '70%', background: TK.surface2, borderRadius: 6, marginBottom: 10 }} />
              <div className="animate-pulse" style={{ height: 12, width: '100%', background: TK.surface2, borderRadius: 6 }} />
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Ico ch={PLIC.message} size={30} color={TK.textFaint} stroke={1.7} style={{ margin: '0 auto 12px' }} />
          <p style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute }}>{t('admin.messageTemplates.empty', 'No templates available.')}</p>
        </Card>
      ) : (
        <FadeIn delay={0.05} key={kindTab}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[18px]">
            {rows.map((row) => {
              const isEnabled = row.override ? row.override.enabled : true;
              const pend = pendingToggle?.key === row.key ? pendingToggle.value : null;
              const shownEnabled = pend != null ? pend : isEnabled;
              return (
                <TemplateCard
                  key={row.key}
                  row={row}
                  t={t}
                  onEdit={() => openEdit(row)}
                  onToggle={() => handleToggle(row, !shownEnabled)}
                  shownEnabled={shownEnabled}
                  toggleDisabled={pendingToggle?.key === row.key}
                />
              );
            })}
          </div>
        </FadeIn>
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
    </AdminPageShell>
  );
}

function EditModal({ editing, setEditing, onSave, onReset, saving, resetting, t }) {
  const { row, title, body, enabled } = editing;
  const hasOverride = !!row.override;
  const previewTitle = renderPreview(title);
  const previewBody = renderPreview(body);
  const status = !hasOverride ? 'default' : (row.override.enabled ? 'overridden' : 'disabled');

  const inputBase = {
    width: '100%', padding: '11px 13px', borderRadius: 11, fontSize: 14,
    background: TK.surface2, border: `1px solid ${TK.borderSolid}`, color: TK.text, outline: 'none',
  };
  const onFocus = (e) => { e.target.style.borderColor = TK.accent; };
  const onBlur = (e) => { e.target.style.borderColor = TK.borderSolid; };
  const btnBase = { padding: '10px 16px', borderRadius: 11, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid transparent' };

  return (
    <AdminModal
      isOpen={!!editing}
      onClose={() => setEditing(null)}
      title={t('admin.messageTemplates.editTitle', 'Edit message')}
      titleIcon={MessageSquare}
      subtitle={`${dayLabel(row.step_key, t)} · ${row.language.toUpperCase()}${row.category ? ` · ${catLabel(row.category, t)}` : ''}`}
      size="lg"
      footer={
        <>
          {hasOverride && (
            <button onClick={onReset} disabled={resetting || saving} style={{ ...btnBase, color: 'var(--color-danger)', background: 'var(--color-danger-soft)', borderColor: 'color-mix(in srgb, var(--color-danger) 24%, transparent)', opacity: (resetting || saving) ? 0.5 : 1 }}>
              {resetting ? <Spin /> : <Ico ch={PLIC.reset} size={14} color="var(--color-danger)" stroke={2.1} />}
              {t('admin.messageTemplates.reset', 'Reset to default')}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => setEditing(null)} style={{ ...btnBase, color: TK.textSub, background: TK.surface2, borderColor: TK.borderSolid }}>
            {t('admin.messageTemplates.cancel', 'Cancel')}
          </button>
          <button onClick={onSave} disabled={saving || !title.trim() || !body.trim()} style={{ ...btnBase, fontWeight: 800, color: '#fff', background: TK.accent, borderColor: 'transparent', opacity: (saving || !title.trim() || !body.trim()) ? 0.5 : 1 }}>
            {saving ? <Spin /> : <Ico ch={PLIC.save} size={14} color="#fff" stroke={2.1} />}
            {t('admin.messageTemplates.save', 'Save override')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <StatusPill status={status} t={t} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: FK.body, fontSize: 12, fontWeight: 600, color: TK.textMute }}>{t('admin.messageTemplates.enabled', 'Enabled')}</span>
            <span role="switch" aria-checked={enabled} onClick={() => setEditing({ ...editing, enabled: !enabled })} style={{ cursor: 'pointer', display: 'inline-flex' }}>
              <Switch on={enabled} />
            </span>
          </div>
        </div>

        {!enabled && hasOverride && (
          <p style={{ margin: 0, fontFamily: FK.body, fontSize: 12, lineHeight: 1.5, padding: '9px 12px', borderRadius: 10, color: 'var(--color-danger-ink, var(--color-danger))', background: 'var(--color-danger-soft)', border: '1px solid color-mix(in srgb, var(--color-danger) 20%, transparent)' }}>
            {t('admin.messageTemplates.disabledHint', 'Disabled: this step will not send at your gym. The global default is overridden, not used as a fallback.')}
          </p>
        )}

        <div>
          <Lbl>{t('admin.messageTemplates.fieldTitle', 'Title')}</Lbl>
          <input type="text" value={title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} onFocus={onFocus} onBlur={onBlur} style={inputBase} placeholder={t('admin.messageTemplates.titlePlaceholder', 'Title shown in the notification')} />
        </div>

        <div>
          <Lbl>{t('admin.messageTemplates.fieldBody', 'Body')}</Lbl>
          <textarea value={body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} onFocus={onFocus} onBlur={onBlur} rows={5} style={{ ...inputBase, lineHeight: 1.5, resize: 'vertical' }} placeholder={t('admin.messageTemplates.bodyPlaceholder', 'Message body. Use {{first_name}} for personalization.')} />
          <p style={{ fontFamily: FK.body, fontSize: 11, marginTop: 6, color: TK.textFaint }}>{t('admin.messageTemplates.tokenHint', 'Use {{first_name}} to insert the member\'s first name.')}</p>
        </div>

        <div>
          <Lbl>{t('admin.messageTemplates.preview', 'Preview')}</Lbl>
          <div style={{ borderRadius: 12, padding: '14px 16px', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
            <p style={{ margin: 0, fontFamily: FK.display, fontSize: 14.5, fontWeight: 800, color: TK.text }}>
              {previewTitle || <span style={{ color: TK.textFaint }}>{t('admin.messageTemplates.previewEmpty', '(empty title)')}</span>}
            </p>
            <p style={{ margin: '6px 0 0', fontFamily: FK.body, fontSize: 13, lineHeight: 1.5, color: TK.textMute, whiteSpace: 'pre-wrap' }}>
              {previewBody || <span style={{ color: TK.textFaint }}>{t('admin.messageTemplates.previewBodyEmpty', '(empty body)')}</span>}
            </p>
          </div>
          <p style={{ fontFamily: FK.body, fontSize: 11, marginTop: 6, color: TK.textFaint }}>{t('admin.messageTemplates.previewHint', { defaultValue: 'Showing {{first_name}} replaced with "{{name}}" as a sample.', name: FAKE_NAME })}</p>
        </div>
      </div>
    </AdminModal>
  );
}
