import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, Lock, Download,
  Loader2, Check, Users, UserX, Camera,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import { TT, TFont, avatarIdx } from './components/designTokens';
import { TCard, TEyebrow, TPageTitle, TIconButton, TPrimaryButton, TAvatar } from './components/designPrimitives';

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
  const { t, i18n } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const { profile, patchProfile } = useAuth();
  const { showToast } = useToast();

  // Default TRUE so existing trainers without the column (pre-migration) still
  // show up in the directory. Matches the DB default.
  const [directoryVisible, setDirectoryVisible] = useState(profile?.trainer_directory_visible ?? true);
  // Photo visibility (0553): whether the gym (members) see the trainer's
  // uploaded photo, or just the initials/design avatar. Default TRUE = DB default.
  const [photoVisible, setPhotoVisible] = useState(profile?.trainer_photo_visible ?? true);
  const [verified] = useState(profile?.trainer_verified ?? false);
  const [savingKey, setSavingKey] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Blocked users (blocked from chats; this is the only unblock surface
  // on the trainer side — mirrors the member Settings → Privacy list).
  const [blockedList, setBlockedList] = useState([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [blockedError, setBlockedError] = useState(false);
  const [unblockingId, setUnblockingId] = useState(null);

  useEffect(() => {
    setDirectoryVisible(profile?.trainer_directory_visible ?? true);
  }, [profile?.trainer_directory_visible]);
  useEffect(() => {
    setPhotoVisible(profile?.trainer_photo_visible ?? true);
  }, [profile?.trainer_photo_visible]);

  // The shared `get_auth_context` RPC doesn't return
  // trainer_directory_visible, so `profile.*` from useAuth() is undefined
  // on cold load and the toggle would always paint with the fallback
  // value (true) instead of the saved DB state. Pull it directly
  // on mount and patch it into AuthContext so the rest of the app
  // (MyGym filter, PublicTrainerProfile gate) reads the right value too.
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      // Resilient pre-0553: retry without the new column if it's missing.
      let { data, error } = await supabase
        .from('profiles')
        .select('trainer_directory_visible, trainer_photo_visible')
        .eq('id', profile.id)
        .maybeSingle();
      if (error && (error.code === '42703' || error.code === 'PGRST204')) {
        ({ data } = await supabase
          .from('profiles')
          .select('trainer_directory_visible')
          .eq('id', profile.id)
          .maybeSingle());
      }
      if (cancelled || !data) return;
      if (typeof data.trainer_directory_visible === 'boolean') {
        setDirectoryVisible(data.trainer_directory_visible);
        if (data.trainer_directory_visible !== profile.trainer_directory_visible) {
          patchProfile({ trainer_directory_visible: data.trainer_directory_visible });
        }
      }
      if (typeof data.trainer_photo_visible === 'boolean') {
        setPhotoVisible(data.trainer_photo_visible);
        if (data.trainer_photo_visible !== profile.trainer_photo_visible) {
          patchProfile({ trainer_photo_visible: data.trainer_photo_visible });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Load the trainer's block list. DELETE-own policy exists since 0272
  // ("Users can delete own blocks"), so unblock is a plain row delete.
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('blocked_users')
        .select('id, blocked_id, created_at')
        .eq('blocker_id', profile.id)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        logger.error('TrainerPrivacy blocked list load failed', error);
        setBlockedError(true);
        setBlockedLoading(false);
        return;
      }
      const rows = data || [];
      let byId = new Map();
      if (rows.length) {
        // Names via the same-gym safe view (0289) — reading `profiles`
        // directly is RLS-limited to ACTIVE clients, and someone you blocked
        // usually isn't one.
        const ids = [...new Set(rows.map(r => r.blocked_id).filter(Boolean))];
        const { data: people, error: peopleErr } = await supabase
          .from('gym_member_profiles_safe')
          .select('id, full_name, username, avatar_url')
          .in('id', ids);
        if (peopleErr) logger.error('TrainerPrivacy blocked profiles load failed', peopleErr);
        byId = new Map((people || []).map(p => [p.id, p]));
      }
      if (cancelled) return;
      setBlockedList(rows.map(r => ({ ...r, person: byId.get(r.blocked_id) || null })));
      setBlockedLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  const handleUnblock = async (row) => {
    setUnblockingId(row.id);
    const { error } = await supabase.from('blocked_users').delete().eq('id', row.id);
    setUnblockingId(null);
    if (error) {
      logger.error('TrainerPrivacy unblock failed', error);
      showToast(t('pages:trainerPrivacy.unblockFailed', "Couldn't unblock. Try again."), 'error');
      return;
    }
    setBlockedList(prev => prev.filter(b => b.id !== row.id));
    showToast(t('pages:trainerPrivacy.unblocked', 'User unblocked'), 'success');
  };

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
      if (column === 'trainer_directory_visible') setDirectoryVisible(prev);
      if (column === 'trainer_photo_visible') setPhotoVisible(prev ?? true);
      logger.error('TrainerPrivacy save failed', err);
      showToast(t('pages:trainerPrivacy.saveFailed', 'Failed to save'), 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      // Each section is checked individually: one failing read no longer
      // aborts the whole export — we export what succeeded and record the
      // failures inside the JSON so the file is honest about what's missing.
      const sections = [
        ['profile', supabase.from('profiles').select('*').eq('id', profile.id).single()],
        ['reviews_received', supabase.from('trainer_reviews').select('*').eq('trainer_id', profile.id)],
        ['clients', supabase.from('trainer_clients').select('*').eq('trainer_id', profile.id)],
        ['sessions', supabase.from('trainer_sessions').select('*').eq('trainer_id', profile.id).order('scheduled_at', { ascending: false })],
      ];
      const results = await Promise.all(sections.map(([, q]) => q));

      const payload = { exported_at: new Date().toISOString() };
      const failed = {};
      sections.forEach(([key], i) => {
        const { data, error } = results[i];
        if (error) {
          logger.error(`TrainerPrivacy export read failed (${key})`, error);
          failed[key] = error.message || 'read failed';
          return;
        }
        payload[key] = data ?? (key === 'profile' ? null : []);
      });

      const failedKeys = Object.keys(failed);
      if (failedKeys.length === sections.length) {
        // NOTHING succeeded — don't hand the trainer an empty "backup".
        showToast(t('pages:trainerPrivacy.exportFailed', 'Export failed.'), 'error');
        return;
      }
      if (failedKeys.length) payload.failed_sections = failed;

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tugympr-trainer-${profile?.username || profile?.id || 'export'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(
        failedKeys.length
          ? t('pages:trainerPrivacy.exportPartial', 'Exported — some sections failed and are noted in the file.')
          : t('pages:trainerPrivacy.exportDone', 'Export downloaded.'),
        failedKeys.length ? 'info' : 'success',
      );
    } catch (err) {
      logger.error('TrainerPrivacy export failed', err);
      showToast(t('pages:trainerPrivacy.exportFailed', 'Export failed.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ background: TT.bg, minHeight: '100%', paddingBottom: 100 }}>
      {/* Header */}
      <div className="max-w-3xl mx-auto" style={{ padding: '12px 16px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <TIconButton ariaLabel={t('common:back', 'Back')} onClick={() => navigate(-1)} size={36}>
          <ChevronLeft size={18} style={{ color: TT.text }} />
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
            Icon={Camera}
            title={t('pages:trainerPrivacy.photoVisible', 'Show my photo to members')}
            desc={t('pages:trainerPrivacy.photoVisibleDesc', 'Display your profile photo in the gym page and your public profile. When off, members see your initials instead — design avatars stay visible.')}
            value={photoVisible}
            disabled={savingKey === 'trainer_photo_visible'}
            onChange={(v) => { setPhotoVisible(v); updateField('trainer_photo_visible', v); }}
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

      {/* Blocked users — the unblock surface for chat blocks */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerPrivacy.blockedUsers', 'Blocked users')}
        </div>
        <TCard padded={0}>
          {blockedLoading ? (
            <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
              <Loader2 size={16} className="animate-spin" style={{ color: TT.textMute }} />
            </div>
          ) : blockedError ? (
            <div style={{ padding: 14, fontSize: 12.5, color: TT.textSub }}>
              {t('pages:trainerPrivacy.blockedLoadFailed', "Couldn't load your blocked users. Pull to refresh or try later.")}
            </div>
          ) : blockedList.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12.5, color: TT.textMute, fontStyle: 'italic', lineHeight: 1.5 }}>
              {t('pages:trainerPrivacy.blockedEmpty', "You haven't blocked anyone. When you block someone from a chat, they'll show up here.")}
            </div>
          ) : (
            blockedList.map((row, i) => {
              const name = row.person?.full_name || row.person?.username
                || t('pages:trainerPrivacy.blockedMember', 'Member');
              const busy = unblockingId === row.id;
              return (
                <div key={row.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', minHeight: 56,
                  borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                }}>
                  <TAvatar
                    name={name}
                    size={32}
                    idx={avatarIdx(row.blocked_id)}
                    src={row.person?.avatar_url || undefined}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: TT.text,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {name}
                    </div>
                    {row.created_at && (
                      <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 1 }}>
                        {t('pages:trainerPrivacy.blockedSince', 'Blocked {{date}}', {
                          date: new Date(row.created_at).toLocaleDateString(i18n.language),
                        })}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnblock(row)}
                    disabled={busy}
                    style={{
                      padding: '7px 12px', borderRadius: 9, flexShrink: 0,
                      border: `1px solid ${TT.borderSolid}`, background: TT.surface,
                      color: TT.hot, fontSize: 11.5, fontWeight: 700,
                      cursor: busy ? 'wait' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      minHeight: 32,
                    }}
                  >
                    {busy
                      ? <Loader2 size={12} className="animate-spin" />
                      : <UserX size={12} strokeWidth={2.2} />}
                    {t('pages:trainerPrivacy.unblock', 'Unblock')}
                  </button>
                </div>
              );
            })
          )}
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
                {t('pages:trainerPrivacy.exportDesc', 'Download a JSON file with your profile, reviews received, client roster, and session history.')}
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
              <span style={{ color: TT.textMute, fontSize: 12 }}>→</span>
            </button>
          ))}
        </TCard>
      </div>
    </div>
  );
}
