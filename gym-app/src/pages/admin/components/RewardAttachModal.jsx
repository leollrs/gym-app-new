/**
 * RewardAttachModal — attach or detach an earned-reward QR on a print card.
 *
 * Backs onto two RPCs from migration 0415:
 *   - attach_reward_to_print_card(card_id, label, emoji?, expires_in_days?)
 *   - detach_reward_from_print_card(card_id)
 *
 * When a reward is attached the daily-cards print preview renders the
 * QR in the lower-right corner of the postcard, and the front-desk scan
 * pipeline routes `earned-reward:<code>` to handleEarnedRewardScan which
 * calls claim_redemption. The whole flow exists; this modal is the UI.
 *
 * Pre-fills the label from gym_card_settings.default_rewards[occasion]
 * if the gym has configured a default for that occasion.
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, Gift, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { useScrollLock } from '../../../hooks/useScrollLock';

const EMOJI_PRESETS = ['🎁', '☕', '🥤', '🍪', '🏋️', '⭐', '💪', '🎯'];

export default function RewardAttachModal({ card, gymId, onClose }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');

  // This component only mounts while the modal is open, so lock unconditionally.
  useScrollLock(true);

  const hasReward = !!card.reward_qr_code;

  // The gym's reward catalog (store rewards). The owner picks one of these and
  // its name + emoji prefill the card reward, so the printed QR redeems a real
  // listed reward at the desk — instead of typing a label from scratch.
  const { data: catalog = [] } = useQuery({
    queryKey: ['gym-rewards-active', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_rewards')
        .select('id, name, name_es, emoji_icon, cost_points, is_active')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('sort_order');
      return data || [];
    },
    enabled: !!gymId && !hasReward,
    staleTime: 5 * 60_000,
  });
  const rewardName = (r) => (isEs ? (r.name_es || r.name) : r.name);
  const [selectedRewardId, setSelectedRewardId] = useState(null);

  // Read gym defaults so we can pre-fill the label for known occasions
  // (e.g., habit_9in6 → "shaker"). Defaults come from gym_card_settings
  // configured on /admin/settings/cards.
  const { data: gymDefaults } = useQuery({
    queryKey: ['gym-card-settings', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_card_settings')
        .select('default_rewards')
        .eq('gym_id', gymId)
        .maybeSingle();
      return data?.default_rewards || {};
    },
    enabled: !!gymId && !hasReward,
    staleTime: 5 * 60_000,
  });

  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('🎁');
  const [expiresDays, setExpiresDays] = useState(30);

  // Hydrate label from gym defaults once they arrive (skip if user typed already).
  // The setState-in-effect rule fires here, but this IS the legitimate "sync
  // local form state with async-loaded server data" pattern the docs allow.
  useEffect(() => {
    if (hasReward || !gymDefaults) return;
    const presetLabel = gymDefaults[card.occasion];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (presetLabel && !label) setLabel(presetLabel);
  }, [gymDefaults, card.occasion, hasReward, label]);

  // ESC closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const attachMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('attach_reward_to_print_card', {
        p_card_id: card.id,
        p_reward_label: label.trim(),
        p_reward_emoji: emoji || null,
        p_expires_in_days: expiresDays,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      logAdminAction('print_card_reward_attached', 'print_card', card.id, {
        label: label.trim(), expires_in_days: expiresDays,
      });
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
      showToast(t('admin.printCards.rewardAttachedToast', { defaultValue: 'Reward attached' }), 'success');
      onClose();
    },
    onError: (err) => showToast(err?.message || 'Attach failed', 'error'),
  });

  const detachMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('detach_reward_from_print_card', {
        p_card_id: card.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      logAdminAction('print_card_reward_detached', 'print_card', card.id);
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
      showToast(t('admin.printCards.rewardDetachedToast', { defaultValue: 'Reward removed' }), 'success');
      onClose();
    },
    onError: (err) => showToast(err?.message || 'Detach failed', 'error'),
  });

  const canSubmit = label.trim().length > 0 && expiresDays > 0 && expiresDays <= 365;
  const isPending = attachMutation.isPending || detachMutation.isPending;

  // Portal to <body> — same containing-block trap as PrintPreviewModal: the
  // admin page's framer-motion wrappers would otherwise pin this fixed overlay
  // inside a panel instead of the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto"
      style={{
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        // Clear the mobile admin header (~56px) + bottom nav (~80px) + safe areas
        // so the dialog is fully on-screen and scrolls under the keyboard.
        paddingTop: 'calc(56px + env(safe-area-inset-top) + 12px)',
        paddingBottom: 'calc(80px + env(safe-area-inset-bottom) + 12px)',
        paddingLeft: '16px', paddingRight: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl max-h-[min(85vh,100%)] flex flex-col my-auto"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}>
              <Gift size={14} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <p className="text-[13px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                {hasReward
                  ? t('admin.printCards.rewardModalTitleAttached', { defaultValue: 'Reward attached' })
                  : t('admin.printCards.rewardModalTitle', { defaultValue: 'Attach reward' })}
              </p>
              <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                {t(`admin.printCards.occasions.${card.occasion}`, card.occasion)} — {card.profiles?.full_name || ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1">
          {hasReward ? (
            // Already attached — show summary + detach action
            <div className="space-y-4">
              <div
                className="p-3 rounded-xl"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
                }}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
                  {t('admin.printCards.rewardCurrent', { defaultValue: 'Current reward' })}
                </p>
                <p className="text-[15px] font-semibold mt-1" style={{ color: 'var(--color-text-primary)' }}>
                  {card.reward_label || '—'}
                </p>
                <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.printCards.rewardQRNote', {
                    defaultValue: 'QR is printed on the card. Member scans at front desk to redeem.',
                  })}
                </p>
              </div>
              <button
                onClick={() => detachMutation.mutate()}
                disabled={isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-bold transition active:scale-95 disabled:opacity-50"
                style={{
                  background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
                  color: 'var(--color-danger)',
                  border: '1px solid color-mix(in srgb, var(--color-danger) 24%, transparent)',
                }}
              >
                {detachMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t('admin.printCards.detachReward', { defaultValue: 'Remove reward' })}
              </button>
            </div>
          ) : (
            // No reward yet — form
            <div className="space-y-3">
              {/* Pick from the gym's reward catalog — fills the label + icon. */}
              {catalog.length > 0 && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('admin.printCards.rewardChooseFromList', { defaultValue: 'Choose from your rewards' })}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {catalog.map((r) => {
                      const active = selectedRewardId === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setSelectedRewardId(r.id);
                            setLabel(rewardName(r));
                            if (r.emoji_icon) setEmoji(r.emoji_icon);
                          }}
                          className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition"
                          style={{
                            background: active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-bg-input)',
                            border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-default)'}`,
                          }}
                        >
                          <span className="text-[16px] leading-none flex-shrink-0">{r.emoji_icon || '🎁'}</span>
                          <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {rewardName(r)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                  {catalog.length > 0
                    ? t('admin.printCards.rewardLabelOrCustom', { defaultValue: 'Reward name (or type a custom one)' })
                    : t('admin.printCards.rewardLabelField', { defaultValue: 'What does this reward?' })}
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => { setLabel(e.target.value); setSelectedRewardId(null); }}
                  placeholder={t('admin.printCards.rewardLabelPlaceholder', { defaultValue: 'e.g. Shaker bottle, free smoothie' })}
                  maxLength={80}
                  className="w-full px-3 py-2 rounded-lg text-[13px]"
                  style={{
                    background: 'var(--color-bg-input)',
                    border: '1px solid var(--color-border-default)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.printCards.rewardEmojiField', { defaultValue: 'Icon' })}
                </label>
                <div className="flex gap-1 flex-wrap">
                  {EMOJI_PRESETS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEmoji(e)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-[16px] transition"
                      style={{
                        background: emoji === e ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-bg-input)',
                        border: `1px solid ${emoji === e ? 'var(--color-accent)' : 'var(--color-border-default)'}`,
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.printCards.rewardExpiresField', { defaultValue: 'Expires in (days)' })}
                </label>
                <input
                  type="number"
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(parseInt(e.target.value, 10) || 0)}
                  min={1}
                  max={365}
                  className="w-full px-3 py-2 rounded-lg text-[13px]"
                  style={{
                    background: 'var(--color-bg-input)',
                    border: '1px solid var(--color-border-default)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.printCards.rewardExpiresHint', { defaultValue: 'After this many days the QR stops working. 30 is a good default.' })}
                </p>
              </div>

              <button
                onClick={() => attachMutation.mutate()}
                disabled={!canSubmit || isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-bold transition active:scale-95 disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
              >
                {attachMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Gift size={12} />}
                {t('admin.printCards.attachReward', { defaultValue: 'Attach reward' })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
