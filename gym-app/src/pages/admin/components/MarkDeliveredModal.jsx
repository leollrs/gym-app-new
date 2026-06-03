/**
 * MarkDeliveredModal — accountable hand-over of a printed card.
 *
 * Instead of silently stamping delivered_at, marking a card delivered now
 * captures WHO physically handed it over (free-text name, MANDATORY) plus an
 * optional note. The hand-over time is recorded automatically. If a member
 * later says they never got their card, there's a named person on the hook.
 *
 * Writes to print_cards (migration 0506):
 *   status='delivered', delivered_at=now(), delivered_by=<current staff id>,
 *   delivered_by_name=<entered name>, delivery_note=<entered note|null>
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, Check, Loader2, Clock } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';

export default function MarkDeliveredModal({ card, gymId, onClose }) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');

  // Pre-fill with the signed-in staffer's name (most often the same person),
  // but it stays editable + required so a front-desk hand-over gets the real name.
  const [handler, setHandler] = useState(profile?.full_name || '');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nameValid = handler.trim().length > 0;

  const deliverMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('print_cards')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          delivered_by: profile?.id ?? null,
          delivered_by_name: handler.trim(),
          delivery_note: note.trim() || null,
        })
        .eq('id', card.id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      logAdminAction('print_cards_delivered', 'print_card', card.id, {
        delivered_by_name: handler.trim(),
        has_note: note.trim().length > 0,
      });
      queryClient.invalidateQueries({ queryKey: adminKeys.printCards(gymId) });
      showToast(t('admin.printCards.toastDelivered', { defaultValue: 'Marked delivered' }), 'success');
      onClose();
    },
    onError: (err) => showToast(err?.message || t('admin.printCards.toastFailed', { defaultValue: 'Action failed' }), 'error'),
  });

  const submit = () => {
    setTouched(true);
    if (!nameValid || deliverMutation.isPending) return;
    deliverMutation.mutate();
  };

  const inputStyle = {
    background: 'var(--color-bg-input, var(--color-admin-panel))',
    border: '1px solid var(--color-border-default)',
    color: 'var(--color-text-primary)',
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-success-soft)' }}>
              <Check size={14} style={{ color: 'var(--color-success-ink)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-tight truncate" style={{ color: 'var(--color-text-primary)' }}>
                {t('admin.printCards.markDeliveredModalTitle', { defaultValue: 'Mark delivered' })}
              </p>
              <p className="text-[10.5px] mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>
                {t(`admin.printCards.occasions.${card.occasion}`, card.occasion)} — {card.profiles?.full_name || ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {/* Who handed it over — mandatory */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('admin.printCards.handoverByLabel', { defaultValue: 'Who handed it over?' })}
              <span style={{ color: 'var(--color-danger)' }}> *</span>
            </label>
            <input
              type="text"
              value={handler}
              onChange={(e) => setHandler(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={t('admin.printCards.handoverByPlaceholder', { defaultValue: "Staff member's name" })}
              maxLength={80}
              autoFocus
              className="w-full px-3 py-2 rounded-lg text-[13px]"
              style={{
                ...inputStyle,
                borderColor: touched && !nameValid ? 'var(--color-danger)' : inputStyle.border.split(' ').pop(),
              }}
            />
            {touched && !nameValid && (
              <p className="text-[10.5px] mt-1" style={{ color: 'var(--color-danger)' }}>
                {t('admin.printCards.handoverByRequired', { defaultValue: 'A name is required so the hand-over is accountable.' })}
              </p>
            )}
          </div>

          {/* Optional note */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('admin.printCards.deliveryNoteLabel', { defaultValue: 'Note (optional)' })}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('admin.printCards.deliveryNotePlaceholder', { defaultValue: 'e.g. Handed to member personally · left at front desk' })}
              rows={2}
              maxLength={240}
              className="w-full px-3 py-2 rounded-lg text-[13px] resize-none"
              style={inputStyle}
            />
          </div>

          {/* Time note */}
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
            <Clock size={12} />
            {t('admin.printCards.deliveryTimeNote', { defaultValue: 'The hand-over time is recorded automatically.' })}
          </div>

          <button
            onClick={submit}
            disabled={!nameValid || deliverMutation.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-bold transition active:scale-95 disabled:opacity-50"
            style={{ background: 'var(--color-success)', color: '#fff' }}
          >
            {deliverMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {t('admin.printCards.confirmDelivered', { defaultValue: 'Mark delivered' })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
