import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { useState, useMemo } from 'react';
import { getISOWeek } from 'date-fns';
import { Card, IconChip, Pill, OutPill, Confidence, Label, Ico, ICON, TYPE_ICON, PrimaryBtn, TK, FK } from './retosKit';

const DISMISS_KEY = (gymId) => `suggestion_dismissed_${gymId}`;
const norm = (s) => (s || '').trim().toLowerCase();

export default function ChallengeSuggestionCard({ gymId, onCreateFromSuggestion }) {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');

  const { data: suggestion, isLoading } = useQuery({
    queryKey: adminKeys.challengeSuggestion(gymId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_challenge_suggestion', { p_gym_id: gymId });
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!gymId,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  // Existing challenges — used to detect whether this week's suggestion has
  // already been created so the card LOCKS (shows "Created") instead of
  // allowing duplicates. Keyed under adminKeys.challenges so the parent's
  // post-create invalidation refetches it by prefix.
  const { data: existingRows = [] } = useQuery({
    queryKey: ['admin', 'challenges', gymId, 'names-only'],
    queryFn: async () => {
      const { data } = await supabase
        .from('challenges')
        .select('name, created_at')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  const [creating, setCreating] = useState(false);

  // Locally dismissed suggestions (admin clicked the dismiss button).
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY(gymId)) || '[]'); } catch { return []; }
  });

  // "New" badge logic — shows until admin sees it this week
  const currentWeek = getISOWeek(new Date());
  const storageKey = `suggestion_seen_${gymId}`;
  const [seen, setSeen] = useState(() => {
    try { return parseInt(localStorage.getItem(storageKey) || '0') === currentWeek; } catch { return false; }
  });

  const suggestionKey = useMemo(() => {
    if (!suggestion) return null;
    return norm(suggestion.suggested_name_en || suggestion.suggested_name_es);
  }, [suggestion]);

  // Match against BOTH localized names: the challenge is stored with the ES name
  // when the app is in Spanish, but the suggestion's dedup key is EN-stable —
  // checking only one let Spanish gyms create endless duplicates.
  const existingMatch = useMemo(() => {
    if (!suggestion) return null;
    const en = norm(suggestion.suggested_name_en);
    const es = norm(suggestion.suggested_name_es);
    return existingRows.find(r => {
      const n = norm(r.name);
      return n && (n === en || n === es);
    }) || null;
  }, [existingRows, suggestion]);

  const alreadyExists = !!existingMatch;
  const isDismissed = suggestionKey && dismissed.includes(suggestionKey);

  // Note: alreadyExists no longer hides the card — it flips it to a locked
  // "Created" state below.
  if (isLoading || !suggestion || isDismissed) return null;

  const handleDismiss = () => {
    if (!suggestionKey) return;
    const next = Array.from(new Set([...dismissed, suggestionKey])).slice(-50);
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY(gymId), JSON.stringify(next)); } catch {}
  };

  const name = isEs ? suggestion.suggested_name_es : suggestion.suggested_name_en;
  const reasoning = isEs ? suggestion.reasoning_es : suggestion.reasoning_en;
  const typeLabel = t(`admin.challengeTypes.${suggestion.challenge_type}`, suggestion.challenge_type);
  const typeIcon = TYPE_ICON[suggestion.challenge_type] || ICON.bolt;
  const confidencePct = Math.round((suggestion.confidence || 0.5) * 100);
  const lang = isEs ? 'es' : 'en';
  const createdDate = existingMatch?.created_at
    ? new Date(existingMatch.created_at).toLocaleDateString(lang, { day: 'numeric', month: 'short' })
    : '';

  const handleCreate = async () => {
    if (creating || alreadyExists) return; // guard against double-create
    setCreating(true);
    setSeen(true);
    try { localStorage.setItem(storageKey, String(currentWeek)); } catch {}
    try {
      await onCreateFromSuggestion(suggestion);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card style={{ overflow: 'hidden', marginTop: 22, position: 'relative' }}>
      {/* faint watermark */}
      <div style={{ position: 'absolute', top: -30, right: -26, opacity: 0.05, pointerEvents: 'none' }}>
        <Ico ch={ICON.bolt} size={210} color={TK.accent} stroke={1.2} />
      </div>

      {!alreadyExists && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('admin.challenges.suggestion.dismiss', 'Dismiss suggestion')}
          title={t('admin.challenges.suggestion.dismiss', 'Dismiss suggestion')}
          style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'transparent', border: `1px solid ${TK.borderSolid}`, zIndex: 2 }}
        >
          <Ico ch={ICON.x} size={15} color={TK.textMute} stroke={2.2} />
        </button>
      )}

      <div style={{ display: 'flex', gap: 18, padding: '22px 24px', position: 'relative' }}>
        <IconChip ch={ICON.bulb} tone="accent" size={48} r={15} strokeW={2} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Label style={{ color: TK.accent, letterSpacing: 1.4 }}>{t('admin.challenges.suggestion.title', 'Suggested This Week')}</Label>
            {!seen && !alreadyExists && <Pill tone="accent" icon={ICON.sparkle} solid>{t('admin.challenges.suggestion.new', 'NEW')}</Pill>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Ico ch={typeIcon} size={18} color={TK.accent} stroke={2.2} />
              <span style={{ fontFamily: FK.display, fontSize: 21, fontWeight: 800, letterSpacing: -0.5, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            </span>
            <Pill tone="neutral" icon={ICON.target}>{typeLabel}</Pill>
          </div>

          <p style={{ margin: '11px 0 0', fontFamily: FK.body, fontSize: 14.5, color: TK.textSub, lineHeight: 1.5, maxWidth: 560 }}>{reasoning}</p>

          <div style={{ marginTop: 18, maxWidth: 440 }}>
            <Confidence pct={confidencePct} label={t('admin.challenges.suggestion.confidence', 'Confidence')} />
          </div>

          {alreadyExists ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18, flexWrap: 'wrap' }}>
              <OutPill tone="good" dot>{t('admin.challenges.suggestion.created', 'Created')}{createdDate ? ` · ${createdDate}` : ''}</OutPill>
              <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute }}>
                {t('admin.challenges.suggestion.createdHint', "You've already created this week's suggestion — a fresh one comes next week.")}
              </span>
            </div>
          ) : (
            <div style={{ marginTop: 18 }}>
              <PrimaryBtn icon={ICON.sparkle} onClick={handleCreate} disabled={creating}>
                {creating ? t('admin.challenges.creating', 'Creating...') : t('admin.challenges.suggestion.createButton', 'Create This Challenge')}
              </PrimaryBtn>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
