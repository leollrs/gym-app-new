import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Image, Type, MousePointerClick, FileText, Loader2,
  Save, Send, Copy, ArrowLeft, Eye, Gift,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { supabase } from '../../../lib/supabase';
import { AdminCard, Toggle } from '../../../components/admin';
import { generateEmailHtml } from '../../../lib/admin/emailTemplateRenderer';
import { TEMPLATE_TYPES, TEMPLATE_VARIABLES } from './emailTemplatePrebuilts';
import { kindMeta, toneStyles } from './emailTemplateKinds';
import EmailLivePreview from './EmailLivePreview';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';
const inputClass = 'w-full rounded-[10px] px-3 py-2.5 text-[13.5px] outline-none transition-colors bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] text-[var(--color-admin-text)] placeholder:text-[var(--color-admin-text-faint)] focus:border-[var(--color-accent)]';

// Inline UI helpers — only used inside this editor.
function VariablePill({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] text-[11px] font-semibold transition-colors"
      style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        color: 'var(--color-accent)',
        background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
      }}
    >
      <span>{label}</span>
    </button>
  );
}

function SectionBlock({ title, icon: Icon, enabled, onToggle, children, toggleAriaLabel }) {
  const open = onToggle ? enabled : true;
  return (
    <AdminCard padding="p-0">
      <div
        className="flex items-center gap-3 px-4 py-3.5"
        style={{ background: 'var(--color-bg-deep)', borderBottom: open ? '1px solid var(--color-border-subtle)' : 'none' }}
      >
        <div
          className="grid place-items-center flex-shrink-0"
          style={{ width: 30, height: 30, borderRadius: 9, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
        >
          <Icon size={15} strokeWidth={2} style={{ color: 'var(--color-accent)' }} />
        </div>
        <span className="flex-1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 14, color: 'var(--color-admin-text)', letterSpacing: '-0.2px' }}>{title}</span>
        {onToggle && <Toggle value={enabled} onChange={onToggle} label={toggleAriaLabel || title} />}
      </div>
      {open && <div className="p-[18px] space-y-3">{children}</div>}
    </AdminCard>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Edit-an-email-template view. Two columns on desktop (form on the left,
 * `EmailLivePreview` on the right); single column with a slide-in preview
 * drawer below `lg`. Owns local template state, the test-email flow, and
 * HTML clipboard export. Persistence is delegated to the parent via `onSave`.
 */
export default function EmailTemplateEditor({ initial, onSave, onCancel, gymName, gymLogoUrl, saving }) {
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const { user, profile } = useAuth();
  const gymId = profile?.gym_id;
  const isEs = i18n.language?.startsWith('es');

  // The gym's own rewards catalog — what the admin already configured under
  // /admin/rewards. We surface these as a picker inside the Reward section so
  // the email can attach to a real listed reward instead of free-form copy.
  const { data: gymRewards = [] } = useQuery({
    queryKey: ['gym-rewards-active', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_rewards')
        .select('id, name, name_es, description, description_es, emoji_icon, cost_points, is_active')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('sort_order');
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });
  const rewardName = (r) => (isEs ? (r.name_es || r.name) : r.name);
  const rewardDesc = (r) => (isEs ? (r.description_es || r.description) : r.description);
  const [template, setTemplate] = useState(initial);
  const bodyRef = useRef(null);
  const [testEmail, setTestEmail] = useState(user?.email || '');
  const [sendingTest, setSendingTest] = useState(false);
  // Mobile preview drawer — desktop has the side panel; below `lg` we surface
  // a fullscreen preview behind a button so admins can actually see what they're editing.
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  // Dotted-path setter. Auto-creates missing intermediates — older templates
  // (rows from before `reward` was part of the schema) don't have every nested
  // object seeded, and writing `set('reward.enabled', true)` was crashing in
  // Safari with "undefined is not an object (evaluating 'obj[parts[…]] = …')".
  const set = useCallback((path, value) => {
    setTemplate(prev => {
      const parts = path.split('.');
      const copy = JSON.parse(JSON.stringify(prev));
      let obj = copy;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (obj[key] == null || typeof obj[key] !== 'object') obj[key] = {};
        obj = obj[key];
      }
      obj[parts[parts.length - 1]] = value;
      copy.updatedAt = new Date().toISOString();
      return copy;
    });
  }, []);

  const insertVariable = useCallback((token) => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = template.body.text;
    const newText = text.substring(0, start) + token + text.substring(end);
    set('body.text', newText);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }, [template.body.text, set]);

  const handleSave = () => {
    if (!template.name.trim()) {
      showToast(t('admin.emailTemplates.nameRequired'), 'error');
      return;
    }
    onSave(template);
  };

  const handleExportHtml = async () => {
    const html = generateEmailHtml(template, gymName, gymLogoUrl);
    try {
      await navigator.clipboard.writeText(html);
      showToast(t('admin.emailTemplates.htmlCopied'), 'success');
    } catch {
      showToast(t('admin.emailTemplates.htmlCopyFailed'), 'error');
    }
  };

  const handleSendTest = async () => {
    if (!testEmail.trim()) {
      showToast(t('admin.emailTemplates.enterEmail'), 'error');
      return;
    }
    setSendingTest(true);
    try {
      const html = generateEmailHtml(template, gymName, gymLogoUrl);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');
      const { error } = await supabase.functions.invoke('send-admin-email', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          testMode: true,
          to: testEmail.trim(),
          subject: `[Test] ${template.name || 'Email Template'}`,
          html,
        },
      });
      if (error) throw error;
      showToast(t('admin.emailTemplates.testSent'), 'success');
    } catch {
      showToast(t('admin.emailTemplates.testFailed'), 'error');
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-0 h-full min-h-[calc(100vh-120px)]">
      {/* Left: Editor */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto w-full max-w-[780px] space-y-4">
        {/* Top bar */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onCancel}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-admin-text-sub)' }}
            aria-label={t('admin.emailTemplates.back')}
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="flex-1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18, color: 'var(--color-admin-text)', letterSpacing: '-0.3px' }}>
            {initial.name ? t('admin.emailTemplates.editTemplate') : t('admin.emailTemplates.newTemplate')}
          </h2>
          {/* Mobile-only preview trigger — desktop has the side panel. */}
          <button
            onClick={() => setMobilePreviewOpen(true)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold min-h-[44px]"
            style={{ color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
          >
            <Eye size={14} /> {t('admin.emailTemplates.preview', 'Preview')}
          </button>
        </div>

        {/* Name & Type */}
        <AdminCard>
          <div className="space-y-3">
            <Field label={t('admin.emailTemplates.templateName')}>
              <input
                value={template.name}
                onChange={e => set('name', e.target.value)}
                placeholder={t('admin.emailTemplates.templateNamePlaceholder')}
                className={inputClass}
              />
            </Field>
            <Field label={t('admin.emailTemplates.templateType')}>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_TYPES.map(({ key }) => {
                  const { Icon, tone } = kindMeta(key);
                  const c = toneStyles(tone);
                  const on = template.type === key;
                  return (
                    <button
                      key={key}
                      onClick={() => set('type', key)}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12.5px] font-bold transition-colors"
                      style={{
                        color: on ? c.ink : 'var(--color-admin-text-sub)',
                        background: on ? c.bg : 'var(--color-admin-panel)',
                        border: `1px solid ${on ? 'transparent' : 'var(--color-admin-border)'}`,
                      }}
                    >
                      <Icon size={14} strokeWidth={2} style={{ color: on ? c.fg : 'var(--color-admin-text-muted)' }} />
                      {t(`admin.emailTemplates.types.${key}`)}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </AdminCard>

        {/* Header Section */}
        <SectionBlock
          title={t('admin.emailTemplates.headerSection')}
          icon={Type}
          enabled={template.header.enabled}
          onToggle={v => set('header.enabled', v)}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.emailTemplates.showLogo')}</span>
            <Toggle value={template.header.showLogo} onChange={v => set('header.showLogo', v)} label={t('admin.emailTemplates.showLogo')} />
          </div>
          <Field label={t('admin.emailTemplates.headerText')}>
            <input
              value={template.header.text}
              onChange={e => set('header.text', e.target.value)}
              placeholder={t('admin.emailTemplates.headerTextPlaceholder')}
              className={inputClass}
            />
          </Field>
        </SectionBlock>

        {/* Hero Section */}
        <SectionBlock
          title={t('admin.emailTemplates.heroSection')}
          icon={Image}
          enabled={template.hero.enabled}
          onToggle={v => set('hero.enabled', v)}
        >
          <Field label={t('admin.emailTemplates.heroImageUrl')}>
            <input
              value={template.hero.imageUrl}
              onChange={e => set('hero.imageUrl', e.target.value)}
              placeholder={t('admin.emailTemplates.urlPlaceholder', 'https://...')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.heroHeadline')}>
            <input
              value={template.hero.headline}
              onChange={e => set('hero.headline', e.target.value)}
              placeholder={t('admin.emailTemplates.heroHeadlinePlaceholder')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.heroSubtitle')}>
            <input
              value={template.hero.subtitle}
              onChange={e => set('hero.subtitle', e.target.value)}
              placeholder={t('admin.emailTemplates.heroSubtitlePlaceholder')}
              className={inputClass}
            />
          </Field>
        </SectionBlock>

        {/* Body Section */}
        <SectionBlock title={t('admin.emailTemplates.bodySection')} icon={FileText} enabled={true}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-[10px] font-semibold text-[var(--color-admin-text-muted)] uppercase tracking-wider mr-1 self-center">
              {t('admin.emailTemplates.insertVariable')}
            </span>
            {TEMPLATE_VARIABLES.map(v => (
              <VariablePill
                key={v.key}
                label={t(`admin.emailTemplates.variables.${v.key}`)}
                onClick={() => insertVariable(v.token)}
              />
            ))}
          </div>
          <textarea
            ref={bodyRef}
            value={template.body.text}
            onChange={e => set('body.text', e.target.value)}
            rows={10}
            placeholder={t('admin.emailTemplates.bodyPlaceholder')}
            className={`${inputClass} resize-y min-h-[160px]`}
          />
          <p className="text-[10px] text-[var(--color-admin-text-muted)]">{t('admin.emailTemplates.bodyHint')}</p>
        </SectionBlock>

        {/* CTA Section */}
        <SectionBlock
          title={t('admin.emailTemplates.ctaSection')}
          icon={MousePointerClick}
          enabled={template.cta.enabled}
          onToggle={v => set('cta.enabled', v)}
        >
          <Field label={t('admin.emailTemplates.ctaText')}>
            <input
              value={template.cta.text}
              onChange={e => set('cta.text', e.target.value)}
              placeholder={t('admin.emailTemplates.ctaTextPlaceholder')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.ctaUrl')}>
            <div className="flex items-center gap-2">
              <input
                value={template.cta.url}
                onChange={e => set('cta.url', e.target.value)}
                placeholder={t('admin.emailTemplates.urlPlaceholder', 'https://...')}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') set('cta.url', window.location.origin);
                }}
                className="px-3 py-2 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent, #D4AF37) 12%, transparent)',
                  color: 'var(--color-accent, #D4AF37)',
                  border: '1px solid color-mix(in srgb, var(--color-accent, #D4AF37) 25%, transparent)',
                }}
              >
                {t('admin.emailTemplates.useAppUrl', 'Use app URL')}
              </button>
            </div>
            {template.cta.enabled && !template.cta.url && (
              <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--color-warning, #F59E0B)' }}>
                {t('admin.emailTemplates.ctaUrlMissing', 'Button has no link — recipients clicking it will go nowhere.')}
              </p>
            )}
          </Field>
          <Field label={t('admin.emailTemplates.ctaColor')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={template.cta.color}
                onChange={e => set('cta.color', e.target.value)}
                className="w-8 h-8 rounded-lg border border-[var(--color-admin-border)] cursor-pointer bg-transparent"
              />
              <input
                value={template.cta.color}
                onChange={e => set('cta.color', e.target.value)}
                className={`${inputClass} flex-1`}
              />
            </div>
          </Field>
        </SectionBlock>

        {/* Reward Section */}
        <SectionBlock
          title={t('admin.emailTemplates.rewardSection', 'Reward / Offer')}
          icon={Gift}
          enabled={template.reward?.enabled || false}
          onToggle={v => set('reward.enabled', v)}
        >
          {/* Catalog picker — pulls from the gym's configured rewards
              (/admin/rewards). Picking one prefills title + description; the
              fields below stay editable so admins can tweak the copy. */}
          <Field label={t('admin.emailTemplates.chooseFromCatalog', 'Choose from your rewards')}>
            <select
              value={template.reward?.reward_id || ''}
              onChange={e => {
                const id = e.target.value;
                const picked = gymRewards.find(r => r.id === id);
                setTemplate(prev => ({
                  ...prev,
                  reward: {
                    ...(prev.reward || {}),
                    reward_id: id || '',
                    ...(picked ? {
                      title: `${picked.emoji_icon || '🎁'} ${rewardName(picked)}`,
                      description: rewardDesc(picked) || prev.reward?.description || '',
                    } : {}),
                  },
                  updatedAt: new Date().toISOString(),
                }));
              }}
              className={inputClass}
            >
              <option value="">
                {gymRewards.length === 0
                  ? t('admin.emailTemplates.catalogEmpty', 'No rewards configured — set them up in Rewards')
                  : t('admin.emailTemplates.customReward', '— Custom (enter manually) —')}
              </option>
              {gymRewards.map(r => (
                <option key={r.id} value={r.id}>
                  {(r.emoji_icon || '🎁') + ' ' + rewardName(r)}
                  {r.cost_points ? ` · ${r.cost_points} ${t('admin.emailTemplates.pointsShort', 'pts')}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('admin.emailTemplates.rewardTitle', 'Reward Title')}>
            <input
              value={template.reward?.title || ''}
              onChange={e => set('reward.title', e.target.value)}
              placeholder={t('admin.emailTemplates.rewardTitlePlaceholder', 'e.g. Free PT Session, 50% Off')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.rewardDescription', 'Description')}>
            <input
              value={template.reward?.description || ''}
              onChange={e => set('reward.description', e.target.value)}
              placeholder={t('admin.emailTemplates.rewardDescPlaceholder', 'Show this email at the front desk')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.rewardCode', 'Promo Code (optional)')}>
            <input
              value={template.reward?.code || ''}
              onChange={e => set('reward.code', e.target.value)}
              placeholder={t('admin.emailTemplates.promoCodePlaceholder', 'COMEBACK20')}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.rewardExpiry', 'Expiry Text (optional)')}>
            <input
              value={template.reward?.expiry || ''}
              onChange={e => set('reward.expiry', e.target.value)}
              placeholder={t('admin.emailTemplates.rewardExpiryPlaceholder', 'Valid until Dec 31')}
              className={inputClass}
            />
          </Field>
        </SectionBlock>

        {/* Typography & Layout */}
        <AdminCard>
          <p className="text-[12px] font-semibold text-[var(--color-admin-text-muted)] uppercase tracking-wider mb-3">
            {t('admin.emailTemplates.typography', 'Typography & Layout')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('admin.emailTemplates.fontSize', 'Body Font Size')}>
              <select
                value={template.typography?.fontSize || '15'}
                onChange={e => set('typography.fontSize', e.target.value)}
                className={inputClass}
              >
                <option value="13">13px — {t('admin.emailTemplates.fontSizeCompact', 'Compact')}</option>
                <option value="14">14px — {t('admin.emailTemplates.fontSizeSmall', 'Small')}</option>
                <option value="15">15px — {t('admin.emailTemplates.fontSizeDefault', 'Default')}</option>
                <option value="16">16px — {t('admin.emailTemplates.fontSizeMedium', 'Medium')}</option>
                <option value="17">17px — {t('admin.emailTemplates.fontSizeLarge', 'Large')}</option>
              </select>
            </Field>
            <Field label={t('admin.emailTemplates.borderRadius', 'Card Corners')}>
              <select
                value={template.typography?.borderRadius || '12'}
                onChange={e => set('typography.borderRadius', e.target.value)}
                className={inputClass}
              >
                <option value="0">{t('admin.emailTemplates.cornersSharp', 'Sharp')} (0px)</option>
                <option value="8">{t('admin.emailTemplates.cornersSubtle', 'Subtle')} (8px)</option>
                <option value="12">{t('admin.emailTemplates.cornersRounded', 'Rounded')} (12px)</option>
                <option value="20">{t('admin.emailTemplates.cornersExtra', 'Extra Round')} (20px)</option>
              </select>
            </Field>
            <Field label={t('admin.emailTemplates.padding', 'Content Padding')}>
              <select
                value={template.typography?.padding || '40'}
                onChange={e => set('typography.padding', e.target.value)}
                className={inputClass}
              >
                <option value="24">{t('admin.emailTemplates.paddingTight', 'Tight')} (24px)</option>
                <option value="32">{t('admin.emailTemplates.paddingNormal', 'Normal')} (32px)</option>
                <option value="40">{t('admin.emailTemplates.paddingSpacious', 'Spacious')} (40px)</option>
                <option value="48">{t('admin.emailTemplates.paddingExtra', 'Extra')} (48px)</option>
              </select>
            </Field>
            <Field label={t('admin.emailTemplates.headerStyle', 'Header Style')}>
              <select
                value={template.typography?.headerStyle || 'gradient'}
                onChange={e => set('typography.headerStyle', e.target.value)}
                className={inputClass}
              >
                <option value="gradient">{t('admin.emailTemplates.headerGradient', 'Gradient')}</option>
                <option value="solid">{t('admin.emailTemplates.headerSolid', 'Solid Color')}</option>
                <option value="minimal">{t('admin.emailTemplates.headerMinimal', 'Minimal (Logo Only)')}</option>
                <option value="none">{t('admin.emailTemplates.headerNone', 'None')}</option>
              </select>
            </Field>
          </div>
        </AdminCard>

        {/* Footer Section */}
        <SectionBlock
          title={t('admin.emailTemplates.footerSection')}
          icon={FileText}
          enabled={template.footer.enabled}
          onToggle={v => set('footer.enabled', v)}
        >
          <Field label={t('admin.emailTemplates.footerText')}>
            <input
              value={template.footer.text}
              onChange={e => set('footer.text', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('admin.emailTemplates.unsubscribeText')}>
            <input
              value={template.footer.unsubscribeText}
              onChange={e => set('footer.unsubscribeText', e.target.value)}
              className={inputClass}
            />
          </Field>
        </SectionBlock>

        {/* Color Scheme */}
        <AdminCard>
          <p className="text-[12px] font-semibold text-[var(--color-admin-text-muted)] uppercase tracking-wider mb-3">
            {t('admin.emailTemplates.colorScheme')}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {['primary', 'background', 'text'].map(key => (
              <Field key={key} label={t(`admin.emailTemplates.colors.${key}`)}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={template.colors[key]}
                    onChange={e => set(`colors.${key}`, e.target.value)}
                    className="w-7 h-7 rounded border border-[var(--color-admin-border)] cursor-pointer bg-transparent flex-shrink-0"
                  />
                  <input
                    value={template.colors[key]}
                    onChange={e => set(`colors.${key}`, e.target.value)}
                    className={`${inputClass} text-[11px]`}
                  />
                </div>
              </Field>
            ))}
          </div>
        </AdminCard>

        {/* Send Test Email */}
        <AdminCard>
          <p className="text-[12px] font-semibold text-[var(--color-admin-text-muted)] uppercase tracking-wider mb-3">
            {t('admin.emailTemplates.sendTestTitle')}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder={t('admin.emailTemplates.testEmailPlaceholder')}
              className={`${inputClass} flex-1`}
            />
            <button
              onClick={handleSendTest}
              disabled={sendingTest}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-[13px] text-[var(--color-admin-text)] bg-[var(--color-admin-panel)] border border-[var(--color-admin-border)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
            >
              {sendingTest ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {t('admin.emailTemplates.sendTest')}
            </button>
          </div>
        </AdminCard>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pb-8">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[13px] transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {t('admin.emailTemplates.save')}
          </button>
          <button
            onClick={handleExportHtml}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-[13px] text-[var(--color-admin-text)] bg-[var(--color-admin-panel)] border border-[var(--color-admin-border)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Copy size={15} /> {t('admin.emailTemplates.exportHtml')}
          </button>
        </div>
        </div>
      </div>

      {/* Right: Live Preview (desktop) — dark "stage" backdrop, per the design */}
      <div className="hidden lg:flex flex-col w-[460px] flex-shrink-0" style={{ borderLeft: '1px solid var(--color-admin-border)', background: '#0b0b12' }}>
        <EmailLivePreview template={template} gymName={gymName} gymLogoUrl={gymLogoUrl} />
      </div>

      {/* Mobile preview overlay — fullscreen drawer slides in from the right */}
      {mobilePreviewOpen && (
        <div className="lg:hidden fixed inset-0 z-[120] flex flex-col bg-[#0b0b12]" role="dialog" aria-modal="true">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6 flex-shrink-0"
            style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}>
            <button
              onClick={() => setMobilePreviewOpen(false)}
              className="p-2 -ml-2 rounded-lg text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/[0.06]"
              aria-label={t('admin.emailTemplates.back', 'Back')}
            >
              <ArrowLeft size={18} />
            </button>
            <p className="text-[14px] font-semibold text-[#E5E7EB] flex-1">
              {t('admin.emailTemplates.preview', 'Preview')}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto"
            style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
            <EmailLivePreview template={template} gymName={gymName} gymLogoUrl={gymLogoUrl} />
          </div>
        </div>
      )}
    </div>
  );
}
