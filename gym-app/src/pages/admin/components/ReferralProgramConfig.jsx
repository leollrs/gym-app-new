import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { FadeIn } from '../../../components/admin';
import RewardEditor from './RewardEditor';
import { TK, FK, Ico, ICON, Card, IconChip, PrimaryBtn } from './retosKit';

const DEFAULT_REFERRAL_CONFIG = {
  enabled: true,
  require_admin_approval: true,
  max_referrals_per_month: null,
  referrer_reward: { type: 'points', value: 250 },
  referred_reward: { type: 'points', value: 100 },
  // Shown on the PUBLIC referral landing (/referral/:code) to someone who has
  // never heard of this gym. Deliberately separate from referred_reward: that
  // one is points, and "100 points" means nothing to a stranger. This is the
  // line that makes them walk in — "50% off your first month". Free text so the
  // owner can swap campaigns without a deploy. See migration 0653.
  join_offer: { enabled: false, headline: '', headline_en: '', detail: '', ends_on: '' },
};

// Older gyms have a referral_config with no join_offer at all (backfilled by
// 0653, but a config saved by an older client can still arrive without it).
function normalizeJoinOffer(o) {
  const j = (o && typeof o === 'object') ? o : {};
  return {
    enabled:     !!j.enabled,
    headline:    j.headline    || '',
    headline_en: j.headline_en || '',
    detail:      j.detail      || '',
    ends_on:     j.ends_on     || '',
  };
}

// Tolerate legacy shapes saved by older builds:
//   { type: 'points', points: 5000, label: '...' }   → { type: 'points', value: 5000 }
//   { type: 'points', value: 250 }                   → unchanged
//   { type: 'gym_reward', reward_id: '<uuid>' }      → unchanged
function normalizeRewardShape(r) {
  if (!r || typeof r !== 'object') return { type: 'points', value: 0 };
  if (r.type === 'gym_reward') {
    return { type: 'gym_reward', reward_id: r.reward_id || '' };
  }
  const v = r.value ?? r.points ?? 0;
  return { type: 'points', value: Number(v) || 0 };
}

const fieldLabel = {
  display: 'block', fontFamily: FK.body, fontSize: 11, fontWeight: 800,
  letterSpacing: 1.1, textTransform: 'uppercase', color: TK.textMute, marginBottom: 9,
};

// enabled/disabled switch pill (mock header control) — functional toggle
function TogglePill({ on, onClick, onLabel, offLabel }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 8px', borderRadius: 999, cursor: 'pointer',
      background: on ? 'var(--color-success-soft)' : TK.surface3,
      border: `1px solid ${on ? 'color-mix(in srgb, var(--color-success) 32%, transparent)' : TK.borderSolid}`,
    }}>
      <span style={{ width: 34, height: 19, borderRadius: 99, background: on ? 'var(--color-success)' : TK.textFaint, position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 17 : 2, width: 15, height: 15, borderRadius: 99, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s' }} />
      </span>
      <span style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 800, color: on ? 'var(--color-success-ink, var(--color-success))' : TK.textMute }}>{on ? onLabel : offLabel}</span>
    </button>
  );
}

// colored-dot section header above each reward editor
function RewardColHeader({ accent, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: accent ? TK.accent : 'var(--color-info)' }} />
      <span style={{ fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textSub }}>{children}</span>
    </div>
  );
}

/**
 * Card editing the gym's referral program config (enabled flag, approval mode,
 * monthly cap, referrer/referred rewards). Persists to `gyms.referral_config`
 * as a JSONB column. Restyled onto the Referidos design system.
 */
export default function ReferralProgramConfig({ gymId, config, t, isEs }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(DEFAULT_REFERRAL_CONFIG);
  const [saving, setSaving] = useState(false);

  // Active rewards inventory (shared picker for referrer + referred)
  const { data: rewards = [] } = useQuery({
    queryKey: ['admin', 'rewards', gymId, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_rewards')
        .select('id, name, name_es, emoji_icon, is_active, sort_order')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  useEffect(() => {
    const incoming = config || {};
    setDraft({
      ...DEFAULT_REFERRAL_CONFIG,
      ...incoming,
      referrer_reward: normalizeRewardShape(incoming.referrer_reward),
      referred_reward: normalizeRewardShape(incoming.referred_reward),
      join_offer: normalizeJoinOffer(incoming.join_offer),
    });
  }, [config]);

  const setReward = (which, next) => setDraft(prev => ({ ...prev, [which]: next }));

  const set = (path, val) => setDraft(prev => {
    const next = { ...prev };
    if (path.includes('.')) {
      const [a, b] = path.split('.');
      next[a] = { ...next[a], [b]: val };
    } else {
      next[path] = val;
    }
    return next;
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanReward = (r) => {
        if (r.type === 'gym_reward') {
          if (!r.reward_id) {
            throw new Error(t('admin.referral.errorPickReward', 'Pick a reward from inventory'));
          }
          return { type: 'gym_reward', reward_id: r.reward_id };
        }
        const v = parseInt(r.value, 10);
        if (!Number.isFinite(v) || v < 0) {
          throw new Error(t('admin.referral.errorInvalidPoints', 'Invalid point value'));
        }
        return { type: 'points', value: v };
      };

      // An offer switched ON with no headline would render an empty box on the
      // public landing — worse than no offer at all. Refuse it here.
      const jo = normalizeJoinOffer(draft.join_offer);
      if (jo.enabled && !jo.headline.trim()) {
        throw new Error(t('admin.referral.errorOfferHeadline', 'Write the offer headline, or turn the offer off.'));
      }

      const payload = {
        ...draft,
        max_referrals_per_month: draft.max_referrals_per_month ? Number(draft.max_referrals_per_month) : null,
        referrer_reward: cleanReward(draft.referrer_reward),
        referred_reward: cleanReward(draft.referred_reward),
        join_offer: {
          enabled:     jo.enabled,
          headline:    jo.headline.trim()    || null,
          headline_en: jo.headline_en.trim() || null,
          detail:      jo.detail.trim()      || null,
          ends_on:     jo.ends_on            || null,
        },
      };
      // .select() so an RLS-silent-fail (0 rows updated) surfaces as an error
      // instead of looking like a successful no-op.
      const { data, error } = await supabase
        .from('gyms')
        .update({ referral_config: payload, updated_at: new Date().toISOString() })
        .eq('id', gymId)
        .select('id, referral_config');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(t('admin.referral.errorRlsBlocked', 'Save was blocked — you may not have admin permission on this gym.'));
      }
      // Invalidate BOTH key shapes — fetch uses adminKeys.referrals.config,
      // older code paths used the legacy 'referral-config' key. Invalidate
      // the whole referrals namespace too so the milestones list & stats
      // pick up any cascading changes.
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals.config(gymId) });
      queryClient.invalidateQueries({ queryKey: ['admin', 'referral-config', gymId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'referrals', gymId] });
      showToast(t('admin.settings.saved', 'Saved!'), 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const rewardLabel = (r) => r ? `${r.emoji_icon || '🎁'} ${(isEs && r.name_es) ? r.name_es : r.name}` : '—';

  return (
    <FadeIn>
      <Card style={{ overflow: 'hidden' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '20px 24px', borderBottom: `1px solid ${TK.divider}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <IconChip ch={ICON.sliders} tone="accent" size={38} r={11} strokeW={2} />
            <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>
              {t('admin.referral.sectionTitle', 'Referral program')}
            </div>
          </div>
          <TogglePill
            on={!!draft.enabled}
            onClick={() => set('enabled', !draft.enabled)}
            onLabel={t('admin.settings.enabled', 'Enabled')}
            offLabel={t('admin.settings.disabled', 'Disabled')}
          />
        </div>

        <div style={{ padding: '24px 24px 26px' }}>
          {/* referrer / friend rewards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-7 md:gap-8">
            <div>
              <RewardColHeader accent>{t('admin.referral.referrerReward', 'Referrer reward')}</RewardColHeader>
              <RewardEditor
                reward={draft.referrer_reward}
                onChange={(r) => setReward('referrer_reward', r)}
                rewards={rewards}
                rewardLabel={rewardLabel}
                t={t}
              />
            </div>
            <div>
              <RewardColHeader>{t('admin.referral.referredReward', 'Referred friend reward')}</RewardColHeader>
              <RewardEditor
                reward={draft.referred_reward}
                onChange={(r) => setReward('referred_reward', r)}
                rewards={rewards}
                rewardLabel={rewardLabel}
                t={t}
              />
            </div>
          </div>

          {/* monthly cap + approval */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-7 md:gap-8 md:items-end" style={{ marginTop: 22 }}>
            <div>
              <span style={fieldLabel}>{t('admin.referral.maxPerMonth', 'Max referrals per member per month')}</span>
              <input
                type="number" min="0"
                value={draft.max_referrals_per_month ?? ''}
                onChange={e => set('max_referrals_per_month', e.target.value || null)}
                placeholder={t('admin.referral.unlimited', 'Unlimited')}
                style={{ width: '100%', padding: '13px 15px', borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 14.5, fontWeight: 600, color: TK.text, outline: 'none' }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!draft.require_admin_approval}
                onChange={e => set('require_admin_approval', e.target.checked)}
                style={{ width: 22, height: 22, borderRadius: 7, accentColor: 'var(--color-accent)', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub }}>
                {t('admin.referral.approvalRequired', 'Require admin approval before reward is granted')}
              </span>
            </label>
          </div>

          {/* ── Join offer — the PUBLIC half ──────────────────────────────
              Everything above is for members. This block is the only thing on
              the page a non-member ever sees: it renders on /referral/:code,
              the page their friend's link opens. */}
          <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${TK.divider}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <RewardColHeader>{t('admin.referral.joinOffer', 'Oferta de bienvenida')}</RewardColHeader>
                <p style={{ fontFamily: FK.body, fontSize: 13, lineHeight: 1.5, color: TK.textMute, margin: 0, maxWidth: 460 }}>
                  {t('admin.referral.joinOfferHelp', 'Lo que ve quien NO es miembro cuando abre el link de un referido. Los puntos de arriba no le dicen nada a un desconocido — esto sí.')}
                </p>
              </div>
              <TogglePill
                on={!!draft.join_offer?.enabled}
                onClick={() => set('join_offer.enabled', !draft.join_offer?.enabled)}
                onLabel={t('admin.settings.enabled', 'Enabled')}
                offLabel={t('admin.settings.disabled', 'Disabled')}
              />
            </div>

            {draft.join_offer?.enabled && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <span style={fieldLabel}>{t('admin.referral.offerHeadline', 'Oferta')}</span>
                  <input
                    type="text"
                    maxLength={70}
                    value={draft.join_offer?.headline || ''}
                    onChange={e => set('join_offer.headline', e.target.value)}
                    placeholder={t('admin.referral.offerHeadlinePh', '50% de descuento tu primer mes')}
                    style={{ width: '100%', padding: '13px 15px', borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 14.5, fontWeight: 600, color: TK.text, outline: 'none' }}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-7 md:gap-8">
                  <div>
                    <span style={fieldLabel}>{t('admin.referral.offerHeadlineEn', 'Oferta en inglés (opcional)')}</span>
                    <input
                      type="text"
                      maxLength={70}
                      value={draft.join_offer?.headline_en || ''}
                      onChange={e => set('join_offer.headline_en', e.target.value)}
                      placeholder={t('admin.referral.offerHeadlineEnPh', '50% off your first month')}
                      style={{ width: '100%', padding: '13px 15px', borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 14.5, fontWeight: 600, color: TK.text, outline: 'none' }}
                    />
                  </div>
                  <div>
                    {/* One campaign date for everyone — NOT a per-visitor
                        countdown. A timer that restarts for each person is a
                        lie, and people compare screenshots. */}
                    <span style={fieldLabel}>{t('admin.referral.offerEndsOn', 'Válida hasta (opcional)')}</span>
                    <input
                      type="date"
                      value={draft.join_offer?.ends_on || ''}
                      onChange={e => set('join_offer.ends_on', e.target.value)}
                      style={{ width: '100%', padding: '12px 15px', borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 14.5, fontWeight: 600, color: TK.text, outline: 'none' }}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <span style={fieldLabel}>{t('admin.referral.offerDetail', 'Línea de apoyo (opcional)')}</span>
                  <input
                    type="text"
                    maxLength={110}
                    value={draft.join_offer?.detail || ''}
                    onChange={e => set('join_offer.detail', e.target.value)}
                    placeholder={t('admin.referral.offerDetailPh', 'Menciona el código en recepción')}
                    style={{ width: '100%', padding: '13px 15px', borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 14.5, fontWeight: 600, color: TK.text, outline: 'none' }}
                  />
                </div>

                {/* The one thing an owner will not guess on their own. */}
                <p style={{ fontFamily: FK.body, fontSize: 12.5, lineHeight: 1.5, color: TK.textMute, margin: '14px 0 0' }}>
                  {t('admin.referral.offerCacheWarning', 'Cambiar la oferta actualiza la página al instante, pero NO cambia las tarjetas de los links que ya se compartieron — esas quedan cacheadas en el chat de quien las recibió.')}
                </p>
              </>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <PrimaryBtn icon={ICON.check} onClick={handleSave} disabled={saving}>
              {saving ? t('admin.settings.saving', 'Saving...') : t('admin.settings.save', 'Save')}
            </PrimaryBtn>
          </div>
        </div>
      </Card>
    </FadeIn>
  );
}
