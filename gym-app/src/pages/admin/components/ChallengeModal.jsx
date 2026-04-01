import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Gift } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { AdminModal } from '../../../components/admin';

const CHALLENGE_TYPES = [
  { value: 'consistency' },
  { value: 'volume' },
  { value: 'pr_count' },
];

const DEFAULT_REWARDS = [
  { place: '1st', points: 500, prize: '' },
  { place: '2nd', points: 300, prize: '' },
  { place: '3rd', points: 150, prize: '' },
];

/**
 * Create / Edit Challenge modal.
 * When `challenge` is provided, operates in edit mode.
 */
export default function ChallengeModal({ isOpen, onClose, gymId, adminId, challenge = null }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!challenge;

  // ── Derive initial form values ──
  const initialForm = () => {
    if (!challenge) {
      return {
        name: '', type: 'consistency', starts_at: '', ends_at: '', description: '',
        enableRewards: false,
        rewards: [...DEFAULT_REWARDS],
      };
    }
    let rewards = [...DEFAULT_REWARDS];
    let enableRewards = false;
    try {
      const parsed = challenge.reward_description ? JSON.parse(challenge.reward_description) : null;
      if (parsed && Array.isArray(parsed)) {
        enableRewards = true;
        rewards = parsed.map((r, i) => ({
          place: r.place || ['1st', '2nd', '3rd'][i],
          points: r.points || 0,
          prize: r.prize || '',
        }));
      }
    } catch { /* ignore parse errors */ }
    const toLocal = (iso) => {
      const d = new Date(iso);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    return {
      name: challenge.name,
      type: challenge.type,
      description: challenge.description || '',
      starts_at: toLocal(challenge.start_date),
      ends_at: toLocal(challenge.end_date),
      enableRewards,
      rewards,
    };
  };

  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Create mutation ──
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { error: err } = await supabase.from('challenges').insert(payload);
      if (err) throw err;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast('Challenge created', 'success');
      onClose();
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  // ── Update mutation ──
  const updateMutation = useMutation({
    mutationFn: async (payload) => {
      const { error: err } = await supabase.from('challenges').update(payload).eq('id', challenge.id);
      if (err) throw err;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast('Challenge updated', 'success');
      onClose();
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSave = () => {
    if (!form.name || !form.starts_at || !form.ends_at) {
      setError('Name, start date, and end date are required.');
      showToast('Name, start date, and end date are required', 'error');
      return;
    }
    setError('');
    const rewardData = form.enableRewards
      ? JSON.stringify(form.rewards.map(r => ({ place: r.place, points: r.points, prize: r.prize || null })))
      : null;

    const payload = {
      name: form.name,
      type: form.type,
      description: form.description,
      reward_description: rewardData,
      start_date: new Date(form.starts_at).toISOString(),
      end_date: new Date(form.ends_at).toISOString(),
    };

    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate({
        ...payload,
        gym_id: gymId,
        created_by: adminId,
        status: 'active',
      });
    }
  };

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Challenge' : 'New Challenge'}
      titleIcon={Trophy}
      footer={
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50 transition-opacity">
          {saving ? (isEdit ? 'Saving...' : 'Creating...') : isEdit ? 'Save Changes' : 'Create Challenge'}
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Challenge Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. March Volume Wars"
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Type</label>
          <div className="space-y-2">
            {CHALLENGE_TYPES.map(ct => (
              <label key={ct.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                form.type === ct.value ? 'border-[#D4AF37]/40 bg-[#D4AF37]/5' : 'border-white/6 hover:border-white/12'
              }`}>
                <input type="radio" name="challenge-type" value={ct.value} checked={form.type === ct.value}
                  onChange={e => set('type', e.target.value)} className="mt-0.5 accent-[#D4AF37]" />
                <div>
                  <p className="text-[13px] font-semibold text-[#E5E7EB]">{t(`admin.challengeTypes.${ct.value}`)}</p>
                  <p className="text-[11px] text-[#6B7280]">{t(`admin.challengeTypes.${ct.value}_desc`)}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Start Date</label>
            <input type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">End Date</label>
            <input type="datetime-local" value={form.ends_at} onChange={e => set('ends_at', e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Description (optional)</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            rows={2} placeholder="Tell members what this challenge is about..."
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none" />
        </div>

        {/* Rewards toggle */}
        <div>
          <label className="flex items-center gap-3 cursor-pointer group">
            <div className={`relative w-10 h-[22px] rounded-full transition-colors ${form.enableRewards ? 'bg-[#D4AF37]' : 'bg-[#1E293B]'}`}
              onClick={() => set('enableRewards', !form.enableRewards)}>
              <div className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${form.enableRewards ? 'left-[22px]' : 'left-[3px]'}`} />
            </div>
            <div className="flex items-center gap-2">
              <Gift size={15} className={form.enableRewards ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
              <span className="text-[13px] font-medium text-[#E5E7EB]">Add Rewards</span>
            </div>
          </label>
          <p className="text-[11px] text-[#6B7280] mt-1 ml-[52px]">Incentivize participation with points and prizes</p>
        </div>

        {form.enableRewards && (
          <div className="space-y-3 bg-[#111827] rounded-xl p-4 border border-white/6 overflow-hidden">
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">Reward per placement</p>
            {form.rewards.map((r, i) => (
              <div key={r.place} className="flex items-center gap-3">
                <span className="text-[16px] w-6 text-center">{medals[i]}</span>
                <div className="flex-1 flex gap-2">
                  <div className="w-24">
                    <input
                      type="number" min={0} value={r.points}
                      onChange={e => {
                        const updated = [...form.rewards];
                        updated[i] = { ...r, points: parseInt(e.target.value) || 0 };
                        set('rewards', updated);
                      }}
                      className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 text-center"
                    />
                    <p className="text-[10px] text-[#6B7280] text-center mt-0.5">points</p>
                  </div>
                  <div className="flex-1">
                    <input
                      value={r.prize}
                      onChange={e => {
                        const updated = [...form.rewards];
                        updated[i] = { ...r, prize: e.target.value };
                        set('rewards', updated);
                      }}
                      placeholder="e.g. Free smoothie, 1 PT session..."
                      className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    />
                    <p className="text-[10px] text-[#6B7280] mt-0.5">prize (optional)</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-[12px] text-red-400">{error}</p>}
      </div>
    </AdminModal>
  );
}
