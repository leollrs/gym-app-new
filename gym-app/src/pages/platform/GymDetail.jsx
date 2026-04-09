import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Activity, Settings, Crown, ChevronDown,
  Dumbbell, Clock, Pause, Play, X, Trash2,
  UserPlus, Eye, EyeOff, AlertTriangle,
  Trophy,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import logger from '../../lib/logger';
import { logAdminAction } from '../../lib/adminAudit';
import { subDays } from 'date-fns';

import GymOverviewTab from './gym-detail/GymOverviewTab';
import GymPeopleTab from './gym-detail/GymPeopleTab';
import GymActivityTab from './gym-detail/GymActivityTab';
import GymContentTab from './gym-detail/GymContentTab';
import GymSettingsTab from './gym-detail/GymSettingsTab';

// ── Constants ──────────────────────────────────────────────────
const TIER_OPTIONS = ['free', 'starter', 'pro', 'enterprise'];
const CHALLENGE_TYPES = ['consistency', 'volume', 'pr', 'team'];
const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'];

// ── Challenge Modal Component ─────────────────────────────────
function ChallengeModal({ challenge, onSave, onClose }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    title: challenge?.title ?? '',
    type: challenge?.type ?? 'consistency',
    description: challenge?.description ?? '',
    start_date: challenge?.start_date ? challenge.start_date.slice(0, 10) : '',
    end_date: challenge?.end_date ? challenge.end_date.slice(0, 10) : '',
    scoring_method: challenge?.scoring_method ?? '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    await onSave({
      title: form.title.trim(),
      type: form.type,
      description: form.description.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      scoring_method: form.scoring_method.trim() || null,
    });
    setSaving(false);
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
            <input type="text" value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder={t('platform.gymDetail.modals.titlePlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.typeLabel')}</label>
            <select value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer">
              {CHALLENGE_TYPES.map(ct => (<option key={ct} value={ct}>{ct.charAt(0).toUpperCase() + ct.slice(1)}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.descriptionLabel')}</label>
            <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder={t('platform.gymDetail.modals.descriptionPlaceholder')} rows={3} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.startDate')}</label>
              <input type="date" value={form.start_date} onChange={e => setForm(prev => ({ ...prev, start_date: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.endDate')}</label>
              <input type="date" value={form.end_date} onChange={e => setForm(prev => ({ ...prev, end_date: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.scoringMethod')}</label>
            <input type="text" value={form.scoring_method} onChange={e => setForm(prev => ({ ...prev, scoring_method: e.target.value }))} placeholder={t('platform.gymDetail.modals.scoringPlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.modals.cancel')}</button>
            <button type="submit" disabled={saving} className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50">{saving ? t('platform.gymDetail.modals.saving') : challenge ? t('platform.gymDetail.modals.update') : t('platform.gymDetail.modals.create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Program Modal Component ───────────────────────────────────
function ProgramModal({ program, onSave, onClose }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: program?.name ?? '',
    description: program?.description ?? '',
    difficulty_level: program?.difficulty_level ?? 'beginner',
    duration_weeks: program?.duration_weeks ?? '',
    is_published: program?.is_published ?? false,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      difficulty_level: form.difficulty_level,
      duration_weeks: form.duration_weeks ? parseInt(form.duration_weeks, 10) : null,
      is_published: form.is_published,
    });
    setSaving(false);
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.difficulty')}</label>
              <select value={form.difficulty_level} onChange={e => setForm(prev => ({ ...prev, difficulty_level: e.target.value }))} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 cursor-pointer">
                {DIFFICULTY_LEVELS.map(d => (<option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.durationWeeks')}</label>
              <input type="number" value={form.duration_weeks} onChange={e => setForm(prev => ({ ...prev, duration_weeks: e.target.value }))} placeholder="e.g., 8" min="1" className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_published" checked={form.is_published} onChange={e => setForm(prev => ({ ...prev, is_published: e.target.checked }))} className="accent-[#D4AF37]" />
            <label htmlFor="is_published" className="text-[12px] text-[#9CA3AF]">{t('platform.gymDetail.modals.publishImmediately')}</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.modals.cancel')}</button>
            <button type="submit" disabled={saving} className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50">{saving ? t('platform.gymDetail.modals.saving') : program ? t('platform.gymDetail.modals.update') : t('platform.gymDetail.modals.create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Achievement Modal Component ───────────────────────────────
function AchievementModal({ achievement, onSave, onClose }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({ name: achievement?.name ?? '', description: achievement?.description ?? '', type: achievement?.type ?? '', requirement_value: achievement?.requirement_value ?? '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave({ name: form.name.trim(), description: form.description.trim() || null, type: form.type.trim() || null, requirement_value: form.requirement_value !== '' ? Number(form.requirement_value) : null });
    setSaving(false);
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
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.descriptionLabel')}</label>
            <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder={t('platform.gymDetail.modals.achievementDescPlaceholder')} rows={3} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.achievementType')}</label>
              <input type="text" value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))} placeholder={t('platform.gymDetail.modals.achievementTypePlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.requirementValue')}</label>
              <input type="number" value={form.requirement_value} onChange={e => setForm(prev => ({ ...prev, requirement_value: e.target.value }))} placeholder="e.g., 30" className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.modals.cancel')}</button>
            <button type="submit" disabled={saving} className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50">{saving ? t('platform.gymDetail.modals.saving') : achievement ? t('platform.gymDetail.modals.update') : t('platform.gymDetail.modals.create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Member Modal Component ────────────────────────────────
function AddMemberModal({ gymId, onClose, onCreated }) {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({ email: '', password: '', fullName: '', username: '', role: 'member' });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.email.trim() || !form.password || !form.fullName.trim() || !form.username.trim()) { setError(t('platform.gymDetail.modals.allFieldsRequired')); return; }
    if (form.password.length < 8 || !/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/[0-9]/.test(form.password)) { setError(t('platform.gymDetail.modals.passwordRequirements')); return; }
    setSaving(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_create_gym_member', { p_email: form.email.trim(), p_password: form.password, p_full_name: form.fullName.trim(), p_username: form.username.trim().toLowerCase(), p_gym_id: gymId, p_role: form.role });
      if (rpcErr) { setError(rpcErr.message || 'Failed to create member'); setSaving(false); return; }
      onCreated();
    } catch (err) { setError(err.message || 'Failed to create member'); setSaving(false); }
  };

  const autoUsername = (val) => {
    setForm(prev => ({ ...prev, fullName: val, username: prev.username || val.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) }));
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
          <div>
            <label className="block text-[11px] text-[#6B7280] font-medium mb-1">{t('platform.gymDetail.modals.fullName')}</label>
            <input type="text" value={form.fullName} onChange={e => autoUsername(e.target.value)} placeholder={t('platform.gymDetail.modals.fullNamePlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required />
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
              <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} placeholder={t('platform.gymDetail.modals.passwordPlaceholder')} className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 pr-9 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" required minLength={6} />
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
            <button type="submit" disabled={saving} className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50">{saving ? t('platform.gymDetail.modals.creating') : t('platform.gymDetail.modals.createMember')}</button>
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
  const { profile } = useAuth();
  const { t } = useTranslation('pages');

  const [gym, setGym] = useState(null);
  const [branding, setBranding] = useState(null);
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
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [lifecycleModal, setLifecycleModal] = useState(null);
  const [pauseReason, setPauseReason] = useState('');
  const [deleteGymConfirmName, setDeleteGymConfirmName] = useState('');
  const [lifecycleProcessing, setLifecycleProcessing] = useState(false);

  // ── Data fetching ─────────────────────────────────────────
  const fetchGym = async () => {
    const { data } = await supabase.from('gyms').select('*').eq('id', gymId).single();
    if (data) {
      setGym(data);
      setEditingGym({ name: data.name, slug: data.slug, qr_enabled: data.qr_enabled ?? false, qr_payload_type: data.qr_payload_type ?? 'auto_id', qr_display_format: data.qr_display_format ?? 'qr_code', qr_payload_template: data.qr_payload_template ?? '', classes_enabled: data.classes_enabled ?? false, multi_admin_enabled: data.multi_admin_enabled ?? false, max_admin_seats: data.max_admin_seats ?? 1, sms_phone_number: data.sms_phone_number ?? '' });
    }
    const { data: b } = await supabase.from('gym_branding').select('*').eq('gym_id', gymId).maybeSingle();
    setBranding(b);
  };
  const fetchMembers = async () => { const { data } = await supabase.from('profiles').select('id, full_name, username, role, created_at, last_active_at, membership_status').eq('gym_id', gymId).order('created_at', { ascending: false }); setMembers(data ?? []); };
  const fetchActivity = async () => { const { data: sess } = await supabase.from('workout_sessions').select('id, profile_id, status, started_at, total_volume_lbs, profiles(full_name)').eq('gym_id', gymId).order('started_at', { ascending: false }).limit(20); setSessions(sess ?? []); const { data: ci } = await supabase.from('check_ins').select('id, profile_id, checked_in_at, profiles(full_name)').eq('gym_id', gymId).order('checked_in_at', { ascending: false }).limit(20); setCheckIns(ci ?? []); };
  const fetchInvites = async () => { const { data } = await supabase.from('gym_invites').select('*').eq('gym_id', gymId).order('expires_at', { ascending: false }); setInvites(data ?? []); };
  const fetchChallenges = async () => { const { data } = await supabase.from('challenges').select('*, challenge_participants(id)').eq('gym_id', gymId).order('start_date', { ascending: false }); setChallenges(data ?? []); };
  const fetchPrograms = async () => { const { data } = await supabase.from('gym_programs').select('*').eq('gym_id', gymId).order('created_at', { ascending: false }); setPrograms(data ?? []); };
  const fetchAchievements = async () => { const { data } = await supabase.from('achievement_definitions').select('*, user_achievements(id)').eq('gym_id', gymId).order('created_at', { ascending: false }); setAchievements(data ?? []); };
  const fetchRewards = async () => { try { const { data, error } = await supabase.from('reward_points').select('*').eq('gym_id', gymId).order('created_at', { ascending: false }); if (error) { setRewardsAvailable(false); } else { setRewardsAvailable(data ?? []); } } catch { setRewardsAvailable(false); } };

  useEffect(() => { const load = async () => { setLoading(true); await Promise.all([fetchGym(), fetchMembers(), fetchActivity(), fetchInvites(), fetchChallenges(), fetchPrograms(), fetchAchievements(), fetchRewards()]); setLoading(false); }; load(); }, [gymId]);

  const stats = useMemo(() => { const thirtyDaysAgo = subDays(new Date(), 30).toISOString(); const totalMembers = members.length; const activeMembers = members.filter(m => m.last_active_at && m.last_active_at >= thirtyDaysAgo).length; const recentSessions = sessions.filter(s => s.started_at >= thirtyDaysAgo).length; const avgSessions = activeMembers > 0 ? (recentSessions / activeMembers).toFixed(1) : '0'; return { totalMembers, activeMembers, recentSessions, avgSessions }; }, [members, sessions]);
  const gymStatus = !gym?.is_active && gym?.subscription_tier === 'cancelled' ? 'deactivated' : !gym?.is_active ? 'paused' : 'active';

  // ── Actions ───────────────────────────────────────────────
  const handlePauseGym = async () => { if (!gym || lifecycleProcessing) return; setLifecycleProcessing(true); const { error } = await supabase.rpc('pause_gym', { p_gym_id: gymId }); if (!error) { logAdminAction('pause_gym', 'gym', gymId, { gym_name: gym.name, reason: pauseReason || null }); setGym(prev => ({ ...prev, is_active: false })); await fetchMembers(); } else { logger.error('Failed to pause gym:', error); } setLifecycleProcessing(false); setLifecycleModal(null); setPauseReason(''); };
  const handleReactivateGym = async () => { if (!gym || lifecycleProcessing) return; setLifecycleProcessing(true); const { error } = await supabase.rpc('unpause_gym', { p_gym_id: gymId }); if (!error) { const updates = { is_active: true, ...(gym.subscription_tier === 'cancelled' ? { subscription_tier: 'free' } : {}) }; logAdminAction('reactivate_gym', 'gym', gymId, { gym_name: gym.name }); setGym(prev => ({ ...prev, ...updates })); await fetchMembers(); } else { logger.error('Failed to reactivate gym:', error); } setLifecycleProcessing(false); setLifecycleModal(null); };
  const handleDeleteGym = async () => { if (!gym || lifecycleProcessing) return; if (deleteGymConfirmName !== gym.name) return; setLifecycleProcessing(true); const { error: gymErr } = await supabase.from('gyms').update({ is_active: false, subscription_tier: 'cancelled' }).eq('id', gymId); if (!gymErr) { const { error: profilesErr } = await supabase.from('profiles').update({ membership_status: 'deactivated' }).eq('gym_id', gymId).neq('role', 'super_admin'); if (profilesErr) logger.error('Failed to update member statuses:', profilesErr); logAdminAction('permanently_deactivate_gym', 'gym', gymId, { gym_name: gym.name }); setGym(prev => ({ ...prev, is_active: false, subscription_tier: 'cancelled' })); await fetchMembers(); } setLifecycleProcessing(false); setLifecycleModal(null); setDeleteGymConfirmName(''); };
  const updateTier = async (tier) => { const { error } = await supabase.from('gyms').update({ subscription_tier: tier }).eq('id', gymId); if (!error) { setGym(prev => ({ ...prev, subscription_tier: tier })); setEditingTier(false); } };
  const updateMemberRole = async (profileId, newRole) => { const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', profileId); if (!error) setMembers(prev => prev.map(m => m.id === profileId ? { ...m, role: newRole } : m)); };
  const updateMemberStatus = async (profileId, newStatus) => { const { error } = await supabase.from('profiles').update({ membership_status: newStatus }).eq('id', profileId); if (!error) setMembers(prev => prev.map(m => m.id === profileId ? { ...m, membership_status: newStatus } : m)); };
  const deleteMember = async (member) => { if (!window.confirm(t('platform.gymDetail.deleteMember.confirm', { name: member.full_name ?? member.username }))) return; const { error } = await supabase.rpc('admin_delete_gym_member', { p_user_id: member.id }); if (error) { alert(t('platform.gymDetail.deleteMember.failed', { error: error.message })); } else { setMembers(prev => prev.filter(m => m.id !== member.id)); } };
  const saveGymSettings = async () => { setSavingGym(true); const updates = { name: editingGym.name, slug: editingGym.slug, qr_enabled: editingGym.qr_enabled, qr_payload_type: editingGym.qr_payload_type, qr_display_format: editingGym.qr_display_format, qr_payload_template: editingGym.qr_payload_template || null, classes_enabled: editingGym.classes_enabled, multi_admin_enabled: editingGym.multi_admin_enabled, max_admin_seats: editingGym.max_admin_seats, sms_phone_number: editingGym.sms_phone_number || null }; const { error } = await supabase.from('gyms').update(updates).eq('id', gymId); if (!error) setGym(prev => ({ ...prev, ...updates })); setSavingGym(false); };

  // ── Content CRUD ──────────────────────────────────────────
  const saveChallenge = async (formData) => { if (editingChallenge?.id) { const { error } = await supabase.from('challenges').update(formData).eq('id', editingChallenge.id); if (!error) await fetchChallenges(); } else { const { error } = await supabase.from('challenges').insert({ ...formData, gym_id: gymId }); if (!error) await fetchChallenges(); } setShowChallengeModal(false); setEditingChallenge(null); };
  const deleteChallenge = async (challengeId) => { const { error } = await supabase.from('challenges').delete().eq('id', challengeId); if (!error) setChallenges(prev => prev.filter(c => c.id !== challengeId)); setDeleteConfirm(null); };
  const saveProgram = async (formData) => { if (editingProgram?.id) { const { error } = await supabase.from('gym_programs').update(formData).eq('id', editingProgram.id); if (!error) await fetchPrograms(); } else { const { error } = await supabase.from('gym_programs').insert({ ...formData, gym_id: gymId }); if (!error) await fetchPrograms(); } setShowProgramModal(false); setEditingProgram(null); };
  const toggleProgramPublish = async (prog) => { const { error } = await supabase.from('gym_programs').update({ is_published: !prog.is_published }).eq('id', prog.id); if (!error) setPrograms(prev => prev.map(p => p.id === prog.id ? { ...p, is_published: !p.is_published } : p)); };
  const deleteProgram = async (programId) => { const { error } = await supabase.from('gym_programs').delete().eq('id', programId); if (!error) setPrograms(prev => prev.filter(p => p.id !== programId)); setDeleteConfirm(null); };
  const saveAchievement = async (formData) => { if (editingAchievement?.id) { const { error } = await supabase.from('achievement_definitions').update(formData).eq('id', editingAchievement.id); if (!error) await fetchAchievements(); } else { const { error } = await supabase.from('achievement_definitions').insert({ ...formData, gym_id: gymId }); if (!error) await fetchAchievements(); } setShowAchievementModal(false); setEditingAchievement(null); };
  const deleteAchievement = async (achievementId) => { const { error } = await supabase.from('achievement_definitions').delete().eq('id', achievementId); if (!error) setAchievements(prev => prev.filter(a => a.id !== achievementId)); setDeleteConfirm(null); };
  const getChallengeStatus = (c) => { const now = new Date(); if (c.status) return c.status; if (c.end_date && new Date(c.end_date) < now) return 'ended'; if (c.start_date && new Date(c.start_date) > now) return 'upcoming'; return 'active'; };

  // ── Loading / not found ───────────────────────────────────
  if (loading) return (<div className="min-h-screen bg-[#05070B] flex items-center justify-center" aria-busy="true"><div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" role="status" aria-label="Loading gym details" /></div>);
  if (!gym) return (<div className="min-h-screen bg-[#05070B] flex flex-col items-center justify-center gap-4"><p className="text-[#9CA3AF] text-sm">Gym not found.</p><button onClick={() => navigate('/platform')} className="text-[#D4AF37] text-sm hover:underline">Back to Platform</button></div>);

  const tabs = [
    { key: 'overview', label: 'Overview', icon: Activity },
    { key: 'people', label: 'People', icon: Users },
    { key: 'activity', label: 'Activity', icon: Dumbbell },
    { key: 'content', label: 'Content', icon: Trophy },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
        {/* Header */}
        <div className="mb-6">
          <button onClick={() => navigate('/platform')} className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#9CA3AF] text-sm mb-4 transition-colors"><ArrowLeft className="w-4 h-4" />Back to Platform</button>
          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">{gym.name}</h1>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${gymStatus === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : gymStatus === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{t(`platform.gymDetail.gymStatus.${gymStatus}`)}</span>
              </div>
              <p className="text-[#6B7280] text-xs mt-1 font-mono">/{gym.slug}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <button onClick={() => setEditingTier(!editingTier)} className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/20 transition-colors"><Crown className="w-3.5 h-3.5" />{(gym.subscription_tier ?? 'free').toUpperCase()}<ChevronDown className="w-3 h-3" /></button>
                {editingTier && (<div className="absolute right-0 top-full mt-1 bg-[#111827] border border-white/8 rounded-lg shadow-xl z-20 py-1 min-w-[120px]">{TIER_OPTIONS.map(tierOpt => (<button key={tierOpt} onClick={() => updateTier(tierOpt)} className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-white/6 transition-colors ${gym.subscription_tier === tierOpt ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>{tierOpt.toUpperCase()}</button>))}</div>)}
              </div>
              {gymStatus === 'active' ? (
                <button onClick={() => setLifecycleModal('pause')} className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-amber-500/20 hover:bg-amber-500/10 text-amber-400 transition-colors"><Pause className="w-4 h-4" />{t('platform.gymDetail.lifecycle.pauseBtn')}</button>
              ) : (
                <button onClick={() => setLifecycleModal('reactivate')} className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/10 text-emerald-400 transition-colors"><Play className="w-4 h-4" />{t('platform.gymDetail.lifecycle.reactivateBtn')}</button>
              )}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Members', value: stats.totalMembers, icon: Users },
            { label: 'Active (30d)', value: stats.activeMembers, icon: Activity },
            { label: 'Sessions (30d)', value: stats.recentSessions, icon: Dumbbell },
            { label: 'Avg Sessions/Member', value: stats.avgSessions, icon: Clock },
          ].map(s => (
            <div key={s.label} className="bg-[#0F172A] border border-white/6 rounded-xl p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-2"><s.icon className="w-4 h-4 text-[#D4AF37] flex-shrink-0" /><span className="text-[11px] text-[#6B7280] font-medium truncate">{s.label}</span></div>
              <p className="text-[24px] font-bold text-[#E5E7EB] truncate">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/6 mb-6 overflow-x-auto scrollbar-hide">
          {tabs.map(tabItem => (
            <button key={tabItem.key} onClick={() => setTab(tabItem.key)} className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${tab === tabItem.key ? 'bg-white/[0.03] text-[#D4AF37] border-b-2 border-[#D4AF37]' : 'text-[#6B7280] hover:text-[#9CA3AF]'}`}>
              <tabItem.icon className="w-4 h-4" /><span className="hidden sm:inline">{tabItem.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && <GymOverviewTab gym={gym} branding={branding} stats={stats} checkIns={checkIns} challenges={challenges} programs={programs} achievements={achievements} invites={invites} members={members} gymId={gymId} setTab={setTab} setContentSubTab={setContentSubTab} />}
        {tab === 'people' && <GymPeopleTab members={members} invites={invites} updateMemberRole={updateMemberRole} updateMemberStatus={updateMemberStatus} deleteMember={deleteMember} setShowAddMemberModal={setShowAddMemberModal} />}
        {tab === 'activity' && <GymActivityTab sessions={sessions} checkIns={checkIns} />}
        {tab === 'content' && <GymContentTab challenges={challenges} programs={programs} achievements={achievements} rewardsAvailable={rewardsAvailable} getChallengeStatus={getChallengeStatus} setEditingChallenge={setEditingChallenge} setShowChallengeModal={setShowChallengeModal} setEditingProgram={setEditingProgram} setShowProgramModal={setShowProgramModal} toggleProgramPublish={toggleProgramPublish} setEditingAchievement={setEditingAchievement} setShowAchievementModal={setShowAchievementModal} setDeleteConfirm={setDeleteConfirm} initialSubTab={contentSubTab} />}
        {tab === 'settings' && <GymSettingsTab gym={gym} branding={branding} invites={invites} editingGym={editingGym} setEditingGym={setEditingGym} savingGym={savingGym} saveGymSettings={saveGymSettings} gymStatus={gymStatus} setLifecycleModal={setLifecycleModal} t={t} />}
      </div>

      {/* Modals */}
      {showChallengeModal && <ChallengeModal challenge={editingChallenge} onSave={saveChallenge} onClose={() => { setShowChallengeModal(false); setEditingChallenge(null); }} />}
      {showProgramModal && <ProgramModal program={editingProgram} onSave={saveProgram} onClose={() => { setShowProgramModal(false); setEditingProgram(null); }} />}
      {showAchievementModal && <AchievementModal achievement={editingAchievement} onSave={saveAchievement} onClose={() => { setShowAchievementModal(false); setEditingAchievement(null); }} />}
      {showAddMemberModal && <AddMemberModal gymId={gymId} onClose={() => setShowAddMemberModal(false)} onCreated={() => { setShowAddMemberModal(false); fetchMembers(); }} />}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => setDeleteConfirm(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDeleteConfirm(null); }} />
          <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-semibold text-[#E5E7EB] mb-2">Delete {deleteConfirm.type}?</h3>
            <p className="text-[13px] text-[#6B7280] mb-6">Are you sure you want to delete <span className="text-[#E5E7EB]">{deleteConfirm.name}</span>? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">Cancel</button>
              <button onClick={() => { if (deleteConfirm.type === 'challenge') deleteChallenge(deleteConfirm.id); else if (deleteConfirm.type === 'program') deleteProgram(deleteConfirm.id); else if (deleteConfirm.type === 'achievement') deleteAchievement(deleteConfirm.id); }} className="px-4 py-2 text-[12px] font-semibold text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors">Delete</button>
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
              <button onClick={handlePauseGym} disabled={lifecycleProcessing} className="px-4 py-2 text-[12px] font-semibold text-black bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors disabled:opacity-50">{lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmPause')}</button>
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
              <button onClick={handleReactivateGym} disabled={lifecycleProcessing} className="px-4 py-2 text-[12px] font-semibold text-black bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors disabled:opacity-50">{lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmReactivate')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Permanently Deactivate Gym Modal */}
      {lifecycleModal === 'delete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={0} aria-label="Close dialog" onClick={() => { setLifecycleModal(null); setDeleteGymConfirmName(''); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setLifecycleModal(null); setDeleteGymConfirmName(''); } }} />
          <div className="relative bg-[#0F172A] border border-red-500/20 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0"><AlertTriangle className="w-5 h-5 text-red-400" /></div><div><h3 className="text-[15px] font-semibold text-red-400">{t('platform.gymDetail.lifecycle.deleteTitle')}</h3><p className="text-[11px] text-[#6B7280]">{gym.name}</p></div></div>
            <div className="p-3 bg-red-500/8 border border-red-500/15 rounded-xl mb-4"><p className="text-[12px] text-red-300">{t('platform.gymDetail.lifecycle.deleteWarning')}</p></div>
            <div className="mb-4"><label className="block text-[11px] text-[#6B7280] font-medium mb-1.5">{t('platform.gymDetail.lifecycle.deleteConfirmLabel', { name: gym.name })}</label><input type="text" value={deleteGymConfirmName} onChange={e => setDeleteGymConfirmName(e.target.value)} placeholder={gym.name} aria-label="Type gym name to confirm deletion" className="w-full bg-[#111827] border border-red-500/20 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-red-400/40" /></div>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setLifecycleModal(null); setDeleteGymConfirmName(''); }} className="px-4 py-2 text-[12px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg border border-white/6 hover:bg-white/[0.03] transition-colors">{t('platform.gymDetail.lifecycle.cancel')}</button>
              <button onClick={handleDeleteGym} disabled={lifecycleProcessing || deleteGymConfirmName !== gym.name} className="px-4 py-2 text-[12px] font-semibold text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{lifecycleProcessing ? t('platform.gymDetail.lifecycle.processing') : t('platform.gymDetail.lifecycle.confirmDelete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
