// DeletedWorkoutsModal.jsx
// -----------------------------------------------------------------------------
// Lists workouts that were soft-deleted in the last 24 hours and lets the user
// restore them. Backups expire automatically server-side.
// -----------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { X, History, RotateCcw, Trash2, Footprints, Dumbbell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { clearCachedState } from '../hooks/useCachedState';
import { clearCache as clearQueryCache } from '../lib/queryCache';

const CARDIO_BACKUP_KEY = (uid) => `tugympr_deleted_cardio_${uid}`;

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function timeLeft(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const hrs = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export default function DeletedWorkoutsModal({ open, onClose, onRestored }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const now = Date.now();
    // Lifting workouts — server-side soft-delete backups.
    const { data, error } = await supabase
      .from('deleted_session_backups')
      .select('id, original_session_id, payload, points_refunded, deleted_at, expires_at')
      .order('deleted_at', { ascending: false });
    const lifting = (!error ? (data || []) : [])
      .filter(b => new Date(b.expires_at).getTime() > now)
      .map(b => ({ ...b, kind: 'workout' }));
    // Cardio sessions — client-side soft-delete (snapshot in localStorage).
    let cardio = [];
    if (user?.id) {
      try {
        const list = JSON.parse(localStorage.getItem(CARDIO_BACKUP_KEY(user.id)) || '[]');
        cardio = list
          .filter(b => new Date(b.expiresAt).getTime() > now)
          .map(b => ({
            id: b.backupId,
            kind: 'cardio',
            payload: { session: b.row || {} },
            points_refunded: 0,
            deleted_at: b.deletedAt,
            expires_at: b.expiresAt,
            row: b.row,
          }));
      } catch {}
    }
    const merged = [...lifting, ...cardio].sort(
      (a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
    );
    setItems(merged);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!open) return;
    load();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, load]);

  // After a successful restore we have to bust the dashboard's caches so the
  // restored session reappears immediately. Without this, useCachedState in
  // Dashboard hydrates from localStorage on the next render and the bumped
  // refreshKey alone isn't enough to overwrite stale today/week arrays before
  // the user sees them. Mirrors the pattern in ActiveSession.complete (~1815).
  const bustDashboardCache = useCallback(() => {
    if (!user?.id) return;
    try {
      const heroKey = `dashboard-hero-${user.id}`;
      clearCachedState(`${heroKey}-today`);
      clearCachedState(`${heroKey}-week-cardio`);
      clearQueryCache(`dash:${user.id}`);
    } catch {}
    // React Query keyed-list invalidation — covers any other pages
    // (Workout Log, Progress, etc.) that consume session lists. Without
    // this the user sees stale rows even after the dashboard refreshes.
    try {
      queryClient.invalidateQueries({ queryKey: ['recent-sessions-with-sets'] });
      queryClient.invalidateQueries({ queryKey: ['workout-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['cardio-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch {}
  }, [user?.id, queryClient]);

  const handleRestore = useCallback(async (item) => {
    setBusyId(item.id);
    if (item.kind === 'cardio') {
      // Re-insert the snapshotted row, then drop the local backup entry.
      const row = item.row;
      if (!row) {
        setBusyId(null);
        showToast(t('deletedWorkouts.restoreFailed', 'Could not restore'), 'error');
        return;
      }
      const { error } = await supabase.from('cardio_sessions').insert(row);
      setBusyId(null);
      if (error) {
        showToast(t('deletedWorkouts.restoreFailed', 'Could not restore'), 'error');
        return;
      }
      try {
        const KEY = CARDIO_BACKUP_KEY(user.id);
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        const next = list.filter(b => b.backupId !== item.id);
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      showToast(t('deletedWorkouts.restored', 'Workout restored'), 'success');
      setItems(prev => {
        const next = prev.filter(b => b.id !== item.id);
        if (next.length === 0) onClose?.();
        return next;
      });
      bustDashboardCache();
      onRestored?.();
      return;
    }
    const { error } = await supabase.rpc('restore_deleted_session', { p_backup_id: item.id });
    setBusyId(null);
    if (error) {
      showToast(t('deletedWorkouts.restoreFailed', 'Could not restore'), 'error');
      return;
    }
    showToast(t('deletedWorkouts.restored', 'Workout restored'), 'success');
    setItems(prev => {
      const next = prev.filter(b => b.id !== item.id);
      if (next.length === 0) onClose?.();
      return next;
    });
    bustDashboardCache();
    onRestored?.();
  }, [showToast, t, onRestored, onClose, user?.id, bustDashboardCache]);

  const handlePurge = useCallback(async (item) => {
    setBusyId(item.id);
    if (item.kind === 'cardio') {
      try {
        const KEY = CARDIO_BACKUP_KEY(user.id);
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        const next = list.filter(b => b.backupId !== item.id);
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      setBusyId(null);
      setItems(prev => prev.filter(b => b.id !== item.id));
      return;
    }
    const { error } = await supabase
      .from('deleted_session_backups')
      .delete()
      .eq('id', item.id);
    setBusyId(null);
    if (error) {
      showToast(t('deletedWorkouts.purgeFailed', 'Could not remove'), 'error');
      return;
    }
    setItems(prev => prev.filter(b => b.id !== item.id));
  }, [showToast, t, user?.id]);

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        fontFamily: FONT_BODY,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--color-bg-card)',
          borderRadius: 28,
          overflow: 'hidden',
          border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
          boxShadow: '0 16px 48px rgba(0,0,0,0.32)',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            padding: '18px 20px 14px',
            borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--color-accent)', textTransform: 'uppercase' }}>
              <History size={11} style={{ display: 'inline', marginRight: 5, marginBottom: -1 }} />
              {t('deletedWorkouts.eyebrow', 'Recently deleted')}
            </p>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 900, letterSpacing: -0.5, color: 'var(--color-text-primary)', marginTop: 4, lineHeight: 1.1 }}>
              {t('deletedWorkouts.title', 'Restore a workout')}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              {t('deletedWorkouts.hint', 'Workouts deleted in the last 24h. Restoring re-credits the points.')}
            </p>
          </div>
          <button
            type="button" onClick={onClose} aria-label={t('deletedWorkouts.close', 'Close')}
            style={{
              width: 36, height: 36, borderRadius: 18,
              background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
              color: 'var(--color-text-primary)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginLeft: 8,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '32px 12px', fontSize: 13 }}>
              {t('common.loading', { ns: 'common', defaultValue: 'Loading…' })}
            </p>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 18, marginInline: 'auto', marginBottom: 12,
                background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <History size={22} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <p style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                {t('deletedWorkouts.empty', 'Nothing to restore')}
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {t('deletedWorkouts.emptyHint', 'Deleted workouts show up here for 24 hours.')}
              </p>
            </div>
          ) : (
            items.map((b) => {
              const isCardio = b.kind === 'cardio';
              const sess = b.payload?.session || {};
              const left = timeLeft(b.expires_at);
              const exCount = (b.payload?.exercises || []).length;
              const KindIcon = isCardio ? Footprints : Dumbbell;
              const title = isCardio
                ? (sess.cardio_type
                    ? t(`cardio.types.${sess.cardio_type}`, sess.cardio_type)
                    : t('deletedWorkouts.cardioUntitled', 'Cardio session'))
                : (sess.name || t('deletedWorkouts.untitled', 'Workout'));
              const subtitle = isCardio
                ? [
                    formatDateTime(sess.completed_at || sess.created_at),
                    sess.duration_seconds > 0
                      && `${Math.round(sess.duration_seconds / 60)} min`,
                    sess.distance_km > 0 && `${sess.distance_km.toFixed(2)} km`,
                  ].filter(Boolean).join(' · ')
                : `${formatDateTime(sess.completed_at || sess.started_at)} · ${t('deletedWorkouts.exercises', { count: exCount, defaultValue: `${exCount} exercises` })}`;
              return (
                <div
                  key={b.id}
                  style={{
                    background: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                    border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
                    borderRadius: 16, padding: 14, marginBottom: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                      background: isCardio
                        ? 'rgba(46,196,196,0.14)'
                        : 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                      color: isCardio ? '#2EC4C4' : 'var(--color-accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <KindIcon size={16} strokeWidth={2.2} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                        color: 'var(--color-text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {title}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {subtitle}
                      </p>
                    </div>
                    {left && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                        textTransform: 'uppercase', color: 'var(--color-text-muted)',
                        padding: '4px 8px', borderRadius: 999,
                        background: 'rgba(0,0,0,0.18)',
                        flexShrink: 0,
                      }}>
                        {t('deletedWorkouts.expiresIn', { time: left, defaultValue: `${left} left` })}
                      </span>
                    )}
                  </div>
                  {b.points_refunded > 0 && (
                    <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                      {t('deletedWorkouts.pointsRemoved', { points: b.points_refunded, defaultValue: `${b.points_refunded} pts removed — restored on undo` })}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleRestore(b)}
                      disabled={busyId === b.id}
                      style={{
                        flex: 1, padding: '10px 12px', borderRadius: 12,
                        background: 'var(--color-accent)',
                        color: 'var(--color-text-on-accent, #000)', border: 'none',
                        fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 12, letterSpacing: 0.3,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        opacity: busyId === b.id ? 0.6 : 1,
                      }}
                    >
                      <RotateCcw size={13} />
                      {t('deletedWorkouts.restore', 'Restore')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePurge(b)}
                      disabled={busyId === b.id}
                      aria-label={t('deletedWorkouts.purge', 'Remove backup')}
                      style={{
                        width: 44, height: 40, borderRadius: 12,
                        background: 'transparent',
                        border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.10))',
                        color: 'var(--color-text-muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: busyId === b.id ? 0.6 : 1,
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
