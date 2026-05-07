import React, { useEffect, useMemo, useState } from 'react';
import { X, MessageCircle, Plus, Trash2, Send } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import useFocusTrap from '../../../hooks/useFocusTrap';

const STORAGE_KEY = 'trainer_msg_templates_v1';

/**
 * Default seed templates (i18n via the t() callable that consumers pass in).
 * We seed only on first load so the trainer can edit/remove freely.
 */
function buildDefaults(t) {
  return [
    { id: 'tpl_great_session', text: t('trainerMessages.templates.defaultGreatSession', 'Great session today! Keep it up.') },
    { id: 'tpl_check_in',     text: t('trainerMessages.templates.defaultCheckIn', "Hey, how's training going this week?") },
    { id: 'tpl_form_video',   text: t('trainerMessages.templates.defaultFormVideo', 'Send me a quick video of your form on this lift?') },
    { id: 'tpl_next_session', text: t('trainerMessages.templates.defaultNextSession', 'See you at our next session!') },
    { id: 'tpl_recovery',     text: t('trainerMessages.templates.defaultRecovery', 'Make sure you rest and hydrate today.') },
    { id: 'tpl_motivation',   text: t('trainerMessages.templates.defaultMotivation', "You're crushing it. Stay consistent.") },
  ];
}

function loadTemplates(t) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = buildDefaults(t);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return buildDefaults(t);
    return parsed;
  } catch {
    return buildDefaults(t);
  }
}

function saveTemplates(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

/**
 * Modal listing pre-written message templates. Trainer can pick one,
 * edit before sending, save a new one, or delete existing ones.
 *
 * Props:
 *   open, onClose
 *   onSend(text) — fired with the (possibly edited) message text
 *   t            — translation fn (pages namespace)
 */
export default function MessageTemplateModal({ open, onClose, onSend, t }) {
  const focusRef = useFocusTrap(open, onClose);
  const [templates, setTemplates] = useState(() => loadTemplates(t));
  const [draft, setDraft] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newText, setNewText] = useState('');

  // Reset draft + form state each time the modal is re-opened.
  // The setState calls inside this effect are an intentional mirror of an
  // external "open" prop edge — templates can be mutated elsewhere
  // (other tabs, other components) and we want fresh state on each open.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplates(loadTemplates(t));
    setDraft('');
    setShowNewForm(false);
    setNewText('');
  }, [open, t]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const sortedTemplates = useMemo(() => templates, [templates]);

  if (!open) return null;

  const handlePick = (text) => setDraft(text);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
  };

  const handleSaveNew = () => {
    const text = newText.trim();
    if (!text) return;
    const next = [...templates, { id: `tpl_${Date.now()}`, text }];
    setTemplates(next);
    saveTemplates(next);
    setNewText('');
    setShowNewForm(false);
  };

  const handleDelete = (id) => {
    const next = templates.filter(tpl => tpl.id !== id);
    setTemplates(next);
    saveTemplates(next);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-0 sm:px-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        ref={focusRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="msg-template-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden rounded-3xl sm:rounded-3xl"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
            >
              <MessageCircle size={16} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h3 id="msg-template-title" className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {t('trainerMessages.templates.title', 'Templates')}
              </h3>
              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerMessages.templates.subtitle', 'Quick replies you can reuse')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label={t('trainerMessages.templates.close', 'Close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Template list */}
        <div className="overflow-y-auto px-3 py-3 flex-1">
          <div className="space-y-2">
            {sortedTemplates.map((tpl) => {
              const isSelected = draft === tpl.text;
              return (
                <div
                  key={tpl.id}
                  className="rounded-xl flex items-stretch gap-2 p-2 transition-colors"
                  style={{
                    background: isSelected
                      ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                      : 'var(--color-surface-hover, rgba(0,0,0,0.03))',
                    border: '1px solid',
                    borderColor: isSelected ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handlePick(tpl.text)}
                    className="flex-1 text-left min-h-[44px] px-2 py-1.5"
                    aria-label={t('trainerMessages.templates.pickAria', 'Use template')}
                  >
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text-primary)' }}>
                      {tpl.text}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tpl.id)}
                    className="shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label={t('trainerMessages.templates.deleteAria', 'Delete template')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            {sortedTemplates.length === 0 && (
              <p className="text-center text-[13px] py-6" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerMessages.templates.empty', 'No templates yet')}
              </p>
            )}
          </div>

          {/* Add new */}
          <div className="mt-3">
            {!showNewForm ? (
              <button
                type="button"
                onClick={() => setShowNewForm(true)}
                className="w-full min-h-[44px] rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-semibold"
                style={{ border: '1px dashed var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              >
                <Plus size={14} />
                {t('trainerMessages.templates.addNew', 'Add template')}
              </button>
            ) : (
              <div className="rounded-xl p-2" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))', border: '1px solid var(--color-border-subtle)' }}>
                <textarea
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  placeholder={t('trainerMessages.templates.newPlaceholder', 'Type a new template…')}
                  rows={3}
                  maxLength={1000}
                  className="w-full resize-none bg-transparent outline-none px-2 py-1.5 text-[13px]"
                  style={{ color: 'var(--color-text-primary)' }}
                />
                <div className="flex justify-end gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => { setShowNewForm(false); setNewText(''); }}
                    className="px-3 min-h-[36px] rounded-lg text-[12px] font-semibold"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {t('trainerMessages.templates.cancel', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNew}
                    disabled={!newText.trim()}
                    className="px-3 min-h-[36px] rounded-lg text-[12px] font-bold disabled:opacity-50"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
                  >
                    {t('trainerMessages.templates.save', 'Save')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Edit + send footer */}
        <div className="px-3 py-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('trainerMessages.templates.editPlaceholder', 'Edit template')}
            rows={3}
            maxLength={2000}
            className="w-full resize-none rounded-xl px-3 py-2.5 outline-none text-[14px]"
            style={{
              background: 'var(--color-surface-hover, rgba(0,0,0,0.04))',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim()}
            className="w-full mt-2 min-h-[48px] rounded-xl flex items-center justify-center gap-2 text-[14px] font-bold disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            <Send size={15} />
            {t('trainerMessages.templates.sendBtn', 'Send')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
