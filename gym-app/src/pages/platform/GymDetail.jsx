import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Activity, Settings, Crown, ChevronDown,
  Dumbbell, Clock, Pause, Play, X,
  UserPlus, Eye, EyeOff, AlertTriangle, RefreshCw,
  Trophy, Upload, Microscope, Database, HeartPulse,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import logger from '../../lib/logger';
import { logAdminAction } from '../../lib/adminAudit';
import { subDays } from 'date-fns';
import NameFields from '../admin/components/NameFields';
import { composeFullName, areNamePartsValid } from '../../lib/admin/memberName';

import GymOverviewTab from './gym-detail/GymOverviewTab';
import GymWellnessTab from './gym-detail/GymWellnessTab';
import GymPeopleTab from './gym-detail/GymPeopleTab';
import GymActivityTab from './gym-detail/GymActivityTab';
import GymContentTab from './gym-detail/GymContentTab';
import GymSettingsTab from './gym-detail/GymSettingsTab';
import PlatformMemberDetail from './gym-detail/PlatformMemberDetail';

// ── Constants ──────────────────────────────────────────────────
// Canonical tier set — plan_type is the source of truth (0043), the dropdown
// writes BOTH plan_type and subscription_tier so the list badge and this page
// can never disagree again.
const TIER_OPTIONS = ['free', 'starter', 'pro', 'lifetime', 'enterprise'];
// Real challenge_type enum values (0001). 'pr' does not exist — pr_count does.
// specific_lift omitted: it requires an exercise_id picker this modal lacks.
const CHALLENGE_TYPES = ['consistency', 'volume', 'pr_count', 'team'];
// challenges.status enum subset exposed here (archived handled elsewhere).
const CHALLENGE_STATUSES = ['draft', 'active', 'completed'];
// Real achievement_category enum values (0001:32).
const ACHIEVEMENT_CATEGORIES = ['milestone', 'challenge', 'strength_standard', 'streak', 'social'];
// gym_rewards.reward_type CHECK values (0187). Cross-gym writes use the
// super_admin FOR ALL policy added in 0585.
const REWARD_TYPE_VALUES = ['custom', 'smoothie', 'guest_pass', 'merch', 'pt_session', 'free_month', 'class_pass', 'discount', 'bring_friend'];
const ROLE_ORDER = { member: 0, trainer: 1, admin: 2, super_admin: 3 };
// Same readable charset as generate_invite_code() (0107) — no I/L/O/0/1.
const INVITE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genInviteCode = () =>
  Array.from({ length: 6 }, () => INVITE_CHARSET[Math.floor(Math.random() * INVITE_CHARSET.length)]).join('');
// Mirrors platform_create_gym's slug normalization (0542): lowercase, every
// run of non-[a-z0-9] (spaces, underscores, symbols) collapses to a single
// hyphen, leading/trailing hyphens stripped.
const normalizeSlug = (raw) =>
  String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');

// NameFields (admin component) styles its inputs from member/admin design-system
// CSS vars. Mapped here to platform-dark values so the shared component reads
// correctly inside the platform's fixed-dark Add Member modal without editing it.
const NAME_FIELDS_DARK_VARS = {
  '--color-bg-input': '#111827',
  '--color-bg-elevated': '#111827',
  '--color-text-primary': '#E5E7EB',
  '--color-text-muted': '#6B7280',
  '--color-border-subtle': 'rgba(255,255,255,0.06)',
  '--color-danger': '#EF4444',
};

// ── Challenge Modal Component ─────────────────────────────────
function ChallengeModal({ challenge, onSave, onClose }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: challenge?.name ?? '',
    type: challenge?.type ?? 'consistency',
    // New challenges default to ACTIVE: members see challenges by date range
    // regardless of status, but lifecycle broadcast / auto-settle / prize
    // award only fire for 'active' — a 'draft' default silently broke every
    // platform-created challenge. Editing keeps the stored status.
    status: challenge?.status ?? 'active',
    description: challenge?.description ?? '',
    start_date: challenge?.start_date ? challenge.start_date.slice(0, 10) : '',
    end_date: challenge?.end_date ? challenge.end_date.slice(0, 10) : '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) return;
    // start/end are NOT NULL on challenges (0001) — require them honestly.
    if (!form.start_date || !form.end_date) {
      setFormError(t('platform.gymDetail.modals.datesRequired', 'Start and end dates are required'));
      return;
    }
    if (form.end_date < form.start_date) {
      setFormError(t('platform.gymDetail.modals.endBeforeStart', 'End date must be after the start date'));
      return;
    }
    setSaving(true);
    const err = await onSave({
      name: form.name.trim(),
      type: form.type,
      status: form.status,
      description: form.description.trim() || null,
      start_date: form.start_date,
      end_date: form.end_date,
    });
    setSaving(false);
    if (err) setFormError(err); // stay open on failure
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB]">
            {challenge ? t('platform.gymDetail.modals.editChallenge') : t('platform.gymDetail.modals.newChallenge')}
          </h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.titleLabel')}</label>
            <input type="text" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder={t('platform.gymDetail.modals.titlePlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.typeLabel')}</label>
              <select value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer">
                {/* keep an out-of-set existing value (e.g. specific_lift) selectable */}
                {!CHALLENGE_TYPES.includes(form.type) && (<option value={form.type}>{t(`platform.gymDetail.contentTab.challengeType.${form.type}`, form.type)}</option>)}
                {CHALLENGE_TYPES.map(ct => (<option key={ct} value={ct}>{t(`platform.gymDetail.contentTab.challengeType.${ct}`, ct)}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.statusLabel', 'Status')}</label>
              <select value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer">
                {!CHALLENGE_STATUSES.includes(form.status) && (<option value={form.status}>{t(`platform.gymDetail.contentTab.status.${form.status}`, form.status)}</option>)}
                {CHALLENGE_STATUSES.map(cs => (<option key={cs} value={cs}>{t(`platform.gymDetail.contentTab.status.${cs}`, cs)}</option>))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.descriptionLabel')}</label>
            <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder={t('platform.gymDetail.modals.descriptionPlaceholder')} rows={3} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.startDate')} *</label>
              <input type="date" required value={form.start_date} onChange={e => setForm(prev => ({ ...prev, start_date: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.endDate')} *</label>
              <input type="date" required value={form.end_date} min={form.start_date || undefined} onChange={e => setForm(prev => ({ ...prev, end_date: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>
          {formError && <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.modals.cancel')}</button>
            <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50" style={{ background: '#D4AF37', color: '#000' }}>{saving ? t('platform.gymDetail.modals.saving') : challenge ? t('platform.gymDetail.modals.update') : t('platform.gymDetail.modals.create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Program Modal Component ───────────────────────────────────
// gym_programs (0012/0513) has NO difficulty/level column — the old modal's
// difficulty_level select made every insert AND edit fail silently.
function ProgramModal({ program, onSave, onClose }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: program?.name ?? '',
    description: program?.description ?? '',
    duration_weeks: program?.duration_weeks ?? '',
    is_published: program?.is_published ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) return;
    const weeks = parseInt(form.duration_weeks, 10);
    if (!weeks || weeks < 1) {
      setFormError(t('platform.gymDetail.modals.durationRequired', 'Duration (weeks) is required'));
      return;
    }
    setSaving(true);
    const err = await onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      duration_weeks: weeks,
      is_published: form.is_published,
    });
    setSaving(false);
    if (err) setFormError(err); // stay open on failure
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{program ? t('platform.gymDetail.modals.editProgram') : t('platform.gymDetail.modals.newProgram')}</h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.nameLabelReq')}</label>
            <input type="text" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder={t('platform.gymDetail.modals.programPlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.descriptionLabel')}</label>
            <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder={t('platform.gymDetail.modals.programDescPlaceholder')} rows={3} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.durationWeeks')} *</label>
            <input type="number" required value={form.duration_weeks} onChange={e => setForm(prev => ({ ...prev, duration_weeks: e.target.value }))} placeholder="e.g., 8" min="1" className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_published" checked={form.is_published} onChange={e => setForm(prev => ({ ...prev, is_published: e.target.checked }))} className="accent-[#D4AF37]" />
            <label htmlFor="is_published" className="text-[12px] text-[#9CA3AF]">{t('platform.gymDetail.modals.publishImmediately')}</label>
          </div>
          {formError && <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.modals.cancel')}</button>
            <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50" style={{ background: '#D4AF37', color: '#000' }}>{saving ? t('platform.gymDetail.modals.saving') : program ? t('platform.gymDetail.modals.update') : t('platform.gymDetail.modals.create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Achievement Modal Component ───────────────────────────────
// Rebuilt on the REAL achievement_definitions schema (0001:706): name,
// description (NOT NULL), icon (NOT NULL, emoji/text), category (enum),
// criteria (JSONB, optional). The old modal wrote type/requirement_value —
// columns that exist nowhere, so every save failed and reported success.
function AchievementModal({ achievement, onSave, onClose }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: achievement?.name ?? '',
    description: achievement?.description ?? '',
    icon: achievement?.icon ?? '\u{1F3C6}',
    category: achievement?.category ?? 'milestone',
    criteria: achievement?.criteria && Object.keys(achievement.criteria).length > 0
      ? JSON.stringify(achievement.criteria, null, 2)
      : '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) return;
    if (!form.description.trim()) {
      setFormError(t('platform.gymDetail.modals.descriptionRequired', 'Description is required'));
      return;
    }
    let criteria = {};
    if (form.criteria.trim()) {
      try {
        criteria = JSON.parse(form.criteria);
        if (typeof criteria !== 'object' || criteria === null || Array.isArray(criteria)) throw new Error('not an object');
      } catch {
        setFormError(t('platform.gymDetail.modals.criteriaInvalid', 'Criteria must be a valid JSON object, e.g. {"workouts": 30}'));
        return;
      }
    }
    setSaving(true);
    const err = await onSave({
      name: form.name.trim(),
      description: form.description.trim(),
      icon: form.icon.trim() || '\u{1F3C6}',
      category: form.category,
      criteria,
    });
    setSaving(false);
    if (err) setFormError(err); // stay open on failure
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{achievement ? t('platform.gymDetail.modals.editAchievement') : t('platform.gymDetail.modals.newAchievement')}</h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.nameLabelReq')}</label>
            <input type="text" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder={t('platform.gymDetail.modals.achievementPlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.descriptionLabelReq', 'Description *')}</label>
            <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder={t('platform.gymDetail.modals.achievementDescPlaceholder')} rows={3} required className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.iconLabel', 'Icon (emoji) *')}</label>
              <input type="text" value={form.icon} maxLength={16} onChange={e => setForm(prev => ({ ...prev, icon: e.target.value }))} placeholder={'\u{1F3C6}'} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.categoryLabel', 'Category *')}</label>
              <select value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer">
                {ACHIEVEMENT_CATEGORIES.map(c => (<option key={c} value={c}>{t(`platform.gymDetail.contentTab.achievementCategory.${c}`, c.replace(/_/g, ' '))}</option>))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.criteriaLabel', 'Criteria (JSON, optional)')}</label>
            <textarea value={form.criteria} onChange={e => setForm(prev => ({ ...prev, criteria: e.target.value }))} placeholder='{"workouts": 30}' rows={3} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[12px] font-mono text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
            {/* These are the exact keys the unlock engine evaluates — keep in
                sync with the member-side achievement checker. */}
            <p className="text-[10px] text-[#4B5563] mt-1">{t('platform.gymDetail.modals.criteriaHintKeys', 'Supported keys: workouts (completed workouts), checkins (check-ins), prs (PRs), streak (current streak days), volume (lifetime lbs lifted) — e.g. {"workouts": 30, "streak": 7}. All listed conditions must be met. Leave empty for manual awards.')}</p>
          </div>
          {formError && <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.modals.cancel')}</button>
            <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50" style={{ background: '#D4AF37', color: '#000' }}>{saving ? t('platform.gymDetail.modals.saving') : achievement ? t('platform.gymDetail.modals.update') : t('platform.gymDetail.modals.create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RewardModal({ reward, onSave, onClose }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: reward?.name ?? '',
    name_es: reward?.name_es ?? '',
    reward_type: reward?.reward_type ?? 'custom',
    cost_points: reward?.cost_points != null ? String(reward.cost_points) : '0',
    emoji_icon: reward?.emoji_icon ?? '\u{1F381}',
    is_active: reward?.is_active ?? true,
    sort_order: reward?.sort_order != null ? String(reward.sort_order) : '0',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) return;
    const cost = parseInt(form.cost_points, 10);
    if (Number.isNaN(cost) || cost < 0) {
      setFormError(t('platform.gymDetail.modals.rewardCostInvalid', 'Cost must be 0 or more points'));
      return;
    }
    setSaving(true);
    const err = await onSave({
      name: form.name.trim(),
      name_es: form.name_es.trim() || null,
      reward_type: form.reward_type,
      cost_points: cost,
      emoji_icon: form.emoji_icon.trim() || '\u{1F381}',
      is_active: form.is_active,
      sort_order: parseInt(form.sort_order, 10) || 0,
    });
    setSaving(false);
    if (err) setFormError(err);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB]">{reward ? t('platform.gymDetail.modals.editReward', 'Edit reward') : t('platform.gymDetail.modals.newReward', 'New reward')}</h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-[64px_1fr] gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.rewardIcon', 'Icon')}</label>
              <input type="text" value={form.emoji_icon} maxLength={24} onChange={e => setForm(p => ({ ...p, emoji_icon: e.target.value }))} placeholder={'\u{1F381}'} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[15px] text-center text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.nameLabelReq')}</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder={t('platform.gymDetail.modals.rewardNamePlaceholder', 'Free smoothie')} required className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.rewardNameEs', 'Name (Spanish, optional)')}</label>
            <input type="text" value={form.name_es} onChange={e => setForm(p => ({ ...p, name_es: e.target.value }))} placeholder="Batido gratis" className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.rewardType', 'Type')}</label>
              <select value={form.reward_type} onChange={e => setForm(p => ({ ...p, reward_type: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-2 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer">
                {REWARD_TYPE_VALUES.map(v => (<option key={v} value={v}>{t(`platform.gymDetail.rewardType.${v}`, v.replace(/_/g, ' '))}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.rewardCost', 'Cost (pts)')}</label>
              <input type="number" min="0" value={form.cost_points} onChange={e => setForm(p => ({ ...p, cost_points: e.target.value }))} required className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.rewardSort', 'Sort')}</label>
              <input type="number" value={form.sort_order} onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>
          <label className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6 cursor-pointer">
            <span className="text-[13px] text-[#E5E7EB]">{t('platform.gymDetail.modals.rewardActive', 'Active (visible to members)')}</span>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="accent-[#D4AF37] w-4 h-4" />
          </label>
          {formError && <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{formError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.modals.cancel')}</button>
            <button type="submit" disabled={saving} className="rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50" style={{ background: '#D4AF37', color: '#000' }}>{saving ? t('platform.gymDetail.modals.saving') : reward ? t('platform.gymDetail.modals.update') : t('platform.gymDetail.modals.create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Member Modal Component ────────────────────────────────
function AddMemberModal({ gymId, onClose, onCreated }) {
  const { t } = useTranslation('pages');
  // Structured name parts (first / middle / last / second last) — mirrors
  // CreateInviteModal so the platform add-member path collects the same 4 parts
  // and composes a single full_name for the RPC (no schema change).
  const [nameParts, setNameParts] = useState({ first: '', middle: '', last: '', second: '' });
  const [form, setForm] = useState({ email: '', password: '', username: '', role: 'member' });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fullName = composeFullName(nameParts);
  const namesOk = areNamePartsValid(nameParts);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!namesOk || !form.email.trim() || !form.password || !form.username.trim()) { setError(t('platform.gymDetail.modals.allFieldsRequired')); return; }
    if (form.password.length < 8 || !/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/[0-9]/.test(form.password)) { setError(t('platform.gymDetail.modals.passwordRequirements')); return; }
    setSaving(true);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_create_gym_member', { p_email: form.email.trim(), p_password: form.password, p_full_name: fullName, p_username: form.username.trim().toLowerCase(), p_gym_id: gymId, p_role: form.role });
      if (rpcErr) { setError(rpcErr.message || 'Failed to create member'); setSaving(false); return; }
      onCreated();
    } catch (err) { setError(err.message || 'Failed to create member'); setSaving(false); }
  };

  // Auto-derive the username from the first name while the username field is
  // still empty (matches the old single-field behavior, now keyed off `first`).
  const handleNameChange = (next) => {
    setNameParts(next);
    setForm(prev => prev.username ? prev : { ...prev, username: (next.first || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={onClose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[15px] font-semibold text-[#E5E7EB] flex items-center gap-2"><UserPlus className="w-4 h-4 text-[#D4AF37]" />{t('platform.gymDetail.modals.addMember')}</h3>
          <button onClick={onClose} className="p-1 text-[#6B7280] hover:text-[#E5E7EB] transition-colors" aria-label="Close dialog"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name — structured (first / middle / last / second last). NameFields
              is admin-themed (CSS vars); it inherits the platform-dark var values
              set on the wrapping element below so it reads correctly here. */}
          <div style={NAME_FIELDS_DARK_VARS}>
            <NameFields value={nameParts} onChange={handleNameChange} />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.usernameLabel')}</label>
            <input type="text" value={form.username} onChange={e => setForm(prev => ({ ...prev, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))} placeholder={t('platform.gymDetail.modals.usernamePlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono" required />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.emailLabel')}</label>
            <input type="email" value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder={t('platform.gymDetail.modals.emailPlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.tempPassword')}</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} placeholder={t('platform.gymDetail.modals.passwordPlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 pr-9 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required minLength={8} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#9CA3AF] transition-colors" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.roleLabel')}</label>
            <div className="grid grid-cols-3 gap-1.5 bg-[#111827] border border-white/6 rounded-lg p-1">
              {[
                { value: 'member', label: t('platform.gymDetail.roles.member') },
                { value: 'trainer', label: t('platform.gymDetail.roles.trainer') },
                { value: 'admin', label: t('platform.gymDetail.roles.admin') },
              ].map(r => (
                <button key={r.value} type="button" onClick={() => setForm(prev => ({ ...prev, role: r.value }))}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${form.role === r.value ? r.value === 'admin' ? 'bg-indigo-500/15 text-indigo-400' : r.value === 'trainer' ? 'bg-purple-500/15 text-purple-400' : 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF]'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.modals.cancel')}</button>
            <button type="submit" disabled={saving || !namesOk} className="rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: '#D4AF37', color: '#000' }}>{saving ? t('platform.gymDetail.modals.creating') : t('platform.gymDetail.modals.createMember')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────
export default function GymDetail() {
  const { gymId } = useParams();
  const navigate = useNavigate();
  const { profile, impersonateGym } = useAuth();
  const { t } = useTranslation('pages');

  const [gym, setGym] = useState(null);
  const [branding, setBranding] = useState(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [members, setMembers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [contentSubTab, setContentSubTab] = useState('challenges');
  const [editingTier, setEditingTier] = useState(false);
  const [editingGym, setEditingGym] = useState({ name: '', slug: '', qr_enabled: false, qr_payload_type: 'auto_id', qr_display_format: 'qr_code', qr_payload_template: '', classes_enabled: false, multi_admin_enabled: false, max_admin_seats: 1, sms_phone_number: '' });
  const [savingGym, setSavingGym] = useState(false);
  // A6: snapshot of the gym values loaded when the edit state was initialized —
  // saveGymSettings diffs against it so a platform save can't clobber fields a
  // gym admin changed meanwhile.
  const editBaseline = useRef(null);
  // A2: inline validation error rendered by GymSettingsTab next to the form.
  const [settingsError, setSettingsError] = useState('');
  // A4: per-section read failures (members/invites/activity/challenges/
  // programs/achievements). Failed reads used to render as empty states.
  const [loadErrors, setLoadErrors] = useState({});
  const [retryingLoads, setRetryingLoads] = useState(false);
  const [challenges, setChallenges] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [rewardsAvailable, setRewardsAvailable] = useState(null);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState(null);
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null);
  const [showAchievementModal, setShowAchievementModal] = useState(false);
  const [editingAchievement, setEditingAchievement] = useState(null);
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [editingReward, setEditingReward] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  // P0-7: click-into member detail — reuses the admin MemberDetail re-skinned to
  // the platform dark theme (PlatformMemberDetail wrapper).
  const [selectedMember, setSelectedMember] = useState(null);
  const [lifecycleModal, setLifecycleModal] = useState(null);
  const [pauseReason, setPauseReason] = useState('');
  const [deleteGymConfirmName, setDeleteGymConfirmName] = useState('');
  const [lifecycleProcessing, setLifecycleProcessing] = useState(false);
  const [statsRow, setStatsRow] = useState(null);
  const [toast, setToast] = useState(null);

  // Tiny inline toast — this page had ZERO mutation feedback before; every
  // failed write looked like success. Fixed-dark styling matches the platform.
  const toastTimer = useRef(null);
  const notify = useCallback((message, type = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 5000 : 3000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── Data fetching ─────────────────────────────────────────
  // A4: record (or clear) a per-section load failure — same idea as the
  // fetchRewards rewardsAvailable=false pattern, generalized.
  const markLoad = (key, error) => {
    if (error) console.warn(`[GymDetail] ${key} load failed:`, error);
    setLoadErrors(prev => {
      if (!!error === !!prev[key]) return prev;
      const next = { ...prev };
      if (error) next[key] = true; else delete next[key];
      return next;
    });
  };
  const fetchGym = async () => {
    const { data } = await supabase.from('gyms').select('*').eq('id', gymId).single();
    if (data) {
      setGym(data);
      const initialEdit = { name: data.name, slug: data.slug, qr_enabled: data.qr_enabled ?? false, qr_payload_type: data.qr_payload_type ?? 'auto_id', qr_display_format: data.qr_display_format ?? 'qr_code', qr_payload_template: data.qr_payload_template ?? '', classes_enabled: data.classes_enabled ?? false, multi_admin_enabled: data.multi_admin_enabled ?? false, max_admin_seats: data.max_admin_seats ?? 1, sms_phone_number: data.sms_phone_number ?? '' };
      setEditingGym(initialEdit);
      editBaseline.current = initialEdit; // A6: diff base for saveGymSettings
    }
    const { data: b } = await supabase.from('gym_branding').select('*').eq('gym_id', gymId).maybeSingle();
    setBranding(b);
    if (b?.logo_url) {
      const { data: signed } = await supabase.storage.from('gym-logos').createSignedUrl(b.logo_url, 60 * 60 * 24);
      setLogoUrl(signed?.signedUrl ?? '');
    } else {
      setLogoUrl('');
    }
  };
  // A4: each fetcher keeps the previous list on failure (instead of clobbering
  // it with []) and flags the section so the UI can say so honestly.
  // Perf: exclude bulk-import "ghost" shells (imported_archived) and hard-bound
  // the result. An imported gym can hold tens of thousands of these shells, and
  // fetching every one was the 119s GET /rest/v1/profiles in the error logs.
  // They're never surfaced as real members here (People/Overview/Settings all
  // treat imported_archived as non-members) and the authoritative counts come
  // from the platform_gym_stats RPC, so capping the rendered list is safe.
  const fetchMembers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, username, role, additional_roles, created_at, last_active_at, membership_status, avatar_url, avatar_type, avatar_value, imported_archived')
      .eq('gym_id', gymId)
      .not('imported_archived', 'is', true)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (!error) setMembers(data ?? []);
    markLoad('members', error);
  };
  const fetchActivity = async () => { const { data: sess, error: sessErr } = await supabase.from('workout_sessions').select('id, profile_id, status, started_at, total_volume_lbs, profiles(full_name)').eq('gym_id', gymId).order('started_at', { ascending: false }).limit(20); if (!sessErr) setSessions(sess ?? []); const { data: ci, error: ciErr } = await supabase.from('check_ins').select('id, profile_id, checked_in_at, profiles(full_name)').eq('gym_id', gymId).order('checked_in_at', { ascending: false }).limit(20); if (!ciErr) setCheckIns(ci ?? []); markLoad('activity', sessErr || ciErr); };
  const fetchInvites = async () => { const { data, error } = await supabase.from('gym_invites').select('*').eq('gym_id', gymId).order('created_at', { ascending: false }); if (!error) setInvites(data ?? []); markLoad('invites', error); };
  const fetchChallenges = async () => { const { data, error } = await supabase.from('challenges').select('*, challenge_participants(id)').eq('gym_id', gymId).order('start_date', { ascending: false }); if (!error) setChallenges(data ?? []); markLoad('challenges', error); };
  const fetchPrograms = async () => { const { data, error } = await supabase.from('gym_programs').select('*').eq('gym_id', gymId).order('created_at', { ascending: false }); if (!error) setPrograms(data ?? []); markLoad('programs', error); };
  const fetchAchievements = async () => { const { data, error } = await supabase.from('achievement_definitions').select('*, user_achievements(id)').eq('gym_id', gymId).order('created_at', { ascending: false }); if (!error) setAchievements(data ?? []); markLoad('achievements', error); };
  // P2-8: read the REAL rewards catalog (gym_rewards, 0187) — the old code read
  // reward_points (per-member balances, select_own-only RLS) → permanently empty.
  const fetchRewards = async () => { try { const { data, error } = await supabase.from('gym_rewards').select('id, name, name_es, description, description_es, cost_points, reward_type, emoji_icon, is_active, sort_order').eq('gym_id', gymId).order('sort_order', { ascending: true }).order('cost_points', { ascending: true }); if (error) { setRewardsAvailable(false); } else { setRewardsAvailable(data ?? []); } } catch { setRewardsAvailable(false); } };
  // P1-4: header stats came from the limit(20) activity feed — a gym doing 400
  // sessions/month read "20". Pull this gym's row from platform_gym_stats
  // (uncapped, completed-only, ghost-free) + a head-count for check-in events.
  const fetchStats = async () => {
    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    const [rpcRes, ciRes] = await Promise.all([
      supabase.rpc('platform_gym_stats'),
      supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).gte('checked_in_at', thirtyDaysAgo),
    ]);
    let row = null;
    if (!rpcRes.error) row = (rpcRes.data ?? []).find(r => r.gym_id === gymId) ?? null;
    else logger.error('platform_gym_stats failed:', rpcRes.error);
    let sessions30d = row?.sessions_30d;
    if (sessions30d == null) {
      // RPC unavailable → honest uncapped count query instead of the 20-row feed
      const sessRes = await supabase.from('workout_sessions').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('status', 'completed').gte('started_at', thirtyDaysAgo);
      sessions30d = sessRes.count ?? null;
    }
    setStatsRow({ row, sessions30d, checkIns30d: ciRes.count ?? null });
  };

  useEffect(() => { const load = async () => { setLoading(true); await Promise.all([fetchGym(), fetchMembers(), fetchActivity(), fetchInvites(), fetchChallenges(), fetchPrograms(), fetchAchievements(), fetchRewards(), fetchStats()]); setLoading(false); }; load(); }, [gymId]);

  // A4: re-run only the fetches that failed (banner button).
  const retryFailedLoads = async () => {
    const fetchers = { members: fetchMembers, activity: fetchActivity, invites: fetchInvites, challenges: fetchChallenges, programs: fetchPrograms, achievements: fetchAchievements };
    const failed = Object.keys(loadErrors).filter(k => fetchers[k]);
    if (failed.length === 0 || retryingLoads) return;
    setRetryingLoads(true);
    await Promise.all(failed.map(k => fetchers[k]()));
    setRetryingLoads(false);
  };

  useEffect(() => {
    if (gym?.name) document.title = `${gym.name} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [gym?.name]);

  // P1-6: count REAL members (role=member, not imported ghosts) — staff and
  // archived import shells inflated every count on this page before.
  const stats = useMemo(() => {
    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    const realMembers = members.filter(m => m.role === 'member' && m.imported_archived !== true);
    const totalMembers = statsRow?.row?.member_count ?? realMembers.length;
    const activeMembers = statsRow?.row?.active_30d ?? realMembers.filter(m => m.last_active_at && m.last_active_at >= thirtyDaysAgo).length;
    const recentSessions = statsRow?.sessions30d ?? sessions.filter(s => s.status === 'completed' && s.started_at >= thirtyDaysAgo).length;
    const avgSessions = activeMembers > 0 ? (recentSessions / activeMembers).toFixed(1) : '0';
    const checkIns30d = statsRow?.checkIns30d ?? checkIns.length;
    return { totalMembers, activeMembers, recentSessions, avgSessions, checkIns30d };
  }, [members, sessions, checkIns, statsRow]);
  const gymStatus = !gym?.is_active && gym?.subscription_tier === 'cancelled' ? 'deactivated' : !gym?.is_active ? 'paused' : 'active';

  // ── Actions ───────────────────────────────────────────────
  const handlePauseGym = async () => { if (!gym || lifecycleProcessing) return; setLifecycleProcessing(true); const { error } = await supabase.rpc('pause_gym', { p_gym_id: gymId }); if (!error) { logAdminAction('pause_gym', 'gym', gymId, { gym_name: gym.name, reason: pauseReason || null }, gymId); setGym(prev => ({ ...prev, is_active: false })); await fetchMembers(); notify(t('platform.gymDetail.toasts.gymPaused', 'Gym paused')); } else { logger.error('Failed to pause gym:', error); notify(t('platform.gymDetail.toasts.pauseFailed', 'Could not pause the gym: {{error}}', { error: error.message }), 'error'); } setLifecycleProcessing(false); setLifecycleModal(null); setPauseReason(''); };
  const handleReactivateGym = async () => { if (!gym || lifecycleProcessing) return; setLifecycleProcessing(true); const { error } = await supabase.rpc('unpause_gym', { p_gym_id: gymId }); if (!error) { const updates = { is_active: true, ...(gym.subscription_tier === 'cancelled' ? { subscription_tier: 'free' } : {}) }; logAdminAction('reactivate_gym', 'gym', gymId, { gym_name: gym.name }, gymId); setGym(prev => ({ ...prev, ...updates })); await fetchMembers(); notify(t('platform.gymDetail.toasts.gymReactivated', 'Gym reactivated')); } else { logger.error('Failed to reactivate gym:', error); notify(t('platform.gymDetail.toasts.reactivateFailed', 'Could not reactivate the gym: {{error}}', { error: error.message }), 'error'); } setLifecycleProcessing(false); setLifecycleModal(null); };
  // P2-6: route through pause_gym (0294) so each member's current status is
  // snapshotted into pre_pause_status BEFORE everyone is deactivated (the old
  // direct update made a later reactivate resurrect banned members as active).
  // Then mark the tier cancelled. A3: this is honestly a DEACTIVATE (nothing
  // is deleted, Reactivate fully reverses it) — UI copy says so; permanent
  // deletion lives in GymOps.
  const handleDeleteGym = async () => {
    if (!gym || lifecycleProcessing) return;
    if (deleteGymConfirmName !== gym.name) return;
    setLifecycleProcessing(true);
    const { error: pauseErr } = await supabase.rpc('pause_gym', { p_gym_id: gymId });
    if (pauseErr) {
      logger.error('Failed to deactivate gym:', pauseErr);
      notify(t('platform.gymDetail.toasts.deleteFailed', 'Could not deactivate the gym: {{error}}', { error: pauseErr.message }), 'error');
      setLifecycleProcessing(false);
      return;
    }
    // A3: mirror plan_type alongside subscription_tier — updateTier writes
    // both, so leaving plan_type behind made the list badge disagree again.
    const { error: gymErr } = await supabase.from('gyms').update({ subscription_tier: 'cancelled', plan_type: 'cancelled' }).eq('id', gymId);
    if (gymErr) {
      logger.error('Failed to mark gym cancelled:', gymErr);
      notify(t('platform.gymDetail.toasts.deleteFailed', 'Could not deactivate the gym: {{error}}', { error: gymErr.message }), 'error');
      setGym(prev => ({ ...prev, is_active: false })); // pause did land
      setLifecycleProcessing(false);
      return;
    }
    logAdminAction('deactivate_gym', 'gym', gymId, { gym_name: gym.name }, gymId);
    setGym(prev => ({ ...prev, is_active: false, subscription_tier: 'cancelled', plan_type: 'cancelled' }));
    await fetchMembers();
    notify(t('platform.gymDetail.toasts.gymDeactivatedReversible', 'Gym deactivated — reversible via Reactivate'));
    setLifecycleProcessing(false);
    setLifecycleModal(null);
    setDeleteGymConfirmName('');
  };
  // P2-12: tier writes BOTH plan_type (canonical per 0043) and
  // subscription_tier (legacy mirror) so list badge + detail agree.
  const updateTier = async (tier) => {
    const { error } = await supabase.from('gyms').update({ plan_type: tier, subscription_tier: tier }).eq('id', gymId);
    if (error) { notify(t('platform.gymDetail.toasts.tierFailed', 'Could not change the plan: {{error}}', { error: error.message }), 'error'); return; }
    logAdminAction('change_gym_tier', 'gym', gymId, { gym_name: gym?.name, from: gym?.plan_type ?? gym?.subscription_tier ?? null, to: tier }, gymId);
    setGym(prev => ({ ...prev, plan_type: tier, subscription_tier: tier }));
    setEditingTier(false);
    notify(t('platform.gymDetail.toasts.tierChanged', 'Plan updated to {{tier}}', { tier: tier.toUpperCase() }));
  };
  // P2-3: role changes go through the hardened RPCs — demoting a trainer via a
  // raw UPDATE left zombie trainer_clients rows (0358's whole reason to exist),
  // and additional_roles could silently keep a higher role in the bag.
  const updateMemberRole = async (member, newRole) => {
    if (!member || member.role === newRole) return;
    if (member.role === 'super_admin' || (member.additional_roles ?? []).includes('super_admin')) return; // UI renders these read-only too
    let error = null;
    if (member.role === 'trainer') {
      // Atomic demote (0358/0471): deactivates trainer_clients + flips role→member
      ({ error } = await supabase.rpc('demote_trainer_atomically', { p_trainer_id: member.id }));
      if (!error && newRole === 'admin') {
        const newBag = (member.additional_roles ?? []).filter(r => ROLE_ORDER[r] != null && ROLE_ORDER[r] < ROLE_ORDER.admin);
        ({ error } = await supabase.from('profiles').update({ role: 'admin', additional_roles: newBag }).eq('id', member.id));
      }
    } else if (newRole === 'trainer') {
      // 0489 promote RPC: bag-aware, idempotent, preserves higher primary roles
      ({ error } = await supabase.rpc('promote_member_to_trainer', { p_member_id: member.id }));
    } else {
      // member ↔ admin: never leave a role >= the new primary in the bag
      const newBag = (member.additional_roles ?? []).filter(r => ROLE_ORDER[r] != null && ROLE_ORDER[r] < ROLE_ORDER[newRole]);
      ({ error } = await supabase.from('profiles').update({ role: newRole, additional_roles: newBag }).eq('id', member.id));
    }
    if (error) {
      notify(t('platform.gymDetail.toasts.roleFailed', 'Could not change role: {{error}}', { error: error.message }), 'error');
      return;
    }
    logAdminAction('change_role', 'member', member.id, { gym_name: gym?.name, from: member.role, to: newRole }, gymId);
    await fetchMembers(); // refetch: the RPCs may have adjusted the bag server-side
    notify(t('platform.gymDetail.toasts.roleChanged', 'Role updated'));
  };
  const updateMemberStatus = async (member, newStatus) => {
    if (!member || member.membership_status === newStatus) return;
    const { error } = await supabase.from('profiles').update({ membership_status: newStatus }).eq('id', member.id);
    if (error) {
      notify(t('platform.gymDetail.toasts.statusFailed', 'Could not change status: {{error}}', { error: error.message }), 'error');
      return;
    }
    logAdminAction('change_member_status', 'member', member.id, { gym_name: gym?.name, from: member.membership_status ?? 'active', to: newStatus }, gymId);
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, membership_status: newStatus } : m));
    notify(t('platform.gymDetail.toasts.statusChanged', 'Status updated'));
  };
  const deleteMember = async (member) => { if (!window.confirm(t('platform.gymDetail.deleteMember.confirm', { name: member.full_name ?? member.username }))) return; const { error } = await supabase.rpc('admin_delete_gym_member', { p_user_id: member.id }); if (error) { notify(t('platform.gymDetail.deleteMember.failed', { error: error.message }), 'error'); } else { logAdminAction('delete_member', 'member', member.id, { gym_name: gym?.name, name: member.full_name ?? member.username }, gymId); setMembers(prev => prev.filter(m => m.id !== member.id)); notify(t('platform.gymDetail.toasts.memberDeleted', 'Member deleted')); } };
  const saveGymSettings = async () => {
    setSavingGym(true);
    setSettingsError('');
    // A2: normalize + validate the slug exactly like platform_create_gym (0542)
    // — the old code wrote the raw input, so "My Gym!" became a dead deep link.
    const slug = normalizeSlug(editingGym.slug);
    if (!slug) {
      const msg = t('platform.gymDetail.settings.slugInvalid', 'Slug must contain at least one letter or number');
      setSettingsError(msg);
      notify(msg, 'error');
      setSavingGym(false);
      return;
    }
    if (slug !== gym?.slug) {
      const { data: dupe, error: dupeErr } = await supabase.from('gyms').select('id').eq('slug', slug).neq('id', gymId).maybeSingle();
      if (!dupeErr && dupe) {
        const msg = t('platform.gymDetail.settings.slugTaken', 'That slug is already in use by another gym');
        setSettingsError(msg);
        notify(msg, 'error');
        setSavingGym(false);
        return;
      }
      // dupeErr → proceed: the unique index on gyms.slug still backstops the write.
    }
    // A6: dirty-field diff against the snapshot taken when editing started —
    // the old full-snapshot write reverted anything a gym admin changed since
    // this page loaded (name, classes_enabled, qr_enabled...).
    // qr_display_format is hardcoded to 'qr_code' — barcode formats were removed
    // from the UI (member-facing readers coalesce to 'qr_code' anyway). The DB
    // column already DEFAULTs to 'qr_code'; this keeps any legacy barcode value
    // from surviving a save.
    const toPayload = (src) => ({ name: src.name, slug: normalizeSlug(src.slug), qr_enabled: src.qr_enabled, qr_payload_type: src.qr_payload_type, qr_display_format: 'qr_code', qr_payload_template: src.qr_payload_template || null, classes_enabled: src.classes_enabled, multi_admin_enabled: src.multi_admin_enabled, max_admin_seats: src.max_admin_seats, sms_phone_number: src.sms_phone_number || null });
    const candidate = toPayload({ ...editingGym, slug });
    const base = editBaseline.current ? toPayload(editBaseline.current) : null;
    const updates = {};
    Object.keys(candidate).forEach(k => { if (!base || candidate[k] !== base[k]) updates[k] = candidate[k]; });
    if (Object.keys(updates).length === 0) {
      notify(t('platform.gymDetail.toasts.noChanges', 'No changes to save'));
      setSavingGym(false);
      return;
    }
    const { error } = await supabase.from('gyms').update(updates).eq('id', gymId);
    if (error) {
      notify(t('platform.gymDetail.toasts.settingsFailed', 'Could not save settings: {{error}}', { error: error.message }), 'error');
    } else {
      logAdminAction('update_gym_settings', 'gym', gymId, { gym_name: editingGym.name ?? gym?.name, fields: Object.keys(updates) }, gymId);
      setGym(prev => ({ ...prev, ...updates }));
      setEditingGym(prev => ({ ...prev, slug }));
      editBaseline.current = { ...editingGym, slug }; // next save diffs against what we just wrote
      notify(t('platform.gymDetail.toasts.settingsSaved', 'Settings saved'));
    }
    setSavingGym(false);
  };

  // ── Invites + owner (P0-1d) ───────────────────────────────
  // Direct inserts ride the 0542 super_admin RLS arm. Codes follow the 0107
  // convention (6 chars, no I/L/O/0/1); the partial unique index is the
  // collision guard — retry on 23505.
  const createInvite = async ({ email, role }) => {
    const cleanEmail = (email ?? '').trim().toLowerCase() || null;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return t('platform.gymDetail.invites.invalidEmail', 'Enter a valid email or leave it empty');
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = genInviteCode();
      const { error } = await supabase.from('gym_invites').insert({
        gym_id: gymId,
        created_by: profile?.id ?? null,
        email: cleanEmail,
        invite_code: code,
        role: role === 'trainer' ? 'trainer' : 'member',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (!error) {
        logAdminAction('create_invite', 'gym_invite', null, { gym_name: gym?.name, code, email: cleanEmail, role }, gymId);
        await fetchInvites();
        notify(t('platform.gymDetail.toasts.inviteCreated', 'Invite {{code}} created', { code }));
        return null;
      }
      if (error.code !== '23505') {
        notify(t('platform.gymDetail.toasts.inviteFailed', 'Could not create the invite: {{error}}', { error: error.message }), 'error');
        return error.message;
      }
    }
    const msg = t('platform.gymDetail.toasts.inviteCodeCollision', 'Could not generate a unique code — try again');
    notify(msg, 'error');
    return msg;
  };
  const revokeInvite = async (inv) => {
    const { error } = await supabase.from('gym_invites').delete().eq('id', inv.id);
    if (error) {
      notify(t('platform.gymDetail.toasts.revokeFailed', 'Could not revoke the invite: {{error}}', { error: error.message }), 'error');
      return;
    }
    logAdminAction('revoke_invite', 'gym_invite', inv.id, { gym_name: gym?.name, code: inv.invite_code ?? inv.token }, gymId);
    setInvites(prev => prev.filter(i => i.id !== inv.id));
    notify(t('platform.gymDetail.toasts.inviteRevoked', 'Invite revoked'));
  };
  const copyInviteCode = async (inv) => {
    try {
      await navigator.clipboard.writeText(inv.invite_code ?? inv.token ?? '');
      notify(t('platform.gymDetail.toasts.codeCopied', 'Code copied'));
    } catch {
      notify(t('platform.gymDetail.toasts.copyFailed', 'Could not copy — copy it manually'), 'error');
    }
  };
  // gyms.owner_user_id was written by NO code path before — the Owner column
  // on GymsOverview was permanently "—". 0040's update-any policy covers this.
  const setGymOwner = async (ownerId) => {
    // .select() the updated row back so a silent 0-row write (RLS filtering the
    // UPDATE raises NO error) is caught instead of reported as success — that
    // was a way "Set owner" could appear to do nothing. A bad ownerId (e.g. a
    // ghost/imported profile that isn't a real auth user) instead surfaces as a
    // foreign-key error here; the picker now only offers real admins.
    const { data, error } = await supabase
      .from('gyms')
      .update({ owner_user_id: ownerId || null })
      .eq('id', gymId)
      .select('owner_user_id')
      .maybeSingle();
    if (error) {
      notify(t('platform.gymDetail.toasts.ownerFailed', 'Could not set the owner: {{error}}', { error: error.message }), 'error');
      return;
    }
    if (!data) {
      notify(t('platform.gymDetail.toasts.ownerFailed', 'Could not set the owner: {{error}}', { error: t('platform.gymDetail.toasts.ownerNoRow', 'no permission or the gym was not found') }), 'error');
      return;
    }
    logAdminAction('set_gym_owner', 'gym', gymId, { gym_name: gym?.name, owner_user_id: ownerId || null }, gymId);
    // Reflect the authoritative saved value immediately, then re-read the gym so
    // the rest of the page (and the owner label) tracks the source of truth.
    setGym(prev => ({ ...prev, owner_user_id: data.owner_user_id }));
    await fetchGym();
    notify(t('platform.gymDetail.toasts.ownerSet', 'Owner updated'));
  };

  // ── Content CRUD ──────────────────────────────────────────
  // Every handler returns null on success or an error message (the modal stays
  // open and shows it). The old versions discarded { error } and closed anyway.
  const saveChallenge = async (formData) => {
    let error;
    if (editingChallenge?.id) {
      ({ error } = await supabase.from('challenges').update(formData).eq('id', editingChallenge.id));
    } else {
      // created_by is NOT NULL on challenges (0001)
      ({ error } = await supabase.from('challenges').insert({ ...formData, gym_id: gymId, created_by: profile?.id }));
    }
    if (error) {
      notify(t('platform.gymDetail.toasts.saveFailed', 'Save failed: {{error}}', { error: error.message }), 'error');
      return error.message;
    }
    logAdminAction(editingChallenge?.id ? 'update_challenge' : 'create_challenge', 'challenge', editingChallenge?.id ?? null, { gym_name: gym?.name, name: formData.name }, gymId);
    await fetchChallenges();
    notify(t('platform.gymDetail.toasts.saved', 'Saved'));
    setShowChallengeModal(false);
    setEditingChallenge(null);
    return null;
  };
  const deleteChallenge = async (challengeId) => { const { error } = await supabase.from('challenges').delete().eq('id', challengeId); if (error) { notify(t('platform.gymDetail.toasts.deleteEntityFailed', 'Delete failed: {{error}}', { error: error.message }), 'error'); } else { logAdminAction('delete_challenge', 'challenge', challengeId, { gym_name: gym?.name }, gymId); setChallenges(prev => prev.filter(c => c.id !== challengeId)); notify(t('platform.gymDetail.toasts.deleted', 'Deleted')); } setDeleteConfirm(null); };
  const saveProgram = async (formData) => {
    let error;
    if (editingProgram?.id) {
      ({ error } = await supabase.from('gym_programs').update(formData).eq('id', editingProgram.id));
    } else {
      // created_by is NOT NULL on gym_programs (0012)
      ({ error } = await supabase.from('gym_programs').insert({ ...formData, gym_id: gymId, created_by: profile?.id }));
    }
    if (error) {
      notify(t('platform.gymDetail.toasts.saveFailed', 'Save failed: {{error}}', { error: error.message }), 'error');
      return error.message;
    }
    logAdminAction(editingProgram?.id ? 'update_program' : 'create_program', 'program', editingProgram?.id ?? null, { gym_name: gym?.name, name: formData.name }, gymId);
    await fetchPrograms();
    notify(t('platform.gymDetail.toasts.saved', 'Saved'));
    setShowProgramModal(false);
    setEditingProgram(null);
    return null;
  };
  const toggleProgramPublish = async (prog) => { const { error } = await supabase.from('gym_programs').update({ is_published: !prog.is_published }).eq('id', prog.id); if (error) { notify(t('platform.gymDetail.toasts.saveFailed', 'Save failed: {{error}}', { error: error.message }), 'error'); } else { setPrograms(prev => prev.map(p => p.id === prog.id ? { ...p, is_published: !p.is_published } : p)); } };
  const deleteProgram = async (programId) => { const { error } = await supabase.from('gym_programs').delete().eq('id', programId); if (error) { notify(t('platform.gymDetail.toasts.deleteEntityFailed', 'Delete failed: {{error}}', { error: error.message }), 'error'); } else { logAdminAction('delete_program', 'program', programId, { gym_name: gym?.name }, gymId); setPrograms(prev => prev.filter(p => p.id !== programId)); notify(t('platform.gymDetail.toasts.deleted', 'Deleted')); } setDeleteConfirm(null); };
  const saveAchievement = async (formData) => {
    let error;
    if (editingAchievement?.id) {
      ({ error } = await supabase.from('achievement_definitions').update(formData).eq('id', editingAchievement.id));
    } else {
      // gym-scoped definition → not global
      ({ error } = await supabase.from('achievement_definitions').insert({ ...formData, gym_id: gymId, is_global: false }));
    }
    if (error) {
      notify(t('platform.gymDetail.toasts.saveFailed', 'Save failed: {{error}}', { error: error.message }), 'error');
      return error.message;
    }
    logAdminAction(editingAchievement?.id ? 'update_achievement' : 'create_achievement', 'achievement', editingAchievement?.id ?? null, { gym_name: gym?.name, name: formData.name }, gymId);
    await fetchAchievements();
    notify(t('platform.gymDetail.toasts.saved', 'Saved'));
    setShowAchievementModal(false);
    setEditingAchievement(null);
    return null;
  };
  const deleteAchievement = async (achievementId) => { const { error } = await supabase.from('achievement_definitions').delete().eq('id', achievementId); if (error) { notify(t('platform.gymDetail.toasts.deleteEntityFailed', 'Delete failed: {{error}}', { error: error.message }), 'error'); } else { logAdminAction('delete_achievement', 'achievement', achievementId, { gym_name: gym?.name }, gymId); setAchievements(prev => prev.filter(a => a.id !== achievementId)); notify(t('platform.gymDetail.toasts.deleted', 'Deleted')); } setDeleteConfirm(null); };

  // ── Rewards CRUD (gym_rewards; cross-gym writes via 0585 super_admin ALL) ──
  const saveReward = async (payload) => {
    if (editingReward) {
      const { error } = await supabase.from('gym_rewards').update(payload).eq('id', editingReward.id);
      if (error) { notify(t('platform.gymDetail.toasts.saveFailed', 'Save failed: {{error}}', { error: error.message }), 'error'); return error.message; }
      setRewardsAvailable(prev => Array.isArray(prev) ? prev.map(r => r.id === editingReward.id ? { ...r, ...payload } : r) : prev);
      logAdminAction('update_reward', 'reward', editingReward.id, { gym_name: gym?.name, name: payload.name }, gymId);
    } else {
      const { data, error } = await supabase.from('gym_rewards').insert({ gym_id: gymId, ...payload }).select().single();
      if (error) { notify(t('platform.gymDetail.toasts.saveFailed', 'Save failed: {{error}}', { error: error.message }), 'error'); return error.message; }
      setRewardsAvailable(prev => Array.isArray(prev) ? [...prev, data] : [data]);
      logAdminAction('create_reward', 'reward', data.id, { gym_name: gym?.name, name: payload.name }, gymId);
    }
    setShowRewardModal(false);
    setEditingReward(null);
    notify(t('platform.gymDetail.toasts.saved', 'Saved'));
    return null;
  };
  const deleteReward = async (rewardId) => { const { error } = await supabase.from('gym_rewards').delete().eq('id', rewardId); if (error) { notify(t('platform.gymDetail.toasts.deleteEntityFailed', 'Delete failed: {{error}}', { error: error.message }), 'error'); } else { logAdminAction('delete_reward', 'reward', rewardId, { gym_name: gym?.name }, gymId); setRewardsAvailable(prev => Array.isArray(prev) ? prev.filter(r => r.id !== rewardId) : prev); notify(t('platform.gymDetail.toasts.deleted', 'Deleted')); } setDeleteConfirm(null); };
  const toggleRewardActive = async (reward) => { const next = !reward.is_active; const { error } = await supabase.from('gym_rewards').update({ is_active: next }).eq('id', reward.id); if (error) { notify(t('platform.gymDetail.toasts.saveFailed', 'Save failed: {{error}}', { error: error.message }), 'error'); return; } setRewardsAvailable(prev => Array.isArray(prev) ? prev.map(r => r.id === reward.id ? { ...r, is_active: next } : r) : prev); logAdminAction('toggle_reward', 'reward', reward.id, { gym_name: gym?.name, is_active: next }, gymId); };
  const getChallengeStatus = (c) => { const now = new Date(); if (c.status && c.status !== 'active') return c.status; if (c.end_date && new Date(c.end_date) < now) return 'ended'; if (c.start_date && new Date(c.start_date) > now) return 'upcoming'; return c.status ?? 'active'; };

  // ── Loading / not found ───────────────────────────────────
  if (loading) return (<div className="min-h-screen bg-[#05070B] flex items-center justify-center" aria-busy="true"><div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" role="status" aria-label={t('platform.gymDetail.loadingAria', 'Loading gym details')} /></div>);
  if (!gym) return (<div className="min-h-screen bg-[#05070B] flex flex-col items-center justify-center gap-4"><p className="text-[#9CA3AF] text-sm">{t('platform.gymDetail.gymNotFound', 'Gym not found.')}</p><button onClick={() => navigate('/platform')} className="text-[#D4AF37] text-sm hover:underline">{t('platform.gymDetail.backToPlatform', 'Back to Platform')}</button></div>);

  const tabs = [
    { key: 'overview', label: t('platform.gymDetail.tabs.overview', 'Overview'), icon: Activity },
    { key: 'wellness', label: t('platform.gymDetail.tabs.wellness', 'Wellness'), icon: HeartPulse },
    { key: 'people',   label: t('platform.gymDetail.tabs.people',   'People'),   icon: Users },
    { key: 'activity', label: t('platform.gymDetail.tabs.activity', 'Activity'), icon: Dumbbell },
    { key: 'content',  label: t('platform.gymDetail.tabs.content',  'Content'),  icon: Trophy },
    { key: 'settings', label: t('platform.gymDetail.tabs.settings', 'Settings'), icon: Settings },
  ];

  // A4: which failed sections feed the ACTIVE tab (overview consumes nearly
  // everything; wellness fetches its own data). The banner renders above the
  // tab content because the tab components themselves aren't owned here.
  const TAB_SECTIONS = {
    overview: ['members', 'activity', 'invites', 'challenges', 'programs', 'achievements'],
    wellness: [],
    people: ['members', 'invites'],
    activity: ['activity'],
    content: ['challenges', 'programs', 'achievements'],
    settings: ['members', 'invites'],
  };
  const failedSections = (TAB_SECTIONS[tab] ?? []).filter(k => loadErrors[k]);

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
        {/* Header */}
        <div className="mb-6">
          <button onClick={() => navigate('/platform')} className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#9CA3AF] text-sm mb-4 transition-colors"><ArrowLeft className="w-4 h-4" />{t('platform.gymDetail.backToPlatform', 'Back to Platform')}</button>
          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {logoUrl ? (
                <img src={logoUrl} alt={gym.name} className="w-12 h-12 rounded-xl object-contain flex-shrink-0 border border-white/6" style={{ background: '#111827' }} />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 border border-[#D4AF37]/20">
                  <span className="text-[18px] font-bold text-[#D4AF37]">{(gym.name || 'G')[0]}</span>
                </div>
              )}
              <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">{gym.name}</h1>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${gymStatus === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : gymStatus === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{t(`platform.gymDetail.gymStatus.${gymStatus}`)}</span>
              </div>
              <p className="text-[#6B7280] text-xs mt-1 font-mono">/{gym.slug}</p>
            </div></div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <button onClick={() => setEditingTier(!editingTier)} className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/20 transition-colors"><Crown className="w-3.5 h-3.5" />{(gym.plan_type ?? gym.subscription_tier ?? 'free').toUpperCase()}<ChevronDown className="w-3 h-3" /></button>
                {editingTier && (<div className="absolute right-0 top-full mt-1 bg-[#111827] border border-white/8 rounded-lg shadow-xl z-20 py-1 min-w-[120px]">{TIER_OPTIONS.map(tierOpt => (<button key={tierOpt} onClick={() => updateTier(tierOpt)} className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-white/6 transition-colors ${(gym.plan_type ?? gym.subscription_tier) === tierOpt ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>{tierOpt.toUpperCase()}</button>))}</div>)}
              </div>
              {gymStatus === 'active' ? (
                <button onClick={() => setLifecycleModal('pause')} className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-amber-500/20 hover:bg-amber-500/10 text-amber-400 transition-colors"><Pause className="w-4 h-4" />{t('platform.gymDetail.lifecycle.pauseBtn')}</button>
              ) : (
                <button onClick={() => setLifecycleModal('reactivate')} className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/10 text-emerald-400 transition-colors"><Play className="w-4 h-4" />{t('platform.gymDetail.lifecycle.reactivateBtn')}</button>
              )}
              {/* Impersonate: open this gym's admin experience (read via super_admin
                  RLS; the AdminLayout banner shows the active impersonation + exit). */}
              <button
                onClick={async () => { const ok = await impersonateGym(gymId); if (ok) navigate('/admin'); else notify(t('platform.gymDetail.impersonateFailed', 'Could not open the admin view'), 'error'); }}
                className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[#D4AF37]/20 hover:bg-[#D4AF37]/10 text-[#D4AF37] transition-colors"
              >
                <Eye className="w-4 h-4" />{t('platform.gymDetail.viewAsAdmin', 'View as admin')}
              </button>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: t('platform.gymDetail.stats.totalMembers',      'Total Members'),       value: stats.totalMembers,  icon: Users },
            { label: t('platform.gymDetail.stats.active30d',         'Active (30d)'),         value: stats.activeMembers, icon: Activity },
            { label: t('platform.gymDetail.stats.sessions30d',       'Sessions (30d)'),       value: stats.recentSessions, icon: Dumbbell },
            { label: t('platform.gymDetail.stats.avgSessionsMember', 'Avg Sessions/Member'),  value: stats.avgSessions,   icon: Clock },
          ].map(s => (
            <div key={s.label} className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-2"><s.icon className="w-4 h-4 text-[#D4AF37] flex-shrink-0" /><span className="text-[11px] text-[#6B7280] font-medium truncate">{s.label}</span></div>
              <p className="text-[24px] font-bold text-[#E5E7EB] truncate">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Import / Diagnostic actions — onboarding workflow for new gyms.
            Import accepts a hand-cleaned CSV of the gym's historical roster
            (super-admin only, per RPC gate). Diagnostic runs the 5-chart
            retention analysis on imported + live data. Both routes live
            outside the tab system because they're vendor-onboarding tools,
            not daily-operational views. */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <button
            onClick={() => navigate(`/platform/gym/${gymId}/import`)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12px] font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors"
          >
            <Upload size={13} />
            Import CSV
          </button>
          <button
            onClick={() => navigate(`/platform/gym/${gymId}/diagnostic`)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12px] font-semibold bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 transition-colors"
          >
            <Microscope size={13} />
            Retention diagnostic
          </button>
          <button
            onClick={() => navigate(`/platform/gym/${gymId}/ops`)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12px] font-semibold bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/20 transition-colors"
          >
            <Database size={13} />
            Data &amp; costs
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/6 mb-6 overflow-x-auto scrollbar-hide">
          {tabs.map(tabItem => (
            <button key={tabItem.key} onClick={() => setTab(tabItem.key)} className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${tab === tabItem.key ? 'bg-white/[0.03] text-[#D4AF37] border-b-2 border-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF]'}`}>
              <tabItem.icon className="w-4 h-4" /><span className="hidden sm:inline">{tabItem.label}</span>
            </button>
          ))}
        </div>

        {/* A4: failed reads used to render as believable empty states — when a
            section the active tab needs failed to load, say so honestly and
            offer a retry of just the failed fetches. */}
        {failedSections.length > 0 && (
          <div className="mb-6 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-2.5 flex-1 min-w-0">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-red-300">{t('platform.gymDetail.loadErrors.title', "Some data couldn't be loaded")}</p>
                <p className="text-[11px] text-red-300/70 mt-0.5">
                  {t('platform.gymDetail.loadErrors.body', 'Failed to load: {{sections}}. The lists below may be empty or stale.', { sections: failedSections.map(k => t(`platform.gymDetail.loadErrors.section.${k}`, k)).join(', ') })}
                </p>
              </div>
            </div>
            <button onClick={retryFailedLoads} disabled={retryingLoads} className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-red-500/15 text-red-300 border border-red-500/25 hover:bg-red-500/25 transition-colors disabled:opacity-50 flex-shrink-0">
              <RefreshCw className={`w-3.5 h-3.5 ${retryingLoads ? 'animate-spin' : ''}`} />
              {retryingLoads ? t('platform.gymDetail.loadErrors.retrying', 'Retrying...') : t('platform.gymDetail.loadErrors.retry', 'Retry')}
            </button>
          </div>
        )}

        {/* Tab content */}
        {tab === 'overview' && <GymOverviewTab gym={gym} branding={branding} logoUrl={logoUrl} stats={stats} checkIns={checkIns} challenges={challenges} programs={programs} achievements={achievements} invites={invites} members={members} gymId={gymId} setTab={setTab} setContentSubTab={setContentSubTab} />}
        {tab === 'wellness' && <GymWellnessTab gymId={gymId} statsRow={statsRow?.row} />}
        {tab === 'people' && <GymPeopleTab members={members} invites={invites} updateMemberRole={updateMemberRole} updateMemberStatus={updateMemberStatus} deleteMember={deleteMember} setShowAddMemberModal={setShowAddMemberModal} createInvite={createInvite} revokeInvite={revokeInvite} copyInviteCode={copyInviteCode} onSelectMember={setSelectedMember} />}
        {tab === 'activity' && <GymActivityTab sessions={sessions} checkIns={checkIns} gymId={gymId} />}
        {tab === 'content' && <GymContentTab challenges={challenges} programs={programs} achievements={achievements} rewardsAvailable={rewardsAvailable} getChallengeStatus={getChallengeStatus} setEditingChallenge={setEditingChallenge} setShowChallengeModal={setShowChallengeModal} setEditingProgram={setEditingProgram} setShowProgramModal={setShowProgramModal} toggleProgramPublish={toggleProgramPublish} setEditingAchievement={setEditingAchievement} setShowAchievementModal={setShowAchievementModal} setEditingReward={setEditingReward} setShowRewardModal={setShowRewardModal} toggleRewardActive={toggleRewardActive} setDeleteConfirm={setDeleteConfirm} initialSubTab={contentSubTab} />}
        {tab === 'settings' && <GymSettingsTab gym={gym} branding={branding} logoUrl={logoUrl} invites={invites} editingGym={editingGym} setEditingGym={setEditingGym} savingGym={savingGym} saveGymSettings={saveGymSettings} settingsError={settingsError} gymStatus={gymStatus} setLifecycleModal={setLifecycleModal} members={members} setGymOwner={setGymOwner} notify={notify} onBrandingSaved={(updates) => setBranding(prev => ({ ...(prev ?? { gym_id: gymId }), ...updates }))} t={t} />}
      </div>

      {/* Inline toast — fixed dark platform styling */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-[90vw] px-4 py-2.5 rounded-xl border text-[12px] font-medium shadow-2xl"
          style={{
            background: '#0F172A',
            borderColor: toast.type === 'error' ? 'rgba(239,68,68,0.45)' : 'rgba(16,185,129,0.45)',
            color: toast.type === 'error' ? '#FCA5A5' : '#6EE7B7',
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Modals */}
      {showChallengeModal && <ChallengeModal challenge={editingChallenge} onSave={saveChallenge} onClose={() => { setShowChallengeModal(false); setEditingChallenge(null); }} />}
      {showProgramModal && <ProgramModal program={editingProgram} onSave={saveProgram} onClose={() => { setShowProgramModal(false); setEditingProgram(null); }} />}
      {showAchievementModal && <AchievementModal achievement={editingAchievement} onSave={saveAchievement} onClose={() => { setShowAchievementModal(false); setEditingAchievement(null); }} />}
      {showRewardModal && <RewardModal reward={editingReward} onSave={saveReward} onClose={() => { setShowRewardModal(false); setEditingReward(null); }} />}
      {showAddMemberModal && <AddMemberModal gymId={gymId} onClose={() => setShowAddMemberModal(false)} onCreated={() => { setShowAddMemberModal(false); fetchMembers(); }} />}

      {/* P0-7: member detail — admin MemberDetail re-skinned to platform dark.
          onStatusChanged also fires on permanent delete ('deleted'), in which
          case MemberDetail calls onClose itself; we just refresh the roster. */}
      {selectedMember && (
        <PlatformMemberDetail
          key={selectedMember.id}
          member={selectedMember}
          gymId={gymId}
          onClose={() => setSelectedMember(null)}
          onNoteSaved={(id, note) => setMembers(prev => prev.map(m => m.id === id ? { ...m, admin_note: note } : m))}
          onStatusChanged={(id, status) => {
            if (status === 'deleted') {
              setMembers(prev => prev.filter(m => m.id !== id));
              setSelectedMember(null);
            } else {
              setMembers(prev => prev.map(m => m.id === id ? { ...m, membership_status: status } : m));
            }
          }}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => setDeleteConfirm(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDeleteConfirm(null); }} />
          <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-2">{t(`platform.gymDetail.deleteEntity.title.${deleteConfirm.type}`, t('platform.gymDetail.deleteEntity.titleFallback', { type: deleteConfirm.type, defaultValue: 'Delete {{type}}?' }))}</h3>
            <p className="text-[13px] text-[#6B7280] mb-6">{t('platform.gymDetail.deleteEntity.body', { name: deleteConfirm.name, defaultValue: 'Are you sure you want to delete {{name}}? This action cannot be undone.' })}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.lifecycle.cancel', 'Cancel')}</button>
              <button onClick={() => { if (deleteConfirm.type === 'challenge') deleteChallenge(deleteConfirm.id); else if (deleteConfirm.type === 'program') deleteProgram(deleteConfirm.id); else if (deleteConfirm.type === 'achievement') deleteAchievement(deleteConfirm.id); else if (deleteConfirm.type === 'reward') deleteReward(deleteConfirm.id); }} style={{ background: 'rgba(239,68,68,0.85)' }} className="px-4 py-2 text-[12px] font-semibold text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors">{t('platform.gymDetail.deleteEntity.confirm', 'Delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Gym Modal */}
      {lifecycleModal === 'pause' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => { setLifecycleModal(null); setPauseReason(''); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setLifecycleModal(null); setPauseReason(''); } }} />
          <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0"><Pause className="w-5 h-5 text-amber-400" /></div><div><h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.lifecycle.pauseTitle')}</h3><p className="text-[11px] text-[#6B7280]">{gym.name}</p></div></div>
            <div className="p-3 bg-amber-500/8 border border-amber-500/15 rounded-xl mb-4"><p className="text-[12px] text-amber-300">{t('platform.gymDetail.lifecycle.pauseWarning')}</p></div>
            <div className="mb-4"><label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">{t('platform.gymDetail.lifecycle.pauseReasonLabel')}</label><textarea value={pauseReason} onChange={e => setPauseReason(e.target.value)} placeholder={t('platform.gymDetail.lifecycle.pauseReasonPlaceholder')} rows={3} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-amber-400/40 resize-none" /></div>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setLifecycleModal(null); setPauseReason(''); }} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.lifecycle.cancel')}</button>
              <button onClick={handlePauseGym} disabled={lifecycleProcessing} className="px-4 py-2 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-50" style={{ background: '#f59e0b', color: '#000' }}>{lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmPause')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivate Gym Modal */}
      {lifecycleModal === 'reactivate' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => setLifecycleModal(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setLifecycleModal(null); }} />
          <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0"><Play className="w-5 h-5 text-emerald-400" /></div><div><h3 className="text-[15px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.lifecycle.reactivateTitle')}</h3><p className="text-[11px] text-[#6B7280]">{gym.name}</p></div></div>
            <div className="p-3 bg-emerald-500/8 border border-emerald-500/15 rounded-xl mb-4"><p className="text-[12px] text-emerald-300">{t('platform.gymDetail.lifecycle.reactivateWarning')}</p></div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setLifecycleModal(null)} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.lifecycle.cancel')}</button>
              <button onClick={handleReactivateGym} disabled={lifecycleProcessing} className="px-4 py-2 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-50" style={{ background: '#10b981', color: '#000' }}>{lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmReactivate')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Gym Modal — A3: honest copy (this flow never deletes;
          it pauses + cancels the plan and is fully reversible via Reactivate.
          Permanent deletion lives in GymOps / Data & costs). */}
      {lifecycleModal === 'delete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => { setLifecycleModal(null); setDeleteGymConfirmName(''); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setLifecycleModal(null); setDeleteGymConfirmName(''); } }} />
          <div className="relative bg-[#0F172A] border border-red-500/20 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0"><AlertTriangle className="w-5 h-5 text-red-400" /></div><div><h3 className="text-[15px] font-semibold text-red-400">{t('platform.gymDetail.lifecycle.deactivateTitle', 'Deactivate Gym')}</h3><p className="text-[11px] text-[#6B7280]">{gym.name}</p></div></div>
            <div className="p-3 bg-red-500/8 border border-red-500/15 rounded-xl mb-4"><p className="text-[12px] text-red-300">{t('platform.gymDetail.lifecycle.deactivateWarning', 'The gym is deactivated: all members lose app access and the plan is marked cancelled. This is reversible — use Reactivate to restore access. For permanent deletion of the gym and its data, use the Data & costs page.')}</p></div>
            <div className="mb-4"><label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">{t('platform.gymDetail.lifecycle.deleteConfirmLabel', { name: gym.name })}</label><input type="text" value={deleteGymConfirmName} onChange={e => setDeleteGymConfirmName(e.target.value)} placeholder={gym.name} aria-label="Type gym name to confirm deactivation" className="w-full bg-[#111827] border border-red-500/20 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-red-400/40" /></div>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setLifecycleModal(null); setDeleteGymConfirmName(''); }} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.lifecycle.cancel')}</button>
              <button onClick={handleDeleteGym} disabled={lifecycleProcessing || deleteGymConfirmName !== gym.name} style={{ background: 'rgba(239,68,68,0.85)' }} className="px-4 py-2 text-[12px] font-semibold text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmDeactivate', 'Deactivate Gym')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
