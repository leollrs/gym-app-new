import { Camera, Trash2 } from 'lucide-react';
import useCheckinPhoto from '../hooks/useCheckinPhoto';

/**
 * Staff-managed check-in reference photo editor.
 *
 * Shows the subject's reference photo (or a camera placeholder) with a badge
 * button to take/replace it and a Remove action. Theme-prop driven so it sits
 * naturally in both the admin dark UI and the trainer light (TT) UI.
 *
 * Members never render this — it's only mounted on staff surfaces.
 *
 * @param {object}   props
 * @param {string}   props.subjectId  member/trainer profile id
 * @param {string?}  props.path       current stored path (from the profile row)
 * @param {Function} props.onChange   notified with the new path (or null)
 * @param {boolean}  props.canEdit    show edit controls (default true)
 * @param {number}   props.size       photo box size in px (default 96)
 * @param {'rounded'|'circle'} props.shape
 * @param {object}   props.theme      { accent, surface, border, text, textSub, danger, badgeBorder }
 * @param {object}   props.labels     { photo, hint, add, replace, remove }
 */
export default function CheckinPhotoEditor({
  subjectId,
  path,
  onChange,
  canEdit = true,
  size = 96,
  shape = 'rounded',
  theme = {},
  labels = {},
}) {
  const { url, loading, busy, error, pick, remove } = useCheckinPhoto({ subjectId, path, onChange });

  const radius = shape === 'circle' ? '50%' : 18;
  const accent = theme.accent || '#2EC4C4';
  const surface = theme.surface || 'rgba(255,255,255,0.05)';
  const border = theme.border || 'rgba(255,255,255,0.12)';
  const text = theme.text || '#E5E7EB';
  const textSub = theme.textSub || '#9CA3AF';
  const danger = theme.danger || '#EF4444';
  const badgeBorder = theme.badgeBorder || '#0B0F14';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <div style={{
          width: size, height: size, borderRadius: radius, overflow: 'hidden',
          background: surface, border: `1px solid ${border}`,
          display: 'grid', placeItems: 'center',
        }}>
          {url ? (
            <img src={url} alt={labels.photo || 'Check-in photo'}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Camera size={Math.round(size * 0.3)} style={{ color: textSub, opacity: 0.55 }} />
          )}
          {(busy || loading) && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center' }}>
              <div className="animate-spin" style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%' }} />
            </div>
          )}
        </div>
        {canEdit && (
          <button
            type="button" onClick={pick} disabled={busy}
            aria-label={url ? (labels.replace || 'Replace photo') : (labels.add || 'Add photo')}
            style={{
              position: 'absolute', bottom: -6, right: -6, width: 32, height: 32, borderRadius: '50%',
              background: accent, border: `2px solid ${badgeBorder}`,
              display: 'grid', placeItems: 'center', cursor: busy ? 'default' : 'pointer',
              color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            }}>
            <Camera size={15} />
          </button>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: text }}>{labels.photo || 'Check-in photo'}</div>
        <div style={{ fontSize: 11, color: textSub, marginTop: 2, lineHeight: 1.35 }}>
          {labels.hint || 'Staff only — used to verify identity at check-in.'}
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 14, marginTop: 7 }}>
            <button
              type="button" onClick={pick} disabled={busy}
              style={{ fontSize: 12, fontWeight: 700, color: accent, background: 'none', border: 'none', padding: 0, cursor: busy ? 'default' : 'pointer' }}>
              {url ? (labels.replace || 'Replace') : (labels.add || 'Add photo')}
            </button>
            {url && (
              <button
                type="button" onClick={remove} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: danger, background: 'none', border: 'none', padding: 0, cursor: busy ? 'default' : 'pointer' }}>
                <Trash2 size={12} /> {labels.remove || 'Remove'}
              </button>
            )}
          </div>
        )}
        {error && <div style={{ fontSize: 11, color: danger, marginTop: 5 }}>{error}</div>}
      </div>
    </div>
  );
}
