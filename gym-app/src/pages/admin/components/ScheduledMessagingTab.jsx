import { useState } from 'react';
import posthogClient from 'posthog-js';
import { Calendar, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { AdminCard, AdminModal, FadeIn } from '../../../components/admin';

// Preset trigger windows surfaced in the create/edit modal. `delay = null`
// is the "custom" escape hatch — the modal swaps in a number input.
const TRIGGER_PRESETS = [
  { key: 'welcome',    labelKey: 'admin.messaging.presetWelcome',    labelDefault: 'New Member Welcome', delay: 0 },
  { key: 'check3',     labelKey: 'admin.messaging.presetCheck3',     labelDefault: '3-Day Check-in',     delay: 3 },
  { key: 'motivate7',  labelKey: 'admin.messaging.presetMotivate7',  labelDefault: '7-Day Motivation',   delay: 7 },
  { key: 'progress14', labelKey: 'admin.messaging.presetProgress14', labelDefault: '14-Day Progress',    delay: 14 },
  { key: 'milestone30',labelKey: 'admin.messaging.presetMilestone30',labelDefault: '30-Day Milestone',   delay: 30 },
  { key: 'custom',     labelKey: 'admin.messaging.presetCustom',     labelDefault: 'Custom',             delay: null },
];

/**
 * "Scheduled" tab of AdminMessaging — drip campaign step CRUD.
 *
 * Each row in `drip_campaign_steps` represents a templated message that
 * gets sent N days after a member's signup. The cron edge function that
 * processes the queue is separate from this UI; this surface just edits
 * the list and toggles per-step active state.
 *
 * Supports an A/B variant (`message_b`) per step — when set, the cron
 * randomly picks A or B for each recipient at send time.
 */
export default function ScheduledMessagingTab({ gymId, t }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingStep, setEditingStep] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // ── Fetch drip campaign steps ─────────────────────────
  const { data: steps = [], isLoading } = useQuery({
    queryKey: adminKeys.messaging.scheduled(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drip_campaign_steps')
        .select('*')
        .eq('gym_id', gymId)
        .order('delay_days', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Toggle active mutation ────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase
        .from('drip_campaign_steps')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.messaging.scheduled(gymId) });
      showToast(t('admin.messaging.triggerUpdated'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  // ── Delete mutation ───────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('drip_campaign_steps')
        .delete()
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.messaging.scheduled(gymId) });
      showToast(t('admin.messaging.triggerDeleted'), 'success');
      setDeleteConfirm(null);
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const handleEdit = (step) => {
    setEditingStep(step);
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditingStep(null);
    setShowModal(true);
  };

  const triggerLabel = (days) => {
    const preset = TRIGGER_PRESETS.find(p => p.delay === days);
    if (preset && preset.delay !== null) return t(preset.labelKey, preset.labelDefault);
    if (days === 0) return t('admin.messaging.onSignup');
    return `${t('admin.messaging.afterDays', { count: days })} (${days}d)`;
  };

  return (
    <FadeIn>
      <AdminCard padding="p-0">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-3 sm:p-4 border-b border-white/6">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-[#E5E7EB] truncate">{t('admin.messaging.automatedTriggers')}</h2>
            <p className="text-[12px] text-[#6B7280] mt-0.5 truncate">{t('admin.messaging.automatedTriggersDesc')}</p>
          </div>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors text-[12px] md:text-[13px] font-semibold min-h-[44px] flex-shrink-0 whitespace-nowrap focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">{t('admin.messaging.addTrigger')}</span>
          </button>
        </div>

        {/* List */}
        <div className="divide-y divide-white/4">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-white/4 rounded-lg animate-pulse" />)}
            </div>
          ) : steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar size={32} className="text-[#6B7280] mb-3" />
              <p className="text-[14px] font-semibold text-[#6B7280]">{t('admin.messaging.noTriggersYet')}</p>
              <p className="text-[12px] text-[#6B7280] mt-1">{t('admin.messaging.noTriggersDesc')}</p>
              <button onClick={handleAdd}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                <Plus size={12} /> {t('admin.messaging.addTrigger')}
              </button>
            </div>
          ) : (
            steps.map(step => (
              <div key={step.id} className="flex items-center gap-4 px-4 py-4 hover:bg-white/[0.02] transition-colors">
                {/* Active toggle */}
                <button
                  onClick={() => toggleMutation.mutate({ id: step.id, is_active: !step.is_active })}
                  aria-label={step.is_active ? t('admin.messaging.deactivate') : t('admin.messaging.activate')}
                  className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none"
                >
                  {step.is_active ? (
                    <ToggleRight size={24} className="text-[#10B981]" />
                  ) : (
                    <ToggleLeft size={24} className="text-[#6B7280]" />
                  )}
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">
                      {triggerLabel(step.delay_days)}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      step.is_active ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-white/6 text-[#6B7280]'
                    }`}>
                      {step.is_active ? t('admin.messaging.active') : t('admin.messaging.inactive')}
                    </span>
                    {step.delay_days === 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#D4AF37]/10 text-[#D4AF37]">
                        {t('admin.messaging.instant')}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#6B7280] mt-0.5 truncate max-w-[500px]">
                    {step.message_template?.substring(0, 80)}{step.message_template?.length > 80 ? '...' : ''}
                  </p>
                  {step.message_b && (
                    <p className="text-[11px] text-[#9CA3AF] mt-0.5 italic">
                      {t('admin.messaging.abVariant')}: {step.message_b.substring(0, 50)}...
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleEdit(step)}
                    aria-label={t('admin.messaging.edit')}
                    className="p-2 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/[0.04] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(step.id)}
                    aria-label={t('admin.messaging.delete')}
                    className="p-2 rounded-lg text-[#6B7280] hover:text-red-400 hover:bg-red-500/5 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-red-400 focus:outline-none"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </AdminCard>

      {/* ── Create/Edit Modal ────────────────────────────── */}
      {showModal && (
        <ScheduledMessageModal
          isOpen={showModal}
          onClose={() => { setShowModal(false); setEditingStep(null); }}
          gymId={gymId}
          editingStep={editingStep}
          t={t}
        />
      )}

      {/* ── Delete Confirmation Modal ────────────────────── */}
      {deleteConfirm && (
        <AdminModal
          isOpen={!!deleteConfirm}
          onClose={() => setDeleteConfirm(null)}
          title={t('admin.messaging.confirmDelete')}
          titleIcon={Trash2}
          size="sm"
          footer={
            <>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-[#9CA3AF] text-[13px] font-semibold hover:bg-white/[0.04] transition-colors min-h-[44px]"
              >
                {t('admin.messaging.cancel')}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/12 text-red-400 border border-red-500/25 text-[13px] font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-40 min-h-[44px]"
              >
                {deleteMutation.isPending ? t('admin.messaging.deleting') : t('admin.messaging.deleteTrigger')}
              </button>
            </>
          }
        >
          <p className="text-[13px] text-[#9CA3AF]">
            {t('admin.messaging.deleteConfirmMessage')}
          </p>
        </AdminModal>
      )}
    </FadeIn>
  );
}

// ── Scheduled Message Create/Edit Modal ─────────────────
function ScheduledMessageModal({ isOpen, onClose, gymId, editingStep, t }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [triggerType, setTriggerType] = useState(() => {
    if (!editingStep) return TRIGGER_PRESETS[0].key;
    const preset = TRIGGER_PRESETS.find(p => p.delay === editingStep.delay_days);
    return preset && preset.delay !== null ? preset.key : 'custom';
  });
  const [customDelay, setCustomDelay] = useState(editingStep?.delay_days ?? 0);
  const [messageTemplate, setMessageTemplate] = useState(editingStep?.message_template || '');
  const [messageB, setMessageB] = useState(editingStep?.message_b || '');
  const [isActive, setIsActive] = useState(editingStep?.is_active ?? true);
  const [showVariantB, setShowVariantB] = useState(!!editingStep?.message_b);

  const selectedPreset = TRIGGER_PRESETS.find(p => p.key === triggerType);
  const delayDays = selectedPreset?.delay !== null && selectedPreset?.delay !== undefined
    ? selectedPreset.delay
    : Number(customDelay) || 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!messageTemplate.trim()) throw new Error(t('admin.messaging.templateRequired', 'Message template is required'));

      const payload = {
        gym_id: gymId,
        delay_days: delayDays,
        message_template: messageTemplate.trim(),
        message_b: showVariantB && messageB.trim() ? messageB.trim() : null,
        is_active: isActive,
        step_number: delayDays,
        updated_at: new Date().toISOString(),
      };

      if (editingStep) {
        const { error } = await supabase
          .from('drip_campaign_steps')
          .update(payload)
          .eq('id', editingStep.id)
          .eq('gym_id', gymId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('drip_campaign_steps')
          .insert({ ...payload, created_at: new Date().toISOString() });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (!editingStep) posthogClient?.capture('admin_scheduled_message_created');
      queryClient.invalidateQueries({ queryKey: adminKeys.messaging.scheduled(gymId) });
      showToast(editingStep ? t('admin.messaging.triggerUpdated') : t('admin.messaging.triggerCreated'), 'success');
      onClose();
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const placeholders = ['{{name}}', '{{gym_name}}', '{{days_since_join}}'];

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={editingStep ? t('admin.messaging.editTrigger') : t('admin.messaging.addTrigger')}
      titleIcon={Calendar}
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-[#9CA3AF] text-[13px] font-semibold hover:bg-white/[0.04] transition-colors min-h-[44px]"
          >
            {t('admin.messaging.cancel')}
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !messageTemplate.trim()}
            className="flex-1 px-4 py-2.5 rounded-lg bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 text-[13px] font-semibold hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40 min-h-[44px]"
          >
            {saveMutation.isPending
              ? t('admin.messaging.saving')
              : editingStep ? t('admin.messaging.saveChanges') : t('admin.messaging.createTrigger')
            }
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Trigger type */}
        <div>
          <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
            {t('admin.messaging.triggerType')}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TRIGGER_PRESETS.map(preset => (
              <button
                key={preset.key}
                onClick={() => setTriggerType(preset.key)}
                className={`px-3 py-2 rounded-lg text-[12px] font-semibold border transition-all min-h-[44px] ${
                  triggerType === preset.key
                    ? 'bg-[#D4AF37]/12 text-[#D4AF37] border-[#D4AF37]/25'
                    : 'bg-white/[0.02] text-[#9CA3AF] border-white/6 hover:border-white/10'
                }`}
              >
                {t(preset.labelKey, preset.labelDefault)}
                {preset.delay !== null && (
                  <span className="block text-[10px] text-[#6B7280] mt-0.5">
                    {preset.delay === 0 ? t('admin.messaging.instant') : `${preset.delay} ${t('admin.messaging.days')}`}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Custom delay */}
        {triggerType === 'custom' && (
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
              {t('admin.messaging.delayDays')}
            </label>
            <input
              type="number"
              min="0"
              max="365"
              value={customDelay}
              onChange={e => setCustomDelay(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
        )}

        {/* Message template */}
        <div>
          <label className="block text-[12px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
            {t('admin.messaging.messageTemplate')}
          </label>
          <textarea
            value={messageTemplate}
            onChange={e => setMessageTemplate(e.target.value)}
            placeholder={t('admin.messaging.messageTemplatePlaceholder')}
            rows={4}
            maxLength={2000}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {placeholders.map(ph => (
              <button
                key={ph}
                onClick={() => setMessageTemplate(prev => prev + ph)}
                className="px-2 py-1 rounded-md bg-white/4 text-[11px] text-[#9CA3AF] hover:text-[#D4AF37] hover:bg-[#D4AF37]/8 transition-colors border border-white/6"
              >
                {ph}
              </button>
            ))}
          </div>
        </div>

        {/* A/B variant toggle */}
        <div>
          <button
            onClick={() => setShowVariantB(!showVariantB)}
            className="flex items-center gap-2 text-[12px] text-[#9CA3AF] hover:text-[#D4AF37] transition-colors"
          >
            <Zap size={12} />
            {showVariantB ? t('admin.messaging.removeVariantB') : t('admin.messaging.addVariantB')}
          </button>
          {showVariantB && (
            <textarea
              value={messageB}
              onChange={e => setMessageB(e.target.value)}
              placeholder={t('admin.messaging.variantBPlaceholder')}
              rows={3}
              maxLength={2000}
              className="w-full mt-2 bg-[#111827] border border-white/6 rounded-lg px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          )}
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-[#E5E7EB]">{t('admin.messaging.activeOnSave')}</span>
          <button
            onClick={() => setIsActive(!isActive)}
            aria-label={isActive ? t('admin.messaging.deactivate') : t('admin.messaging.activate')}
            className="focus:outline-none"
          >
            {isActive ? (
              <ToggleRight size={28} className="text-[#10B981]" />
            ) : (
              <ToggleLeft size={28} className="text-[#6B7280]" />
            )}
          </button>
        </div>
      </div>
    </AdminModal>
  );
}
