import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Camera, X, Check, Loader2 } from 'lucide-react';
import UserAvatar, { AVATAR_DESIGNS, getInitials } from './UserAvatar';

// ── Preset colors ────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#EC4899', '#F43F5E', '#6B7280',
];

// ── Design presets ───────────────────────────────────────────────────────────
const DESIGN_LIST = Object.entries(AVATAR_DESIGNS).map(([id, gradient]) => ({ id, gradient }));

// ── Tab data (labels resolved at render time so i18n picks up language) ─────
const TAB_KEYS = [
  { key: 'photo', labelKey: 'avatarPicker.tabPhoto', fallback: 'Photo' },
  { key: 'color', labelKey: 'avatarPicker.tabColor', fallback: 'Color' },
  { key: 'design', labelKey: 'avatarPicker.tabIcons', fallback: 'Icons' },
];

// ── Backdrop ─────────────────────────────────────────────────────────────────
const backdrop = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};
const sheet = {
  hidden: { scale: 0.95, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: { type: 'spring', damping: 28, stiffness: 300 } },
  exit: { scale: 0.95, opacity: 0, transition: { duration: 0.2 } },
};

/**
 * AvatarPicker — modal/bottom-sheet for avatar customization.
 *
 * Props:
 *   isOpen        — boolean
 *   onClose       — () => void
 *   currentAvatar — { type: 'photo'|'color'|'design', value: string }
 *   user          — profile object (full_name, avatar_url, etc.)
 *   onSave        — ({ type, value, file? }) => Promise<void>
 *   uploading     — boolean (external upload state)
 */
export default function AvatarPicker({ isOpen, onClose, currentAvatar, user, onSave, uploading = false }) {
  const { t } = useTranslation('pages');
  const [tab, setTab] = useState(currentAvatar?.type || 'color');
  const [selectedType, setSelectedType] = useState(currentAvatar?.type || 'color');
  const [selectedValue, setSelectedValue] = useState(currentAvatar?.value || '#6366F1');
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

  // Lock body scroll while bottom sheet is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Reset selection to the actual saved avatar on every open so that an
  // abandoned selection from a previous open never persists as the default.
  useEffect(() => {
    if (!isOpen) return;
    setTab(currentAvatar?.type || 'color');
    setSelectedType(currentAvatar?.type || 'color');
    setSelectedValue(currentAvatar?.value || '#6366F1');
    setPreviewFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
  // currentAvatar intentionally not in deps — we only want to reset on open
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Build a preview user object
  const previewUser = {
    ...user,
    avatar_type: selectedType,
    avatar_value: selectedValue,
    // When previewing a new photo, use the local object URL
    avatar_url: selectedType === 'photo' ? (previewUrl || user?.avatar_url) : user?.avatar_url,
  };

  const initials = getInitials(user);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setSelectedType('photo');
    setSelectedValue(null);
    setTab('photo');
  };

  const handleSave = async () => {
    await onSave({
      type: selectedType,
      value: selectedValue,
      file: selectedType === 'photo' ? previewFile : null,
    });
  };

  const handleClose = () => {
    // Clean up object URL
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewFile(null);
    setPreviewUrl(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="button" tabIndex={-1} aria-label={t('avatarPicker.closeDialog', 'Close dialog')} onClick={handleClose} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClose(); }} />

          {/* Sheet */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t('avatarPicker.title', 'Customize Avatar')}
            className="relative w-full max-w-[480px] bg-[var(--color-bg-card)] border border-white/[0.08] rounded-[20px] max-h-[85vh] overflow-y-auto"
            style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}
            variants={sheet}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-[18px] font-bold text-[var(--color-text-primary)]">
                {t('avatarPicker.title', 'Customize Avatar')}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                className="w-9 h-9 rounded-full bg-white/[0.08] flex items-center justify-center text-[var(--color-text-muted)] hover:text-white transition-colors"
                aria-label={t('common:close', 'Close')}
              >
                <X size={18} />
              </button>
            </div>

            {/* Preview */}
            <div className="flex justify-center py-5">
              <div className="relative">
                <UserAvatar user={previewUser} size={80} rounded="full" />
                {selectedType === 'photo' && previewUrl && (
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check size={14} className="text-white" />
                  </div>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mx-5 p-1 rounded-xl bg-white/[0.05] border border-white/[0.06]">
              {TAB_KEYS.map((tk) => (
                <button
                  key={tk.key}
                  type="button"
                  onClick={() => setTab(tk.key)}
                  className={`flex-1 py-2.5 text-[13px] font-semibold rounded-lg transition-all ${
                    tab === tk.key
                      ? 'bg-[#D4AF37] text-[var(--color-text-on-accent,#000)]'
                      : 'text-[var(--color-text-muted)] hover:text-white'
                  }`}
                >
                  {t(tk.labelKey, tk.fallback)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="px-5 pt-5 pb-4 min-h-[180px]">
              {/* ── Photo tab ──────────────────────────────────────────── */}
              {tab === 'photo' && (
                <div className="flex flex-col items-center gap-4">
                  {previewUrl || user?.avatar_url ? (
                    <img
                      src={previewUrl || user.avatar_url}
                      alt={t('avatarPicker.currentPhoto', 'Current photo')}
                      className="w-24 h-24 rounded-full object-cover border-2 border-white/[0.1]"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-white/[0.06] border-2 border-dashed border-white/[0.15] flex items-center justify-center">
                      <Camera size={28} className="text-[var(--color-text-muted)]" />
                    </div>
                  )}
                  <div className="flex gap-3 w-full justify-center">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white/[0.08] border border-white/[0.1] text-[14px] font-semibold text-[var(--color-text-primary)] hover:bg-white/[0.12] transition-colors min-h-[44px]"
                    >
                      <Camera size={16} />
                      {previewUrl ? t('avatarPicker.changePhoto', 'Change Photo') : t('avatarPicker.choosePhoto', 'Choose Photo')}
                    </button>
                  </div>
                  {/* File input — accept image/*, no capture attr so iOS shows "Take Photo or Choose" dialog */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <p className="text-[12px] text-[var(--color-text-muted)]">
                    {t('avatarPicker.fileHint', 'JPG, PNG or WebP. Max 5 MB.')}
                  </p>
                </div>
              )}

              {/* ── Color tab ──────────────────────────────────────────── */}
              {tab === 'color' && (
                <div className="grid grid-cols-4 gap-3">
                  {PRESET_COLORS.map((color) => {
                    const isSelected = selectedType === 'color' && selectedValue === color;
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => { setSelectedType('color'); setSelectedValue(color); }}
                        className="relative flex items-center justify-center rounded-2xl transition-transform hover:scale-105 active:scale-95 min-h-[44px]"
                        style={{
                          width: '100%',
                          aspectRatio: '1',
                          backgroundColor: color,
                        }}
                        aria-label={t('avatarPicker.selectColor', { color, defaultValue: 'Select color {{color}}' })}
                      >
                        <span className="text-white font-bold select-none" style={{ fontSize: 16 }}>
                          {initials}
                        </span>
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#D4AF37] flex items-center justify-center shadow-lg">
                            <Check size={12} className="text-[var(--color-text-on-accent,#000)]" />
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 rounded-2xl ring-2 ring-[#D4AF37] ring-offset-2 ring-offset-[var(--color-bg-card)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Icons tab ──────────────────────────────────────────── */}
              {tab === 'design' && (
                <div className="grid grid-cols-4 gap-3">
                  {DESIGN_LIST.map((d) => {
                    const isSelected = selectedType === 'design' && selectedValue === d.id;
                    const design = AVATAR_DESIGNS[d.id];
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => { setSelectedType('design'); setSelectedValue(d.id); }}
                        className="relative flex items-center justify-center rounded-2xl transition-transform hover:scale-105 active:scale-95 min-h-[44px] overflow-hidden"
                        style={{
                          width: '100%',
                          aspectRatio: '1',
                          background: design?.bg || d.gradient,
                        }}
                        aria-label={t('avatarPicker.selectIcon', { name: d.id, defaultValue: 'Select {{name}} icon' })}
                      >
                        {design?.svg ? design.svg(36) : (
                          <span className="text-white font-bold select-none" style={{ fontSize: 16 }}>
                            {initials}
                          </span>
                        )}
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#D4AF37] flex items-center justify-center shadow-lg">
                            <Check size={12} className="text-[var(--color-text-on-accent,#000)]" />
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 rounded-2xl ring-2 ring-[#D4AF37] ring-offset-2 ring-offset-[var(--color-bg-card)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save button */}
            <div className="px-5 pb-5 pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={uploading}
                className="w-full py-3.5 rounded-xl bg-[#D4AF37] text-[var(--color-text-on-accent,#000)] font-bold text-[15px] hover:bg-[#C9A430] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[48px]"
              >
                {uploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {t('avatarPicker.saving', 'Saving…')}
                  </>
                ) : (
                  t('avatarPicker.saveAvatar', 'Save Avatar')
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
