import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { Send, Loader2 } from 'lucide-react';
import { AdminModal } from '../../../components/admin';

const GOLD = 'var(--color-accent)';

/**
 * Unified NPS survey manager — one modal to SEE the active survey, EDIT its
 * question, (re)SEND it to members, or STOP it. Replaces the old split between
 * a "send" modal and a separate "manage/edit" modal (which forced admins to
 * edit in one place and re-send in another).
 *
 * Mutations live in the parent (AdminNPS) so they keep their cache-key
 * invalidation; this component just calls the passed handlers:
 *   - onSend(question)        → launch/relaunch + notify members (writes title)
 *   - onSaveQuestion(question)→ update the active survey's question, no notify
 *   - onDeactivate(id)        → stop the active survey
 */
export function SurveyManagerModal({
  isOpen, onClose, activeSurvey, question, setQuestion,
  onSend, onSaveQuestion, onDeactivate, sending, saving, deactivating, dateFnsLocale,
}) {
  const { t } = useTranslation('pages');
  const trimmed = (question || '').trim();
  const isActive = !!activeSurvey;
  const changed = isActive && !!trimmed && trimmed !== (activeSurvey.title || '').trim();

  const secondaryBtn = 'flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40';
  const primaryBtn = 'flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.98]';

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.nps.npsSurveyLabel', 'NPS Survey')}
      titleIcon={Send}
      footer={
        isActive ? (
          <>
            <button
              onClick={() => onSaveQuestion(trimmed)}
              disabled={saving || !changed}
              className={secondaryBtn}
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}
            >
              {saving ? t('admin.nps.saving', 'Guardando...') : t('admin.nps.save', 'Guardar')}
            </button>
            <button
              onClick={() => onSend(trimmed)}
              disabled={sending || !trimmed}
              className={primaryBtn}
              style={{ background: GOLD, color: 'var(--color-text-on-accent)', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}
            >
              {sending ? t('admin.nps.sending', 'Sending...') : t('admin.nps.resendToAll', 'Resend to all')}
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose} className={secondaryBtn} style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}>
              {t('admin.nps.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => onSend(trimmed)}
              disabled={sending || !trimmed}
              className={primaryBtn}
              style={{ background: GOLD, color: 'var(--color-text-on-accent)', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}
            >
              {sending ? t('admin.nps.sending', 'Sending...') : t('admin.nps.sendToAll', 'Send to All Members')}
            </button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {sending ? (
          /* Sending can take a few seconds (push + in-app to every member) —
             show an unmistakable loading state so it never looks frozen. */
          <div className="flex flex-col items-center justify-center text-center gap-3 py-10">
            <Loader2 className="w-9 h-9 animate-spin" style={{ color: GOLD }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t('admin.nps.sendingToAll', 'Sending survey to all members…')}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.nps.sendingWait', 'This may take a few seconds — keep the app open.')}
            </p>
          </div>
        ) : (
        <>
        {/* active-survey status + stop */}
        {isActive && (
          <div
            className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
            style={{ background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)' }}
          >
            <span className="flex items-center gap-2 text-[12.5px] font-semibold min-w-0" style={{ color: 'var(--color-success-ink, var(--color-success))' }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--color-success)', flexShrink: 0 }} />
              <span className="truncate">
                {t('admin.nps.surveyActiveSince', {
                  time: formatDistanceToNow(new Date(activeSurvey.created_at), { addSuffix: true, ...dateFnsLocale }),
                  defaultValue: 'Active survey · started {{time}}',
                })}
              </span>
            </span>
            <button
              onClick={() => onDeactivate(activeSurvey.id)}
              disabled={deactivating}
              className="text-[11.5px] font-bold flex-shrink-0 disabled:opacity-50"
              style={{ color: 'var(--color-danger)' }}
            >
              {t('admin.nps.deactivate', 'Desactivar')}
            </button>
          </div>
        )}

        {/* the question members see — editable */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-admin-text-muted)', letterSpacing: '0.1em' }}>
            {t('admin.nps.surveyQuestionLabel', 'Pregunta de la encuesta')}
          </label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            maxLength={200}
            placeholder={t('admin.nps.surveyQuestion', '¿Qué tan probable es que nos recomiendes?')}
            className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none resize-none"
            style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
          />
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.nps.surveyQuestionHint', 'Esta es la pregunta que ven los miembros. Las respuestas se califican del 1 al 5.')}
          </p>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {t('admin.nps.surveyDesc', 'This will send a push notification to all active gym members asking them to rate their experience on a scale of 1 to 5. Members can also leave optional written feedback.')}
        </p>

        {isActive && (
          <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}>
            <p className="text-xs" style={{ color: 'var(--color-warning-ink, var(--color-warning))' }}>
              {t('admin.nps.resendWarning', 'Resending relaunches the survey and notifies all members again. Existing responses are preserved. Use “Guardar” to just fix the wording without notifying.')}
            </p>
          </div>
        )}
        </>
        )}
      </div>
    </AdminModal>
  );
}
