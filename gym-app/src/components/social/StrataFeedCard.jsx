import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageCircle, Trophy, Dumbbell, Clock, Send, MoreHorizontal,
  Flag, EyeOff, VolumeX, Trash2, Ban, Flame, Repeat2, Share2,
  Footprints, Bike, Waves, CircleDot, TrendingUp, Droplets,
  PersonStanding, Zap,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { sanitize } from '../../lib/sanitize';
import { exName } from '../../lib/exerciseName';
import { ACHIEVEMENT_DEFS } from '../../lib/achievements';
import { timeAgoFine as timeAgo, fmtDuration } from '../../lib/dateUtils';
import UserAvatar from '../UserAvatar';
import ReactionPicker from '../ReactionPicker';
import ContentActionMenu from '../ContentActionMenu';
import {
  STRATA_FONT_DISPLAY, STRATA_HOT, STRATA_HOT_SOFT,
  STRATA_RADIUS_CARD, STRATA_RADIUS_INNER, STRATA_CARD_SHADOW,
  STRATA_DIVIDER, STRATA_STAT_LABEL, STRATA_STAT_VALUE,
  fmtVolume, fmtDurationStrip,
} from './strataTokens';

// ─── Stat strip ─────────────────────────────────────────────────────────────
// Tabular row at the top of every metric-bearing post. The visual heartbeat
// of the Strata card — telemetry first, body second.
function StatStrip({ items }) {
  if (!items?.length) return null;
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        padding: '6px 16px 14px',
      }}
    >
      {items.map((s, i) => (
        <div
          key={i}
          style={{
            paddingLeft: i > 0 ? 12 : 0,
            paddingRight: i < items.length - 1 ? 12 : 0,
            borderLeft: i > 0 ? `1px solid ${STRATA_DIVIDER}` : 'none',
            minWidth: 0,
          }}
        >
          <div style={{ ...STRATA_STAT_LABEL, color: s.accent || STRATA_STAT_LABEL.color }}>
            {s.label}
          </div>
          <div
            style={{
              ...STRATA_STAT_VALUE,
              color: s.accent || STRATA_STAT_VALUE.color,
              marginTop: 4,
              display: 'flex',
              alignItems: 'baseline',
              gap: 3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {s.value}
            {s.unit && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0,
                  color: 'var(--color-text-muted)',
                }}
              >
                {s.unit}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Title row + PR badge ───────────────────────────────────────────────────
function TitleRow({ title, subtitle, prCount = 0, t }) {
  return (
    <div style={{ padding: '0 16px 10px' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <div
          style={{
            fontFamily: STRATA_FONT_DISPLAY,
            fontSize: 18,
            fontWeight: 800,
            color: 'var(--color-text-primary)',
            letterSpacing: -0.4,
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        {prCount > 0 && (
          <span
            className="inline-flex items-center gap-1"
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              background: STRATA_HOT,
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 0.6,
              transform: 'rotate(-1.5deg)',
              boxShadow: '0 2px 6px rgba(255,90,46,0.3)',
            }}
          >
            <Trophy size={11} strokeWidth={2.6} />
            {prCount} {prCount > 1 ? t('social.newPRsBadge', { defaultValue: 'NEW PRS' }) : t('social.newPRBadge', { defaultValue: 'NEW PR' })}
          </span>
        )}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ─── Photo window — sized, not full-bleed ──────────────────────────────────
function PhotoWindow({ src, alt, height = 220 }) {
  if (!src) return null;
  return (
    <div style={{ padding: '0 16px 14px' }}>
      <div
        style={{
          height,
          borderRadius: STRATA_RADIUS_INNER,
          overflow: 'hidden',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <img
          src={src}
          alt={alt || ''}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    </div>
  );
}

// ─── Top lifts sub-card ────────────────────────────────────────────────────
// `lifts` shape: [{ name, sets, weight, unit, pr }]
function TopLiftsList({ lifts }) {
  if (!lifts?.length) return null;
  return (
    <div style={{ padding: '0 16px 14px' }}>
      <div
        style={{
          background: 'var(--color-bg-secondary)',
          borderRadius: STRATA_RADIUS_INNER,
          padding: '4px 0',
        }}
      >
        {lifts.map((l, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5"
            style={{
              padding: '10px 14px',
              borderBottom: i < lifts.length - 1 ? `1px solid ${STRATA_DIVIDER}` : 'none',
            }}
          >
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: l.pr ? STRATA_HOT : 'var(--color-bg-card)',
              }}
            >
              {l.pr ? (
                <Trophy size={11} color="#fff" strokeWidth={2.6} />
              ) : (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: 'var(--color-text-subtle)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {i + 1}
                </span>
              )}
            </div>
            <div
              className="flex-1 min-w-0"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {l.name}
            </div>
            <div
              style={{
                fontFamily: STRATA_FONT_DISPLAY,
                fontSize: 13,
                fontWeight: 800,
                color: l.pr ? STRATA_HOT : 'var(--color-text-primary)',
                letterSpacing: -0.2,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {l.sets}
              <span style={{ color: 'var(--color-text-faint)', fontWeight: 600, margin: '0 3px' }}>×</span>
              {l.weight}
              <span style={{ fontSize: 10, color: 'var(--color-text-faint)', fontWeight: 600 }}>
                {l.unit || 'lb'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PR hero block — celebratory variant for pr_hit posts ──────────────────
function PRHero({ exerciseName, weight, reps, e1rm, t }) {
  return (
    <div style={{ padding: '0 16px 14px' }}>
      <div
        style={{
          padding: 18,
          borderRadius: STRATA_RADIUS_INNER,
          background: `linear-gradient(135deg, ${STRATA_HOT_SOFT} 0%, var(--color-bg-secondary) 100%)`,
          border: '1px solid var(--color-border-subtle)',
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: STRATA_HOT,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
          }}
        >
          {t('social.feedContent.newPR', 'New Personal Record')}
        </div>
        <div
          style={{
            fontFamily: STRATA_FONT_DISPLAY,
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--color-text-primary)',
            letterSpacing: -0.8,
            lineHeight: 1.1,
            marginTop: 8,
          }}
        >
          {exerciseName}
        </div>
        {/* Weight × reps — separate spans on a flex baseline so the small unit
            text doesn't inherit the big number's negative letter-spacing. */}
        <div
          className="flex items-baseline"
          style={{
            marginTop: 8,
            gap: 6,
            flexWrap: 'wrap',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span
            style={{
              fontFamily: STRATA_FONT_DISPLAY,
              fontSize: 44,
              fontWeight: 800,
              color: STRATA_HOT,
              letterSpacing: -1.6,
              lineHeight: 1,
            }}
          >
            {weight}
          </span>
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: 0,
            }}
          >
            lb
          </span>
          <span
            style={{
              fontSize: 18,
              color: 'var(--color-text-faint)',
              fontWeight: 600,
              margin: '0 2px',
            }}
          >
            ×
          </span>
          <span
            style={{
              fontFamily: STRATA_FONT_DISPLAY,
              fontSize: 30,
              fontWeight: 800,
              color: 'var(--color-text-primary)',
              letterSpacing: -0.8,
              lineHeight: 1,
            }}
          >
            {reps}
          </span>
        </div>
        {e1rm > 0 && (
          <div
            className="inline-flex items-center"
            style={{
              marginTop: 14,
              padding: '5px 11px',
              borderRadius: 999,
              background: STRATA_HOT_SOFT,
              color: STRATA_HOT,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            e1RM · {Math.round(e1rm)} lb
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User-post body — text + optional photo + workout chip ─────────────────
function UserPostBody({ data, t }) {
  return (
    <>
      {data.body && (
        <div style={{ padding: '0 16px 12px' }}>
          <p
            className="whitespace-pre-wrap"
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: 'var(--color-text-primary)',
            }}
          >
            {sanitize(data.body)}
          </p>
        </div>
      )}
      <PhotoWindow src={data.photo_url} alt={sanitize(data.body?.slice(0, 80) || '')} height={260} />
      {data.workout_name && (
        <StatStrip
          items={[
            { label: t('social.feedContent.workout', 'Workout'), value: sanitize(data.workout_name) },
            data.duration_seconds > 0 && {
              label: t('social.statTime', { defaultValue: 'TIME' }),
              ...fmtDurationStrip(data.duration_seconds),
            },
            data.total_volume_lbs > 0 && {
              label: t('social.statVolume', { defaultValue: 'VOLUME' }),
              ...fmtVolume(data.total_volume_lbs),
            },
          ].filter(Boolean)}
        />
      )}
    </>
  );
}

// ─── Simple announcement variant (achievement / check-in / program) ────────
function AnnouncementBlock({ icon: Icon, kicker, title, body, accent }) {
  return (
    <div style={{ padding: '0 16px 14px' }}>
      <div
        className="flex items-start gap-3"
        style={{
          padding: 14,
          borderRadius: STRATA_RADIUS_INNER,
          background: 'var(--color-bg-secondary)',
        }}
      >
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: accent ? `${accent}22` : 'var(--color-bg-card)',
          }}
        >
          <Icon size={18} color={accent || 'var(--color-text-muted)'} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          {kicker && (
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: accent || 'var(--color-text-muted)',
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              {kicker}
            </div>
          )}
          <div
            style={{
              fontFamily: STRATA_FONT_DISPLAY,
              fontSize: 16,
              fontWeight: 800,
              color: 'var(--color-text-primary)',
              letterSpacing: -0.3,
              marginTop: kicker ? 2 : 0,
            }}
          >
            {title}
          </div>
          {body && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
              {body}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Body switch: type → block ─────────────────────────────────────────────
function StrataBody({ item, t }) {
  const data = item.data ?? {};
  const type = item.type;

  if (type === 'workout_completed') {
    const stats = [
      data.duration_seconds > 0 && {
        label: t('social.statTime', { defaultValue: 'TIME' }),
        ...fmtDurationStrip(data.duration_seconds),
      },
      data.total_volume_lbs > 0 && {
        label: t('social.statVolume', { defaultValue: 'VOLUME' }),
        ...fmtVolume(data.total_volume_lbs),
      },
      data.exercise_count > 0 && {
        label: t('social.statExercises', { defaultValue: 'EXERCISES' }),
        value: String(data.exercise_count),
      },
      data.set_count > 0 && {
        label: t('social.statSets', { defaultValue: 'SETS' }),
        value: String(data.set_count),
      },
    ].filter(Boolean);

    return (
      <>
        <TitleRow
          title={sanitize(data.routine_name ?? t('social.feedContent.workout', 'Workout'))}
          prCount={data.pr_count || 0}
          t={t}
        />
        <StatStrip items={stats} />
        {data.photo_url && <PhotoWindow src={data.photo_url} height={200} />}
        <TopLiftsList lifts={data.top_lifts} />
      </>
    );
  }

  if (type === 'pr_hit') {
    const localizedName =
      exName({ name: data.exercise_name, name_es: data.exercise_name_es }) ||
      data.exercise_name;
    return (
      <PRHero
        exerciseName={sanitize(localizedName)}
        weight={data.weight_lbs}
        reps={data.reps}
        e1rm={data.estimated_1rm}
        t={t}
      />
    );
  }

  if (type === 'cardio_completed') {
    const CARDIO_ICONS = {
      running: Footprints, cycling: Bike, rowing: Waves, elliptical: CircleDot,
      stair_climber: TrendingUp, jump_rope: Zap, swimming: Droplets,
      walking: PersonStanding, hiit: Flame,
    };
    const CardioIcon = CARDIO_ICONS[data.cardio_type] || Footprints;
    const typeName = t(`cardio.types.${data.cardio_type}`, data.cardio_type);
    const stats = [
      data.duration_seconds > 0 && { label: t('social.statTime', { defaultValue: 'TIME' }), ...fmtDurationStrip(data.duration_seconds) },
      data.distance_km > 0 && { label: t('social.statDist', { defaultValue: 'DIST' }), value: data.distance_km.toFixed(2), unit: 'km' },
      data.calories_burned > 0 && { label: t('social.statKcal', { defaultValue: 'KCAL' }), value: String(data.calories_burned) },
      data.avg_heart_rate > 0 && { label: t('social.statBpm', { defaultValue: 'BPM' }), value: String(data.avg_heart_rate), accent: STRATA_HOT },
    ].filter(Boolean);

    return (
      <>
        <TitleRow title={typeName} subtitle={t('cardio.feedSubtitle', 'Cardio session')} />
        <StatStrip items={stats} />
        <div style={{ padding: '0 16px 14px' }}>
          <div
            className="flex items-center justify-center"
            style={{
              height: 8,
              borderRadius: 999,
              background: 'var(--color-bg-secondary)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <CardioIcon
              size={14}
              style={{ position: 'absolute', left: 12, top: -3 }}
              color="var(--color-text-muted)"
            />
          </div>
        </div>
      </>
    );
  }

  if (type === 'achievement_unlocked') {
    const achDef = ACHIEVEMENT_DEFS.find((d) => d.key === data.achievement_key);
    const name = achDef?.labelKey
      ? t(achDef.labelKey, achDef.label)
      : data.achievement_name ?? t('social.feedContent.newAchievement');
    const desc = achDef?.descKey ? t(achDef.descKey, achDef.desc) : data.achievement_desc;
    return (
      <AnnouncementBlock
        icon={Trophy}
        kicker={t('social.feedContent.achievementUnlocked', 'Achievement unlocked')}
        title={sanitize(name)}
        body={desc ? sanitize(desc) : null}
        accent="#E8C547"
      />
    );
  }

  if (type === 'check_in') {
    return (
      <AnnouncementBlock
        icon={Dumbbell}
        kicker={t('social.feedContent.checkedInKicker', 'Checked in')}
        title={data.gym_name ? sanitize(data.gym_name) : t('social.feedContent.checkedIn')}
      />
    );
  }

  if (type === 'program_started') {
    return (
      <AnnouncementBlock
        icon={Repeat2}
        kicker={t('social.feedContent.programKicker', 'Started a program')}
        title={sanitize(data.program_name ?? t('social.feedContent.aNewProgram'))}
      />
    );
  }

  if (type === 'user_post') {
    return <UserPostBody data={data} t={t} />;
  }

  return (
    <div style={{ padding: '0 16px 14px' }}>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {String(type).replace(/_/g, ' ')}
      </p>
    </div>
  );
}

// ─── Action rail ───────────────────────────────────────────────────────────
// Reaction · comments · share · "Try this" (clones routine) · report.
// Each primary action is a 36px-tall pill with consistent horizontal padding so
// hit targets line up regardless of whether the count text is showing.
const RAIL_BTN = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 10px',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontVariantNumeric: 'tabular-nums',
};

function StrataActionRail({
  item, currentUserId, onReact, onToggleComments, showComments,
  onShare, onTryWorkout, onReport, reportedIds, t,
}) {
  const data = item.data ?? {};
  const tryable =
    (item.type === 'workout_completed' && data.routine_id) ||
    (item.type === 'user_post' && data.routine_id);

  return (
    <div
      className="flex items-center"
      style={{
        borderTop: `1px solid ${STRATA_DIVIDER}`,
        padding: '6px 10px',
        gap: 2,
      }}
    >
      <div style={RAIL_BTN}>
        <ReactionPicker
          feedItemId={item.id}
          currentUserId={currentUserId}
          currentReaction={item.currentReaction ?? null}
          reactionCounts={item.reactionCounts ?? {}}
          onReact={onReact}
        />
      </div>
      <button
        type="button"
        onClick={onToggleComments}
        aria-label={t('social.comment')}
        aria-expanded={showComments}
        style={{
          ...RAIL_BTN,
          color: showComments
            ? 'var(--color-accent, #2EC4C4)'
            : 'var(--color-text-muted)',
        }}
      >
        <MessageCircle size={18} strokeWidth={2} />
        {item.commentCount > 0 ? item.commentCount : null}
      </button>
      <button
        type="button"
        onClick={() => onShare?.(item)}
        aria-label={t('social.share', 'Share')}
        style={{ ...RAIL_BTN, color: 'var(--color-text-muted)' }}
      >
        <Share2 size={18} strokeWidth={2} />
      </button>
      <div className="flex-1" />
      {tryable && (
        <button
          type="button"
          onClick={() => onTryWorkout?.(item)}
          style={{
            ...RAIL_BTN,
            height: 30,
            padding: '0 12px',
            borderRadius: 999,
            border: `1px solid var(--color-border-default)`,
            color: 'var(--color-text-primary)',
            fontSize: 11,
            letterSpacing: 0.2,
          }}
        >
          <Repeat2 size={12} strokeWidth={2.4} />
          {t('social.tryThis', 'Try this')}
        </button>
      )}
      {item.actor_id !== currentUserId && (
        <button
          type="button"
          onClick={() => onReport(item.id)}
          aria-label={t('social.reportPost', 'Report post')}
          style={{
            ...RAIL_BTN,
            width: 36,
            padding: 0,
            justifyContent: 'center',
            color: reportedIds?.has(item.id) ? STRATA_HOT : 'var(--color-text-faint)',
          }}
        >
          <Flag size={15} fill={reportedIds?.has(item.id) ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}

// ─── Comment row (kept locally so we don't fight the existing one) ─────────
// Now hosts a ContentActionMenu (Report / Block / Delete) per comment so
// every UGC item has the per-item moderation controls Apple G1.2 requires.
function CommentRow({ comment, currentUserId, onDelete, onBlocked, onReported }) {
  const { t } = useTranslation('pages');
  const authorId = comment.profile_id || comment.profiles?.id;
  return (
    <div className="flex gap-3 py-2 group">
      <UserAvatar
        user={{
          avatar_url: comment.profiles?.avatar_url,
          avatar_type: comment.profiles?.avatar_type,
          avatar_value: comment.profiles?.avatar_value,
          full_name: comment.profiles?.full_name ?? '?',
        }}
        size={30}
      />
      <div
        className="flex-1 px-3.5 py-2"
        style={{
          borderRadius: 12,
          background: 'var(--color-bg-secondary)',
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: 'var(--color-text-primary)',
          }}
        >
          {comment.profiles?.full_name ?? t('social.memberFallback', { defaultValue: 'Member' })}{' '}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
          {sanitize(comment.content)}
        </span>
      </div>
      <ContentActionMenu
        contentType="comment"
        contentId={comment.id}
        authorId={authorId}
        authorUsername={comment.profiles?.username}
        authorFullName={comment.profiles?.full_name}
        currentUserId={currentUserId}
        onDelete={onDelete}
        onBlocked={onBlocked}
        onReported={onReported}
        iconSize={14}
      />
    </div>
  );
}

// ─── The card ───────────────────────────────────────────────────────────────
function StrataFeedCard({
  item, currentUserId, onReact, onReport, onHide, onMute, onBlock, onDelete,
  onProfilePreview, onShare, onTryWorkout, reportedIds, t,
}) {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const lastCommentTime = useRef(0);

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const loadComments = async () => {
    if (comments !== null) return;
    const { data } = await supabase
      .from('feed_comments')
      .select('id, content, created_at, profile_id, profiles(id, full_name, username, avatar_url, avatar_type, avatar_value)')
      .eq('feed_item_id', item.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .limit(50);
    setComments(data ?? []);
  };

  // Per-comment delete (only the comment author can call this — RLS would
  // reject otherwise, and ContentActionMenu hides the action for non-authors).
  const handleDeleteComment = async (commentId) => {
    if (!commentId) return;
    const { error } = await supabase
      .from('feed_comments')
      .update({ is_deleted: true })
      .eq('id', commentId)
      .eq('profile_id', currentUserId);
    if (!error) {
      setComments(prev => (prev || []).filter(c => c.id !== commentId));
    }
  };

  // After a successful block from a comment menu, drop that author's comments
  // from the in-memory list immediately so they vanish from the open card.
  const handleCommentAuthorBlocked = (uid) => {
    setComments(prev => (prev || []).filter(c => (c.profile_id || c.profiles?.id) !== uid));
  };

  // After a successful report we don't need to mutate the list — leave the
  // comment visible so the reporter sees what they reported.
  const handleCommentReported = () => {};

  const handleToggleComments = () => {
    if (!showComments) loadComments();
    setShowComments((s) => !s);
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || submitting) return;
    const content = commentText.trim();
    const now = Date.now();
    if (now - lastCommentTime.current < 5000) return;
    if (content.length > 500) return;
    lastCommentTime.current = now;
    setSubmitting(true);
    setCommentText('');
    const { data: newComment } = await supabase
      .from('feed_comments')
      .insert({ feed_item_id: item.id, profile_id: currentUserId, content })
      .select('id, content, created_at, profiles(full_name, avatar_url, avatar_type, avatar_value)')
      .single();
    if (newComment) setComments((prev) => [...(prev ?? []), newComment]);
    setSubmitting(false);
  };

  const handle = item.profiles?.username ?? '—';
  const fullName = item.profiles?.full_name ?? t('social.gymMemberFallback', { defaultValue: 'Gym Member' });

  return (
    <div
      className="overflow-hidden"
      style={{
        borderRadius: STRATA_RADIUS_CARD,
        background: 'var(--color-bg-card)',
        boxShadow: STRATA_CARD_SHADOW,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3" style={{ padding: '14px 16px 10px' }}>
        <button
          type="button"
          onClick={() => onProfilePreview?.(item.actor_id)}
          aria-label={t('social.viewProfile', { name: fullName })}
          className="flex-shrink-0 rounded-full"
        >
          <UserAvatar
            user={{
              avatar_url: item.profiles?.avatar_url,
              avatar_type: item.profiles?.avatar_type,
              avatar_value: item.profiles?.avatar_value,
              full_name: fullName,
            }}
            size={38}
          />
        </button>
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onProfilePreview?.(item.actor_id)}
            className="block text-left truncate"
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: 'var(--color-text-primary)',
              letterSpacing: -0.2,
            }}
          >
            {fullName}
          </button>
          <div
            className="flex items-center gap-1.5 mt-0.5"
            style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
          >
            <span>@{handle}</span>
            <span style={{ color: 'var(--color-text-faint)' }}>·</span>
            <span>{timeAgo(item.created_at)}</span>
          </div>
        </div>
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setShowMenu((s) => !s)}
            aria-label={t('social.moreOptions')}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <MoreHorizontal size={18} />
          </button>
          {showMenu && (
            <div
              className="absolute right-0 top-10 z-30 w-48 rounded-[14px] shadow-xl overflow-hidden"
              style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-default)',
              }}
            >
              <button
                type="button"
                onClick={() => { onHide(item.id); setShowMenu(false); }}
                className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-left"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <EyeOff size={15} style={{ color: 'var(--color-text-muted)' }} />
                {t('social.hidePost')}
              </button>
              {item.actor_id !== currentUserId && (
                <button
                  type="button"
                  onClick={() => { onMute(item.actor_id, item.profiles?.full_name); setShowMenu(false); }}
                  className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-left"
                  style={{
                    color: 'var(--color-text-primary)',
                    borderTop: '1px solid var(--color-border-default)',
                  }}
                >
                  <VolumeX size={15} style={{ color: 'var(--color-text-muted)' }} />
                  {t('social.muteUser', { name: item.profiles?.full_name?.split(' ')[0] ?? '' })}
                </button>
              )}
              {item.actor_id !== currentUserId && (
                <button
                  type="button"
                  onClick={() => { onBlock(item.actor_id, item.profiles?.full_name); setShowMenu(false); }}
                  className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-red-400 text-left"
                  style={{ borderTop: '1px solid var(--color-border-default)' }}
                >
                  <Ban size={15} className="text-red-400" />
                  {t('social.blockUser', { name: item.profiles?.full_name?.split(' ')[0] ?? '' })}
                </button>
              )}
              {item.actor_id === currentUserId && (
                <button
                  type="button"
                  onClick={() => { setConfirmDelete(true); setShowMenu(false); }}
                  className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-red-400 text-left"
                  style={{ borderTop: '1px solid var(--color-border-default)' }}
                >
                  <Trash2 size={15} className="text-red-400" />
                  {t('social.deletePost')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <StrataBody item={item} t={t} />

      {/* Action rail */}
      <StrataActionRail
        item={item}
        currentUserId={currentUserId}
        onReact={onReact}
        onToggleComments={handleToggleComments}
        showComments={showComments}
        onShare={onShare}
        onTryWorkout={onTryWorkout}
        onReport={onReport}
        reportedIds={reportedIds}
        t={t}
      />

      {/* Delete confirm */}
      {confirmDelete && (
        <div
          style={{
            padding: '14px 16px',
            borderTop: '1px solid rgba(232,82,42,0.2)',
            background: 'rgba(232,82,42,0.06)',
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: STRATA_HOT, marginBottom: 10 }}>
            {t('social.deleteConfirm')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold"
              style={{
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              {t('social.report.cancel')}
            </button>
            <button
              type="button"
              onClick={() => { onDelete(item.id); setConfirmDelete(false); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white"
              style={{ background: STRATA_HOT }}
            >
              {t('social.deletePost')}
            </button>
          </div>
        </div>
      )}

      {/* Comments */}
      {showComments && (
        <div
          style={{
            padding: '6px 16px 14px',
            borderTop: `1px solid ${STRATA_DIVIDER}`,
          }}
        >
          <div className="pt-2">
            {comments === null ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0' }}>
                {t('social.loading')}
              </p>
            ) : comments.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '4px 0' }}>
                {t('social.noCommentsYet')}
              </p>
            ) : (
              comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  currentUserId={currentUserId}
                  onDelete={handleDeleteComment}
                  onBlocked={handleCommentAuthorBlocked}
                  onReported={handleCommentReported}
                />
              ))
            )}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              ref={inputRef}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmitComment()}
              placeholder={t('social.writeComment')}
              maxLength={500}
              className="flex-1 px-3.5 py-2 text-[14px]"
              style={{
                borderRadius: 12,
                background: 'var(--color-bg-card)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-default)',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || submitting}
              aria-label={t('social.sendComment', 'Send comment')}
              className="w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40"
              style={{
                background: 'var(--color-accent, #2EC4C4)',
                color: 'var(--color-text-on-accent, #fff)',
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Memoize at the export boundary so parent re-renders don't trigger card
// re-renders unless the card's own props change (item, callbacks, t, etc.).
// This is the primary performance win for the SocialFeed list — cards are
// expensive to render (avatar, stat strip, photo windows, action rail).
export default React.memo(StrataFeedCard);
