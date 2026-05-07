import { useState, useCallback } from 'react';
import { UserPlus, Copy, Check, Loader2, Share2, ScanLine, X, Users, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';
import PhoneInput from '../../../components/admin/PhoneInput';
import logger from '../../../lib/logger';
import { logAdminAction } from '../../../lib/adminAudit';
import posthog from 'posthog-js';
import useScanClaim from '../../../hooks/useScanClaim';
import { parseQRContent } from '../../../lib/scanRouter';

/**
 * CreateInviteModal — "Add Member" (Agregar Miembro)
 * Directly creates a member profile + generates a link code
 * so the member can set their password on first app open.
 */
export default function CreateInviteModal({ gymId, onClose, onCreated }) {
  const { t } = useTranslation('pages');
  const k = (key) => t(`admin.createInvite.${key}`);

  const [phase, setPhase] = useState('form'); // 'form' | 'result'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { profileId, code, name }
  const [copiedCode, setCopiedCode] = useState(false);

  // Referral linking
  const [referrerInfo, setReferrerInfo] = useState(null); // { id, name, avatarUrl, codeId }
  const [referralCode, setReferralCode] = useState('');
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralError, setReferralError] = useState(null);

  // Optional profile info (gym admin can fill on member's behalf)
  const [moreOpen, setMoreOpen] = useState(false);
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [fitnessLevel, setFitnessLevel] = useState('');
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [trainingDaysPerWeek, setTrainingDaysPerWeek] = useState('');
  const [externalId, setExternalId] = useState('');
  const [adminNote, setAdminNote] = useState('');

  // Generate a random 6-char alphanumeric code (excludes ambiguous chars)
  const generateCode = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    const array = new Uint8Array(6);
    crypto.getRandomValues(array);
    for (let i = 0; i < 6; i++) {
      code += chars[array[i] % chars.length];
    }
    return code;
  };

  // Handle scan input from physical scanner (claimed while modal is open)
  const handleReferralScan = useCallback(async (rawText) => {
    if (phase !== 'form') return;
    setReferralError(null);
    setReferralLoading(true);

    try {
      const trimmed = rawText.trim();
      const parsed = parseQRContent(trimmed);

      let referrerProfileId = null;
      let referralCodeId = null;

      if (parsed?.type === 'referral') {
        referrerProfileId = parsed.referrerId;
        const { data: codeRow } = await supabase
          .from('referral_codes')
          .select('id')
          .eq('profile_id', parsed.referrerId)
          .eq('gym_id', gymId)
          .single();
        referralCodeId = codeRow?.id;
      } else {
        const { data: codeRow } = await supabase
          .from('referral_codes')
          .select('id, profile_id')
          .eq('code', trimmed.toUpperCase())
          .eq('gym_id', gymId)
          .single();
        if (codeRow) {
          referrerProfileId = codeRow.profile_id;
          referralCodeId = codeRow.id;
        }
      }

      if (!referrerProfileId || !referralCodeId) {
        setReferralError(t('admin.createInvite.referralNotFound', 'Referral code not found'));
        setReferralLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('id', referrerProfileId)
        .single();

      if (!profile) {
        setReferralError(t('admin.createInvite.referrerNotFound', 'Referrer not found'));
        setReferralLoading(false);
        return;
      }

      setReferrerInfo({ id: profile.id, name: profile.full_name, avatarUrl: profile.avatar_url, codeId: referralCodeId });
      setReferralCode(trimmed);
    } catch (err) {
      logger.error('Referral scan error:', err);
      setReferralError(err.message);
    } finally {
      setReferralLoading(false);
    }
  }, [phase, gymId, t]);

  // Claim scanner while form phase is active
  useScanClaim(handleReferralScan, phase === 'form');

  const handleCreate = async () => {
    if (!name.trim() || !email.trim() || !phone.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const ageNum = age ? Math.max(0, Math.min(120, parseInt(age, 10))) : null;
      const heightInchesTotal = (heightFeet || heightInches)
        ? (parseInt(heightFeet || '0', 10) * 12) + parseInt(heightInches || '0', 10)
        : null;
      const weightNum = weightLbs ? Math.max(0, parseFloat(weightLbs)) : null;
      const trainingDays = trainingDaysPerWeek ? Math.max(1, Math.min(7, parseInt(trainingDaysPerWeek, 10))) : null;

      // 1. Create profile directly with optional info
      const profileInsert = {
        gym_id: gymId,
        full_name: name.trim(),
        email: email.trim().toLowerCase(),
        role: 'member',
        membership_status: 'active',
        is_onboarded: false,
      };
      if (ageNum !== null && !Number.isNaN(ageNum)) profileInsert.age = ageNum;
      if (sex) profileInsert.sex = sex;
      if (heightInchesTotal !== null && !Number.isNaN(heightInchesTotal) && heightInchesTotal > 0) profileInsert.height_inches = heightInchesTotal;
      if (weightNum !== null && !Number.isNaN(weightNum) && weightNum > 0) profileInsert.initial_weight_lbs = weightNum;
      if (fitnessLevel) profileInsert.fitness_level = fitnessLevel;
      if (primaryGoal) profileInsert.primary_goal = primaryGoal;
      if (trainingDays !== null && !Number.isNaN(trainingDays)) profileInsert.training_days_per_week = trainingDays;
      if (externalId.trim()) profileInsert.qr_external_id = externalId.trim();
      if (adminNote.trim()) profileInsert.admin_note = adminNote.trim();

      const { data: newProfile, error: profileError } = await supabase
        .from('profiles')
        .insert(profileInsert)
        .select('id')
        .single();

      if (profileError) throw profileError;

      // 2. Generate a link code and insert into gym_invites (marked as claimed)
      const linkCode = generateCode();

      const { data: { user } } = await supabase.auth.getUser();

      const { error: inviteError } = await supabase
        .from('gym_invites')
        .insert({
          gym_id: gymId,
          created_by: user.id,
          invite_code: linkCode,
          member_name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          role: 'member',
          used_by: newProfile.id,
          used_at: new Date().toISOString(),
          referral_code_id: referrerInfo?.codeId || null,
        });

      if (inviteError) throw inviteError;

      // 3. Log admin action
      logAdminAction('add_member', 'member', newProfile.id, {
        name: name.trim(),
        email: email.trim(),
        has_referral: !!referrerInfo,
      });
      posthog?.capture('admin_member_invited', { method: 'direct_add' });

      setResult({ profileId: newProfile.id, code: linkCode, name: name.trim() });
      setPhase('result');
      if (onCreated) onCreated();
    } catch (err) {
      logger.error('CreateInviteModal: create failed:', err);
      setError(err.message || k('somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (!result?.code) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      logger.error('Failed to copy code:', err);
    }
  };

  const handleShare = async () => {
    if (!result?.code) return;
    const shareText = `${k('shareText')} ${result.code}`;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: k('shareTitle'),
          text: shareText,
          dialogTitle: k('shareTitle'),
        });
      } else {
        if (navigator.share) {
          await navigator.share({
            title: k('shareTitle'),
            text: shareText,
          });
        } else {
          handleCopyCode();
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error('Share failed:', err);
      }
    }
  };

  const handleAddAnother = () => {
    setPhase('form');
    setName('');
    setEmail('');
    setPhone('');
    setResult(null);
    setError(null);
    setCopiedCode(false);
    setReferrerInfo(null);
    setReferralCode('');
    setReferralError(null);
    setMoreOpen(false);
    setAge('');
    setSex('');
    setHeightFeet('');
    setHeightInches('');
    setWeightLbs('');
    setFitnessLevel('');
    setPrimaryGoal('');
    setTrainingDaysPerWeek('');
    setExternalId('');
    setAdminNote('');
  };

  return (
    <AdminModal isOpen onClose={onClose} title={k('addMemberTitle') || k('title')} titleIcon={UserPlus} size="sm">
      {phase === 'form' ? (
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {k('memberName')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={k('memberNamePlaceholder')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{
                background: 'var(--color-bg-input, var(--color-bg-elevated))',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* Email (required) */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {k('email')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={k('emailPlaceholder')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{
                background: 'var(--color-bg-input, var(--color-bg-elevated))',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {k('phone')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              placeholder={k('phonePlaceholder')}
              ariaLabel={k('phone')}
            />
          </div>

          {/* Referral — scan or type */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.createInvite.referral', 'Referred by')}
            </label>
            {referrerInfo ? (
              <div
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                style={{
                  background: 'color-mix(in srgb, var(--color-success) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)',
                }}
              >
                {referrerInfo.avatarUrl ? (
                  <img src={referrerInfo.avatarUrl} alt={referrerInfo.name || 'Referrer avatar'} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: 'color-mix(in srgb, var(--color-success) 20%, transparent)' }}
                  >
                    <span className="text-[12px] font-bold" style={{ color: 'var(--color-success)' }}>
                      {referrerInfo.name?.[0]?.toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-success)' }}>{referrerInfo.name}</p>
                  <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('admin.createInvite.referralLinked', 'Referral will be linked')}
                  </p>
                </div>
                <button
                  onClick={() => { setReferrerInfo(null); setReferralCode(''); setReferralError(null); }}
                  aria-label={t('admin.createInvite.clearReferrer', 'Clear referrer')}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && referralCode.trim()) { e.preventDefault(); handleReferralScan(referralCode); } }}
                  placeholder={t('admin.createInvite.referralPlaceholder', 'Scan QR or type referral code')}
                  aria-label={t('admin.createInvite.referralPlaceholder', 'Scan QR or type referral code')}
                  className="w-full rounded-xl px-3 py-2.5 pr-10 text-[13px] outline-none transition-colors"
                  style={{
                    background: 'var(--color-bg-input, var(--color-bg-elevated))',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {referralLoading ? (
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                  ) : (
                    <ScanLine size={14} style={{ color: 'var(--color-text-subtle)' }} />
                  )}
                </div>
              </div>
            )}
            {referralError && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{referralError}</p>}
            {!referrerInfo && !referralError && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                {t('admin.createInvite.referralHint', "Scan a member's referral QR to link the referral automatically")}
              </p>
            )}
          </div>

          {/* More information toggle */}
          <button
            type="button"
            onClick={() => setMoreOpen(o => !o)}
            className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-[12px] font-semibold transition-colors"
            style={{
              background: 'var(--color-bg-input, var(--color-bg-elevated))',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-muted)',
            }}
          >
            <span>{t('admin.createInvite.moreInfo', 'More information (optional)')}</span>
            <ChevronDown size={14} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
          </button>

          {moreOpen && (
            <div className="space-y-3 pt-1">
              {/* External ID (gym keypad / membership #) */}
              <div>
                <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.createInvite.externalId', 'Gym membership ID (keypad / system code)')}
                </label>
                <input
                  type="text"
                  value={externalId}
                  onChange={e => setExternalId(e.target.value)}
                  placeholder={t('admin.createInvite.externalIdPlaceholder', 'e.g. 1234, A001')}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                  style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                />
              </div>

              {/* Age + Sex */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.createInvite.age', 'Age')}
                  </label>
                  <input
                    type="number"
                    value={age}
                    onChange={e => setAge(e.target.value)}
                    min="0" max="120"
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.createInvite.sex', 'Sex')}
                  </label>
                  <select
                    value={sex}
                    onChange={e => setSex(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                  >
                    <option value="">{t('admin.createInvite.selectOption', '—')}</option>
                    <option value="male">{t('admin.createInvite.male', 'Male')}</option>
                    <option value="female">{t('admin.createInvite.female', 'Female')}</option>
                    <option value="other">{t('admin.createInvite.other', 'Other')}</option>
                  </select>
                </div>
              </div>

              {/* Height + Weight */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.createInvite.heightFt', 'Height (ft)')}
                  </label>
                  <input type="number" value={heightFeet} onChange={e => setHeightFeet(e.target.value)} min="0" max="9"
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.createInvite.heightIn', 'Height (in)')}
                  </label>
                  <input type="number" value={heightInches} onChange={e => setHeightInches(e.target.value)} min="0" max="11"
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.createInvite.weightLbs', 'Weight (lbs)')}
                  </label>
                  <input type="number" value={weightLbs} onChange={e => setWeightLbs(e.target.value)} min="0" step="0.1"
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                </div>
              </div>

              {/* Fitness level + Goal */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.createInvite.fitnessLevel', 'Level')}
                  </label>
                  <select value={fitnessLevel} onChange={e => setFitnessLevel(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
                    <option value="">{t('admin.createInvite.selectOption', '—')}</option>
                    <option value="beginner">{t('admin.createInvite.lvlBeginner', 'Beginner')}</option>
                    <option value="intermediate">{t('admin.createInvite.lvlIntermediate', 'Intermediate')}</option>
                    <option value="advanced">{t('admin.createInvite.lvlAdvanced', 'Advanced')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.createInvite.primaryGoal', 'Goal')}
                  </label>
                  <select value={primaryGoal} onChange={e => setPrimaryGoal(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
                    <option value="">{t('admin.createInvite.selectOption', '—')}</option>
                    <option value="muscle_gain">{t('admin.createInvite.goalMuscle', 'Muscle gain')}</option>
                    <option value="fat_loss">{t('admin.createInvite.goalFat', 'Fat loss')}</option>
                    <option value="strength">{t('admin.createInvite.goalStrength', 'Strength')}</option>
                    <option value="endurance">{t('admin.createInvite.goalEndurance', 'Endurance')}</option>
                    <option value="general_fitness">{t('admin.createInvite.goalGeneral', 'General fitness')}</option>
                  </select>
                </div>
              </div>

              {/* Training frequency */}
              <div>
                <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.createInvite.trainingDays', 'Training days per week')}
                </label>
                <select value={trainingDaysPerWeek} onChange={e => setTrainingDaysPerWeek(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                  style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
                  <option value="">{t('admin.createInvite.selectOption', '—')}</option>
                  {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              {/* Admin note */}
              <div>
                <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.createInvite.adminNote', 'Admin notes (private)')}
                </label>
                <textarea
                  value={adminNote}
                  onChange={e => setAdminNote(e.target.value)}
                  rows={3}
                  placeholder={t('admin.createInvite.adminNotePlaceholder', 'Injuries, history, preferences…')}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors resize-none"
                  style={{ background: 'var(--color-bg-input, var(--color-bg-elevated))', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-[12px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}

          <button
            onClick={handleCreate}
            disabled={!name.trim() || !email.trim() || !phone.trim() || loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {k('creating')}
              </>
            ) : (
              <>
                <UserPlus size={14} />
                {k('addMember') || k('createInvite')}
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Success heading */}
          <div className="text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: 'color-mix(in srgb, var(--color-success) 12%, transparent)' }}
            >
              <Check size={24} style={{ color: 'var(--color-success)' }} />
            </div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--color-success)' }}>
              {k('memberCreated') || k('inviteCreated')}
            </p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {result?.name}
            </p>
          </div>

          {/* Prominent code display */}
          <div
            className="rounded-xl py-5 px-4 text-center overflow-hidden"
            style={{
              background: 'var(--color-bg-input, var(--color-bg-elevated))',
              border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
            }}
          >
            <p
              className="text-[32px] font-bold tracking-[0.25em] font-mono select-all"
              style={{ color: 'var(--color-accent)' }}
            >
              {result?.code}
            </p>
            <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-subtle)' }}>
              {k('linkCodeDescription') || t('admin.createInvite.linkCodeDescription', 'The member can use this code to set their password and access the app')}
            </p>
          </div>

          {/* Action buttons row */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCopyCode}
              className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-[11px] font-semibold transition-colors"
              style={copiedCode ? {
                background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                color: 'var(--color-success)',
                border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)',
              } : {
                background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-muted)',
              }}
            >
              {copiedCode ? <Check size={14} /> : <Copy size={14} />}
              {copiedCode ? k('copied') : k('copyCode')}
            </button>
            <button
              onClick={handleShare}
              className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-[11px] font-semibold transition-colors"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                color: 'var(--color-accent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
              }}
            >
              <Share2 size={14} />
              {k('share')}
            </button>
          </div>

          {/* Bottom actions */}
          <div className="flex gap-3">
            <button
              onClick={handleAddAnother}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{
                background: 'var(--color-bg-input, var(--color-bg-elevated))',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {k('addAnother')}
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                color: 'var(--color-accent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
              }}
            >
              {k('done')}
            </button>
          </div>
        </div>
      )}
    </AdminModal>
  );
}
