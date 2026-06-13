import { useState } from 'react';
import { X, Loader2, Check, Copy, KeyRound } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { logAdminAction } from '../../../lib/adminAudit';
import logger from '../../../lib/logger';

// Canonical tier set (0043: plan_type is the source of truth; subscription_tier mirrored)
const PLAN_OPTIONS = [
  { value: 'free',       labelKey: 'platform.gyms.planFree',       fallback: 'Free' },
  { value: 'starter',    labelKey: 'platform.gyms.planStarter',    fallback: 'Starter' },
  { value: 'pro',        labelKey: 'platform.gyms.planPro',        fallback: 'Pro' },
  { value: 'lifetime',   labelKey: 'platform.gyms.planLifetime',   fallback: 'Lifetime' },
  { value: 'enterprise', labelKey: 'platform.gyms.planEnterprise', fallback: 'Enterprise' },
];

const slugify = (val = '') =>
  val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// RPC-missing detection (PostgREST puts the code in error.code, not message —
// same pattern as AdminPrograms.jsx isSchemaMiss).
const isRpcMissing = (err) =>
  !!err && (err.code === 'PGRST202' || /could not find|schema cache/i.test(err.message || ''));

export default function GymCreateModal({ onClose, onCreated, t, showToast, profile }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [tier, setTier] = useState('starter');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // After a successful create: { gymId, slug, inviteCode, inviteError }
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleNameChange = (val) => {
    setName(val);
    if (!slugDirty) setSlug(slugify(val));
  };

  const handleSlugChange = (val) => {
    setSlugDirty(true);
    setSlug(slugify(val));
  };

  const handleCopyCode = async () => {
    if (!created?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(created.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast(t('platform.gyms.copyFailed', 'Could not copy — copy it manually'), 'error');
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('platform.gyms.errorNameRequired', 'Gym name is required'));
      return;
    }
    const ownerEmailLower = ownerEmail.trim().toLowerCase();
    if (ownerEmailLower && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmailLower)) {
      setError(t('platform.gyms.errorOwnerEmailInvalid', 'Enter a valid owner email, or leave it empty'));
      return;
    }
    setSaving(true);
    setError('');
    const finalSlug = slug.trim() || slugify(name);

    // ── 1. Primary path: platform_create_gym RPC (0542) ──
    const { data: rpcData, error: rpcErr } = await supabase.rpc('platform_create_gym', {
      p_name: name.trim(),
      p_slug: finalSlug,
      p_owner_email: ownerEmailLower || null,
      p_plan_type: tier,
    });

    if (!rpcErr && rpcData?.gym_id) {
      logAdminAction('create_gym', 'gym', rpcData.gym_id, {
        name: name.trim(),
        slug: rpcData.slug || finalSlug,
        owner_email: ownerEmailLower || null,
        plan: tier,
        invite_created: !!rpcData.invite_code,
      }, rpcData.gym_id);
      showToast(t('platform.gyms.createSuccess', 'Gym created successfully'), 'success');
      setSaving(false);
      setCreated({
        gymId: rpcData.gym_id,
        slug: rpcData.slug || finalSlug,
        inviteCode: rpcData.invite_code || null,
        inviteError: null,
      });
      return;
    }

    // Real error from a present RPC — surface it, do NOT pretend success.
    if (rpcErr && !isRpcMissing(rpcErr)) {
      setError(rpcErr.message || t('platform.gyms.createFailed', 'Failed to create gym'));
      setSaving(false);
      return;
    }

    // ── 2. Safety-net fallback (RPC not deployed yet): direct inserts ──
    logger.warn('platform_create_gym RPC unavailable, falling back to direct insert:', rpcErr);
    const { data: newGym, error: insertErr } = await supabase
      .from('gyms')
      .insert({
        name: name.trim(),
        slug: finalSlug,
        plan_type: tier,
        subscription_tier: tier,
        is_active: true,
      })
      .select('id')
      .single();
    if (insertErr || !newGym?.id) {
      setError(insertErr?.message || t('platform.gyms.createFailed', 'Failed to create gym'));
      setSaving(false);
      return;
    }

    // Owner invite via direct insert (needs the 0542 super_admin RLS arm —
    // pre-apply this fails; we report it honestly instead of toasting success).
    let inviteCode = null;
    let inviteError = null;
    if (ownerEmailLower) {
      const code = Array.from({ length: 6 }, () =>
        'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
      const { data: inv, error: invErr } = await supabase
        .from('gym_invites')
        .insert({
          gym_id: newGym.id,
          created_by: profile?.id ?? null,
          email: ownerEmailLower,
          invite_code: code,
          member_name: 'Owner',
          role: 'member',
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select('invite_code')
        .single();
      if (invErr) {
        logger.error('Failed to create owner invite:', invErr);
        inviteError = invErr.message;
      } else {
        inviteCode = inv?.invite_code ?? code;
      }
    }

    logAdminAction('create_gym', 'gym', newGym.id, {
      name: name.trim(),
      slug: finalSlug,
      owner_email: ownerEmailLower || null,
      plan: tier,
      invite_created: !!inviteCode,
      fallback_path: true,
    }, newGym.id);
    showToast(t('platform.gyms.createSuccess', 'Gym created successfully'), 'success');
    setSaving(false);
    setCreated({ gymId: newGym.id, slug: finalSlug, inviteCode, inviteError });
  };

  return (
    // Center-aligned modal (per project rule: never bottom-sheet)
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={created ? onCreated : onClose} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-xl w-full max-w-md p-6 animate-fade-in-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-bold text-[#E5E7EB]">
            {created
              ? t('platform.gyms.createdTitle', 'Gym created')
              : t('platform.gyms.createTitle', 'Create Gym')}
          </h2>
          <button
            onClick={created ? onCreated : onClose}
            className="text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
            aria-label={t('platform.gyms.closeAria', 'Close dialog')}
          >
            <X size={18} />
          </button>
        </div>

        {created ? (
          /* ── Success state: hand the founder the owner code ── */
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-emerald-500/8 border border-emerald-500/15 rounded-xl">
              <Check size={16} className="text-emerald-400 flex-shrink-0" />
              <p className="text-[12px] text-emerald-300 min-w-0">
                <span className="font-semibold text-[#E5E7EB]">{name.trim()}</span>
                <span className="font-mono text-emerald-300/80"> /{created.slug}</span>
              </p>
            </div>

            {created.inviteCode ? (
              <div>
                <label className="block text-[12px] text-[#9CA3AF] mb-1.5">
                  {t('platform.gyms.inviteCodeLabel', 'Owner invite code')}
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-[#111827] border border-[#D4AF37]/30 rounded-lg px-3 py-2.5">
                    <KeyRound size={14} className="text-[#D4AF37] flex-shrink-0" />
                    <span className="text-[16px] font-bold font-mono tracking-[0.2em] text-[#D4AF37]">
                      {created.inviteCode}
                    </span>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/20 transition-colors"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? t('platform.gyms.copied', 'Copied!') : t('platform.gyms.copyCode', 'Copy')}
                  </button>
                </div>
                <p className="text-[11px] text-[#6B7280] mt-2">
                  {t('platform.gyms.inviteCodeHint', 'Share this code with the owner — they enter it at signup. Expires in 30 days. Promote them to admin once they claim it.')}
                </p>
              </div>
            ) : created.inviteError ? (
              <p className="text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                {t('platform.gyms.inviteCreateFailed', 'The gym was created, but the owner invite failed:')} {created.inviteError}
              </p>
            ) : (
              <p className="text-[12px] text-[#9CA3AF] bg-white/[0.03] border border-white/6 rounded-lg px-3 py-2">
                {t('platform.gyms.noInviteCreated', "No owner invite was created. You can create one anytime from the gym's People → Invites tab.")}
              </p>
            )}

            <button
              onClick={onCreated}
              className="w-full bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors"
            >
              {t('platform.gyms.done', 'Done')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-[12px] text-[#9CA3AF] mb-1.5">
                {t('platform.gyms.gymName', 'Gym Name')} *
              </label>
              <input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Iron Forge Fitness"
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
            </div>

            {/* Slug (auto-derived, editable) */}
            <div>
              <label className="block text-[12px] text-[#9CA3AF] mb-1.5">
                {t('platform.gyms.slug', 'URL Slug')} *
              </label>
              <input
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="iron-forge-fitness"
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors font-mono"
              />
              <p className="text-[10px] text-[#4B5563] mt-1">
                {t('platform.gyms.slugHint', 'Auto-derived from name. Lowercase, hyphens only.')}
              </p>
            </div>

            {/* Owner Email (optional — invite created when present) */}
            <div>
              <label className="block text-[12px] text-[#9CA3AF] mb-1.5">
                {t('platform.gyms.ownerEmailOptional', 'Owner Email (optional)')}
              </label>
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="owner@gym.com"
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
              <p className="text-[10px] text-[#4B5563] mt-1">
                {t('platform.gyms.ownerInviteNote', 'An invite code will be generated for this email. Promote them to admin after they claim it.')}
              </p>
            </div>

            {/* Pricing Tier */}
            <div>
              <label className="block text-[12px] text-[#9CA3AF] mb-1.5">
                {t('platform.gyms.pricingTier', 'Pricing Tier')}
              </label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 transition-colors"
              >
                {PLAN_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.labelKey, p.fallback)}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <p className="text-[12px] text-[#EF4444] bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleCreate}
              disabled={saving}
              className="w-full bg-[#D4AF37] text-black hover:bg-[#E6C766] disabled:opacity-50 rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving
                ? t('platform.gyms.creating', 'Creating...')
                : t('platform.gyms.createGym', 'Create Gym')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
