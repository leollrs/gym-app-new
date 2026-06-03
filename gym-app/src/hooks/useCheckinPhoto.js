import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { takePhoto } from '../lib/takePhoto';
import {
  signCheckinPhoto,
  uploadCheckinPhoto,
  persistCheckinPhoto,
  removeCheckinPhoto,
} from '../lib/checkinPhoto';
import { useToast } from '../contexts/ToastContext';
import logger from '../lib/logger';

/**
 * Manage a subject's staff check-in photo.
 *
 * Signs the current path to a temporary URL and exposes pick()/remove() that
 * upload → persist → re-sign. `onChange(path)` lets the parent keep its own
 * row in sync (so a list thumbnail or header avatar updates immediately).
 *
 * @param {object}   args
 * @param {string}   args.subjectId  profile id of the member/trainer
 * @param {string?}  args.path       current stored path (from the profile row)
 * @param {boolean}  args.enabled    sign + allow edits (default true)
 * @param {Function} args.onChange   called with the new path (or null) after a change
 */
export default function useCheckinPhoto({ subjectId, path: initialPath = null, enabled = true, onChange }) {
  const [path, setPath] = useState(initialPath);
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pathRef = useRef(initialPath);
  const { showToast } = useToast();
  const { t } = useTranslation('pages');

  // Re-sync if the parent supplies a new path (e.g. after a refetch).
  useEffect(() => {
    setPath(initialPath);
    pathRef.current = initialPath;
  }, [initialPath]);

  // Sign whenever the path changes.
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !path) {
      setUrl(null);
      return undefined;
    }
    setLoading(true);
    signCheckinPhoto(path)
      .then((u) => { if (!cancelled) setUrl(u); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, enabled]);

  const apply = useCallback((newPath) => {
    setPath(newPath);
    pathRef.current = newPath;
    onChange?.(newPath);
  }, [onChange]);

  const pick = useCallback(async () => {
    if (!subjectId || busy) return;
    setError(null);
    const file = await takePhoto();
    if (!file) return;
    setBusy(true);
    try {
      const newPath = await uploadCheckinPhoto({ subjectId, file, previousPath: pathRef.current });
      await persistCheckinPhoto(subjectId, newPath);
      apply(newPath);
      showToast(t('checkinPhoto.saved', { defaultValue: 'Check-in photo saved' }), 'success');
    } catch (e) {
      logger.error('useCheckinPhoto.pick:', e);
      setError(e.message || 'Upload failed');
      showToast(t('checkinPhoto.saveFailed', { defaultValue: 'Could not save the photo. Please try again.' }), 'error');
    } finally {
      setBusy(false);
    }
  }, [subjectId, busy, apply, showToast, t]);

  const remove = useCallback(async () => {
    if (!subjectId || busy || !pathRef.current) return;
    setBusy(true);
    setError(null);
    try {
      await removeCheckinPhoto(subjectId, pathRef.current);
      apply(null);
      showToast(t('checkinPhoto.removed', { defaultValue: 'Check-in photo removed' }), 'success');
    } catch (e) {
      logger.error('useCheckinPhoto.remove:', e);
      setError(e.message || 'Remove failed');
      showToast(t('checkinPhoto.removeFailed', { defaultValue: 'Could not remove the photo. Please try again.' }), 'error');
    } finally {
      setBusy(false);
    }
  }, [subjectId, busy, apply, showToast, t]);

  return { url, path, loading, busy, error, pick, remove };
}
