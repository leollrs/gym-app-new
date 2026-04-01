import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

// ── Tab data ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'photo', label: 'Photo' },
  { key: 'color', label: 'Color' },
  { key: 'design', label: 'Icons' },
];

// ── Backdrop ─────────────────────────────────────────────────────────────────
const backdrop = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};
const sheet = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: { type: 'spring', damping: 28, stiffness: 300 } },
  exit: { y: '100%', transition: { duration: 0.2 } },
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
  const [tab, setTab] = useState(currentAvatar?.type || 'color');
  const [selectedType, setSelectedType] = useState(currentAvatar?.type || 'color');
  const [selectedValue, setSelectedValue] = useState(currentAvatar?.value || '#6366F1');
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

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
          className="fixed inset-0 z-[100] flex items-end justify-center"
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

          {/* Sheet */}
          <motion.div
            className="relative w-full max-w-[480px] bg-[var(--color-bg-card)] border-t border-white/[0.08] rounded-t-[20px] pb-[env(safe-area-inset-bottom)] max-h-[85vh] overflow-y-auto"
            variants={sheet}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-[18px] font-bold text-[var(--color-text-primary)]">
                Customize Avatar
              </h2>
              <button
                type="button"
                onClick={handleClose}
                className="w-9 h-9 rounded-full bg-white/[0.08] flex items-center justify-center text-[var(--color-text-muted)] hover:text-white transition-colors"
                aria-label="Close"
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
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`flex-1 py-2.5 text-[13px] font-semibold rounded-lg transition-all ${
                    tab === t.key
                      ? 'bg-[#D4AF37] text-black'
                      : 'text-[var(--color-text-muted)] hover:text-white'
                  }`}
                >
                  {t.label}
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
                      alt="Current photo"
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
                      {previewUrl ? 'Change Photo' : 'Choose Photo'}
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
                    JPG, PNG or WebP. Max 5 MB.
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
                        aria-label={`Select color ${color}`}
                      >
                        <span className="text-white font-bold select-none" style={{ fontSize: 16 }}>
                          {initials}
                        </span>
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#D4AF37] flex items-center justify-center shadow-lg">
                            <Check size={12} className="text-black" />
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
                        aria-label={`Select ${d.id} icon`}
                      >
                        {design?.svg ? design.svg(36) : (
                          <span className="text-white font-bold select-none" style={{ fontSize: 16 }}>
                            {initials}
                          </span>
                        )}
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#D4AF37] flex items-center justify-center shadow-lg">
                            <Check size={12} className="text-black" />
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
                className="w-full py-3.5 rounded-xl bg-[#D4AF37] text-black font-bold text-[15px] hover:bg-[#C9A430] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[48px]"
              >
                {uploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save Avatar'
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
