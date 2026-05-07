import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { logAdminAction } from '../../../lib/adminAudit';
import logger from '../../../lib/logger';

// Pricing tiers from migration 0043_gym_pricing_model.sql
const PLAN_OPTIONS = [
  { value: 'starter',  labelKey: 'platform.gyms.planStarter',  fallback: 'Starter' },
  { value: 'pro',      labelKey: 'platform.gyms.planPro',      fallback: 'Pro' },
  { value: 'lifetime', labelKey: 'platform.gyms.planLifetime', fallback: 'Lifetime' },
];

const slugify = (val = '') =>
  val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export default function GymCreateModal({ onClose, onCreated, t, showToast, profile }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [tier, setTier] = useState('starter');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleNameChange = (val) => {
    setName(val);
    if (!slugDirty) setSlug(slugify(val));
  };

  const handleSlugChange = (val) => {
    setSlugDirty(true);
    setSlug(slugify(val));
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('platform.gyms.errorNameRequired', 'Gym name is required'));
      return;
    }
    if (!ownerEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      setError(t('platform.gyms.errorOwnerEmailRequired', 'Valid owner email is required'));
      return;
    }
    setSaving(true);
    setError('');
    const finalSlug = slug.trim() || slugify(name);
    const ownerEmailLower = ownerEmail.trim().toLowerCase();

    try {
      // 1. Try platform_create_gym RPC first
      let newGymId = null;
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('platform_create_gym', {
          p_name: name.trim(),
          p_slug: finalSlug,
          p_owner_email: ownerEmailLower,
          p_pricing_tier: tier,
        });
        // Treat 42883 (function does not exist) / PGRST202 as fallback signals
        if (!rpcErr && rpcData) {
          newGymId = typeof rpcData === 'string' ? rpcData : rpcData?.id || rpcData?.gym_id;
        } else if (rpcErr && !/does not exist|PGRST202|404/i.test(rpcErr.message || '')) {
          // Real error from a present RPC — surface it
          setError(rpcErr.message);
          setSaving(false);
          return;
        }
      } catch (rpcEx) {
        logger.warn('platform_create_gym RPC unavailable, falling back to direct insert:', rpcEx);
      }

      // 2. Fallback: direct INSERT into gyms + create owner invite
      if (!newGymId) {
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
        if (insertErr) {
          setError(insertErr.message);
          setSaving(false);
          return;
        }
        newGymId = newGym.id;

        // Create an owner invite (gym_invites). DB constraint may only permit member/trainer
        // for the role column — the owner gets promoted to admin after claiming.
        try {
          await supabase.from('gym_invites').insert({
            gym_id: newGymId,
            created_by: profile?.id,
            email: ownerEmailLower,
            role: 'member',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          });
        } catch (invErr) {
          logger.error('Failed to create owner invite:', invErr);
        }
      }

      // 3. Audit log
      logAdminAction('create_gym', 'gym', newGymId, {
        name: name.trim(),
        slug: finalSlug,
        owner_email: ownerEmailLower,
        plan: tier,
      });

      showToast(
        t('platform.gyms.createSuccess', 'Gym created successfully'),
        'success',
      );
      onCreated();
    } catch (err) {
      setError(err.message || t('platform.gyms.createFailed', 'Failed to create gym'));
      setSaving(false);
    }
  };

  return (
    // Center-aligned modal (per project rule: never bottom-sheet)
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-xl w-full max-w-md p-6 animate-fade-in-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-bold text-[#E5E7EB]">
            {t('platform.gyms.createTitle', 'Create Gym')}
          </h2>
          <button
            onClick={onClose}
            className="text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

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

          {/* Owner Email */}
          <div>
            <label className="block text-[12px] text-[#9CA3AF] mb-1.5">
              {t('platform.gyms.ownerEmail', 'Owner Email')} *
            </label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@gym.com"
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
            <p className="text-[10px] text-[#4B5563] mt-1">
              {t('platform.gyms.ownerInviteNote', 'An invite will be created for this email. Promote them to admin after they claim.')}
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
      </div>
    </div>
  );
}
