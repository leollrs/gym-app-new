import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, Eye, Lock, Download, Star, MessageSquare,
  Loader2, Check, AlertTriangle, Users,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { TT, TFont } from './components/designTokens';
import { TCard, TEyebrow, TPageTitle, TIconButton, TPrimaryButton } from './components/designPrimitives';

// eslint-disable-next-line no-unused-vars
function PrivacyToggleRow({ Icon, title, desc, value, onChange, disabled, isFirst }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '14px', minHeight: 64,
      borderTop: isFirst ? 'none' : `1px solid ${TT.border}`,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: TT.surface2, color: TT.textSub,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={15} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>{title}</div>
        <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        style={{
          flexShrink: 0, marginTop: 4,
          width: 44, height: 26, borderRadius: 999,
          background: value ? TT.accent : TT.surface2,
          border: `1px solid ${value ? TT.accent : TT.borderSolid}`,
          position: 'relative',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 160ms ease',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <div style={{
          position: 'absolute',
          top: 2, left: value ? 20 : 2,
          width: 20, height: 20, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          transition: 'left 160ms ease',
        }} />
      </button>
    </div>
  );
}

export default function TrainerPrivacy() {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const { profile, patchProfile } = useAuth();
  const { showToast } = useToast();

  const [publicProfile, setPublicProfile] = useState(profile?.privacy_public ?? false);
  // Default TRUE so existing trainers without the column (pre-migration) still
  // show up in the directory. Matches the DB default.
  const [directoryVisible, setDirectoryVisible] = useState(profile?.trainer_directory_visible ?? true);
  const [verified] = useState(profile?.trainer_verified ?? false);
  const [savingKey, setSavingKey] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setPublicProfile(profile?.privacy_public ?? false);
  }, [profile?.privacy_public]);

  useEffect(() => {
    setDirectoryVisible(profile?.trainer_directory_visible ?? true);
  }, [profile?.trainer_directory_visible]);

  // The shared `get_auth_context` RPC doesn't return privacy_public or
  // trainer_directory_visible, so `profile.*` from useAuth() is undefined
  // on cold load and the toggles would always paint with the fallback
  // value (false/true) instead of the saved DB state. Pull them directly
  // on mount and patch them into AuthContext so the rest of the app
  // (MyGym filter, PublicTrainerProfile gate) reads the right value too.
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('privacy_public, trainer_directory_visible')
        .eq('id', profile.id)
        .maybeSingle();
      if (cancelled || !data) return;
      if (typeof data.privacy_public === 'boolean') {
        setPublicProfile(data.privacy_public);
        if (data.privacy_public !== profile.privacy_public) {
          patchProfile({ privacy_public: data.privacy_public });
        }
      }
      if (typeof data.trainer_directory_visible === 'boolean') {
        setDirectoryVisible(data.trainer_directory_visible);
        if (data.trainer_directory_visible !== profile.trainer_directory_visible) {
          patchProfile({ trainer_directory_visible: data.trainer_directory_visible });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const updateField = async (column, nextValue) => {
    setSavingKey(column);
    const prev = profile?.[column];
    patchProfile({ [column]: nextValue });
    try {
      const { error } = await supabase.from('profiles').update({ [column]: nextValue }).eq('id', profile.id);
      if (error) throw error;
      // Don't call refreshProfile() here. The shared `get_auth_context` RPC
      // it relies on doesn't return privacy_public or trainer_directory_visible,
      // so refreshing wipes those fields off the in-memory profile and the
      // useEffect below snaps the toggle back to its fallback default. The
      // patchProfile() call above already reflects the new value locally and
      // the DB write succeeded — that's sufficient.
    } catch (err) {
      // Roll back optimistic update on failure
      patchProfile({ [column]: prev });
      if (column === 'privacy_public') setPublicProfile(prev);
      if (column === 'trainer_directory_visible') setDirectoryVisible(prev);
      showToast(err.message || t('pages:trainerPrivacy.saveFailed', 'Failed to save'), 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const [
        { data: profileRow },
        { data: reviews },
        { data: clients },
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', profile.id).single(),
        supabase.from('trainer_reviews').select('*').eq('trainer_id', profile.id),
        supabase.from('trainer_clients').select('*').eq('trainer_id', profile.id),
      ]);

      const payload = {
        exported_at: new Date().toISOString(),
        profile: profileRow,
        reviews_received: reviews ?? [],
        clients: clients ?? [],
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tugympr-trainer-${profile?.username || profile?.id || 'export'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(t('pages:trainerPrivacy.exportDone', 'Export downloaded.'), 'success');
    } catch (err) {
      showToast(err.message || t('pages:trainerPrivacy.exportFailed', 'Export failed.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ background: TT.bg, minHeight: '100%', paddingBottom: 100 }}>
      {/* Header */}
      <div className="max-w-3xl mx-auto" style={{ padding: '12px 16px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <TIconButton ariaLabel={t('common:back', 'Back')} onClick={() => navigate(-1)} size={36}>
          <ChevronLeft size={18} color={TT.text} />
        </TIconButton>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TEyebrow>{t('pages:trainerSettings.title', 'Settings')}</TEyebrow>
          <TPageTitle style={{ fontSize: 24 }}>
            {t('pages:trainerPrivacy.title', 'Privacy')}
          </TPageTitle>
        </div>
      </div>

      {/* Verified info */}
      {verified && (
        <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
          <TCard padded={14} style={{ background: TT.goodSoft, borderColor: 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 999,
                background: TT.good, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Check size={16} strokeWidth={3} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: TT.goodInk }}>
                  {t('pages:trainerPrivacy.verifiedTitle', 'Verified trainer')}
                </div>
                <div style={{ fontSize: 11.5, color: TT.goodInk, opacity: 0.8, marginTop: 2 }}>
                  {t('pages:trainerPrivacy.verifiedBody', 'Your credentials have been reviewed by your gym admin.')}
                </div>
              </div>
            </div>
          </TCard>
        </div>
      )}

      {/* Profile visibility */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerPrivacy.visibility', 'Visibility')}
        </div>
        <TCard padded={0}>
          <PrivacyToggleRow
            isFirst
            Icon={Users}
            title={t('pages:trainerPrivacy.directoryListing', 'Show in gym trainer directory')}
            desc={t('pages:trainerPrivacy.directoryListingDesc', 'Appear in the "Trainers" list on your gym page so any member can find you. When off, only your active clients can reach your profile.')}
            value={directoryVisible}
            disabled={savingKey === 'trainer_directory_visible'}
            onChange={(v) => { setDirectoryVisible(v); updateField('trainer_directory_visible', v); }}
          />
          <PrivacyToggleRow
            Icon={Eye}
            title={t('pages:trainerPrivacy.publicProfile', 'Public profile')}
            desc={t('pages:trainerPrivacy.publicProfileDesc', 'Allow anyone in your gym to view your trainer profile, services, and reviews.')}
            value={publicProfile}
            disabled={savingKey === 'privacy_public'}
            onChange={(v) => { setPublicProfile(v); updateField('privacy_public', v); }}
          />
        </TCard>
        <div style={{
          marginTop: 8, padding: 10, borderRadius: 10,
          background: TT.surface2, border: `1px solid ${TT.border}`,
          fontSize: 11.5, color: TT.textSub, lineHeight: 1.5,
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <Lock size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {t('pages:trainerPrivacy.note',
              'Your assigned clients can always view your profile regardless of this setting.')}
          </span>
        </div>
      </div>

      {/* Reviews & contact (informational; toggles when those flows ship) */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerPrivacy.reviews', 'Reviews & contact')}
        </div>
        <TCard padded={0}>
          <PrivacyToggleRow
            isFirst
            Icon={Star}
            title={t('pages:trainerPrivacy.acceptReviews', 'Accept client reviews')}
            desc={t('pages:trainerPrivacy.acceptReviewsDesc', 'Active clients can leave a 1–5 star review on your public profile. Reviews are visible to everyone in your gym.')}
            value={true}
            disabled
            onChange={() => {}}
          />
          <PrivacyToggleRow
            Icon={MessageSquare}
            title={t('pages:trainerPrivacy.directMessages', 'Direct messages from members')}
            desc={t('pages:trainerPrivacy.directMessagesDesc', 'Members in your gym can message you. You can mute individual conversations from the chat.')}
            value={true}
            disabled
            onChange={() => {}}
          />
        </TCard>
      </div>

      {/* Data */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerPrivacy.data', 'Your data')}
        </div>
        <TCard padded={14}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9, flexShrink: 0,
              background: TT.surface2, color: TT.textSub,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Download size={15} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>
                {t('pages:trainerPrivacy.exportTitle', 'Export your data')}
              </div>
              <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 2, lineHeight: 1.4 }}>
                {t('pages:trainerPrivacy.exportDesc', 'Download a JSON file with your profile, reviews received, and client roster.')}
              </div>
            </div>
          </div>
          <TPrimaryButton onClick={exportData} disabled={exporting} style={{ width: '100%' }}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} strokeWidth={2.4} />}
            {exporting
              ? t('pages:trainerPrivacy.exporting', 'Preparing…')
              : t('pages:trainerPrivacy.exportBtn', 'Download data')}
          </TPrimaryButton>
        </TCard>
      </div>

      {/* Legal links */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 24px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerPrivacy.legal', 'Legal')}
        </div>
        <TCard padded={0}>
          {[
            { label: t('pages:trainerPrivacy.privacyPolicy', 'Privacy policy'), href: '/legal/privacy' },
            { label: t('pages:trainerPrivacy.terms', 'Terms of service'), href: '/legal/terms' },
            { label: t('pages:trainerPrivacy.dataProcessing', 'Data processing'), href: '/legal/dpa' },
          ].map((row, i) => (
            <button
              key={i}
              type="button"
              onClick={() => navigate(row.href)}
              style={{
                width: '100%', padding: '14px',
                background: 'transparent', border: 'none',
                borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: TT.text,
              }}
            >
              {row.label}
              <AlertTriangle size={0} aria-hidden="true" /> {/* spacer to keep alignment */}
              <span style={{ color: TT.textMute, fontSize: 12 }}>→</span>
            </button>
          ))}
        </TCard>
      </div>
    </div>
  );
}
