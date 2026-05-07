// src/components/ContentActionMenu.jsx
//
// Compact "..." button that opens a small dropdown with moderation actions:
//   - Report          (any content where currentUserId !== authorId)
//   - Block user      (any content where currentUserId !== authorId)
//   - Delete          (only when the viewer authored the content)
//
// Wraps ReportContentModal + BlockUserModal. Drop-in for posts, comments,
// messages, and profile rows.
//
// Modals it opens are CENTER-ALIGNED (per user UI rules). The dropdown
// itself is anchored to the trigger (right-aligned).

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Flag, Ban, Trash2 } from 'lucide-react';
import ReportContentModal from './ReportContentModal';
import BlockUserModal from './BlockUserModal';

const FONT_BODY = "'Familjen Grotesk', 'Archivo', system-ui, sans-serif";

export default function ContentActionMenu({
  contentType,           // 'post' | 'comment' | 'message' | 'profile'
  contentId,             // uuid of the reported content
  authorId,              // uuid of the content author
  authorUsername,        // for the block modal title
  authorFullName,        // fallback display name
  currentUserId,         // viewer's user id
  onDelete,              // (contentId) => void  — required to surface "Delete"
  onBlocked,             // (userId) => void     — fired after a successful block
  onReported,            // (contentId) => void  — fired after a successful report
  iconSize = 16,
  buttonClassName = '',
  ariaLabel,
}) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const wrapperRef = useRef(null);

  const isOwn = !!currentUserId && currentUserId === authorId;
  const canReport = !isOwn && !!contentId && !!authorId;
  const canBlock = !isOwn && !!authorId;
  const canDelete = isOwn && typeof onDelete === 'function';

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openReport = useCallback(() => { setOpen(false); setReportOpen(true); }, []);
  const openBlock = useCallback(() => { setOpen(false); setBlockOpen(true); }, []);
  const handleDelete = useCallback(() => {
    setOpen(false);
    onDelete?.(contentId);
  }, [onDelete, contentId]);

  // If there's nothing to show, render nothing — keeps layouts tidy.
  // Must come AFTER all hooks to satisfy rules-of-hooks.
  if (!canReport && !canBlock && !canDelete) return null;

  return (
    <>
      <div className="relative inline-block" ref={wrapperRef}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(s => !s); }}
          aria-label={ariaLabel || t('moderation.menu.aria', { defaultValue: 'More options' })}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`inline-flex items-center justify-center rounded-lg w-8 h-8 transition-colors hover:bg-white/[0.06] active:bg-white/[0.10] ${buttonClassName}`}
          style={{ color: 'var(--color-text-subtle)' }}
        >
          <MoreHorizontal size={iconSize} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-9 z-40 w-48 rounded-[14px] overflow-hidden"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-default, rgba(127,127,127,0.18))',
              boxShadow: '0 8px 28px rgba(15,20,25,0.22)',
              fontFamily: FONT_BODY,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {canReport && (
              <button
                type="button"
                role="menuitem"
                onClick={openReport}
                className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-left transition-colors hover:bg-white/[0.04]"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <Flag size={14} style={{ color: 'var(--color-text-muted)' }} />
                {t('moderation.menu.report', { defaultValue: 'Report' })}
              </button>
            )}
            {canBlock && (
              <button
                type="button"
                role="menuitem"
                onClick={openBlock}
                className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-left text-red-400 transition-colors hover:bg-red-500/[0.06]"
                style={canReport ? { borderTop: '1px solid var(--color-border-subtle, rgba(127,127,127,0.12))' } : undefined}
              >
                <Ban size={14} className="text-red-400" />
                {t('moderation.menu.block', { defaultValue: 'Block user' })}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                role="menuitem"
                onClick={handleDelete}
                className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-left text-red-400 transition-colors hover:bg-red-500/[0.06]"
                style={(canReport || canBlock) ? { borderTop: '1px solid var(--color-border-subtle, rgba(127,127,127,0.12))' } : undefined}
              >
                <Trash2 size={14} className="text-red-400" />
                {t('moderation.menu.delete', { defaultValue: 'Delete' })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Report modal — center-aligned */}
      <ReportContentModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        contentType={contentType}
        contentId={contentId}
        targetUserId={authorId}
        onReported={onReported}
      />

      {/* Block confirm — center-aligned */}
      <BlockUserModal
        isOpen={blockOpen}
        onClose={() => setBlockOpen(false)}
        targetUserId={authorId}
        username={authorUsername}
        fullName={authorFullName}
        onBlocked={onBlocked}
      />
    </>
  );
}
