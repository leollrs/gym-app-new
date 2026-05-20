import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { Send } from 'lucide-react';
import { AdminModal, AdminCard } from '../../../components/admin';

const GOLD = 'var(--color-accent)';

/**
 * Two modals shared by AdminNPS:
 *  - `SendSurveyModal`: kick off a new NPS push to every member, replacing
 *    any currently active survey.
 *  - `EditSurveyModal`: tweak the question of the active survey or stop it.
 *
 * Mutations live in the parent so they keep their `useQueryClient` cache
 * key invalidation; these components just expose `onSend` / `onDeactivate`
 * / `onUpdate` props plus the corresponding `isPending` flags.
 */

export function SendSurveyModal({ isOpen, onClose, onSend, activeSurveys, isPending }) {
  const { t } = useTranslation('pages');
  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.nps.sendNpsSurvey', 'Send NPS Survey')}
      titleIcon={Send}
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('admin.nps.cancel', 'Cancel')}
          </button>
          <button
            onClick={onSend}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.98]"
            style={{
              background: GOLD,
              color: 'var(--color-bg-base)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            }}
          >
            {isPending
              ? t('admin.nps.sending', 'Sending...')
              : t('admin.nps.sendToAll', 'Send to All Members')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <AdminCard>
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }}
            >
              <Send size={18} style={{ color: GOLD }} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {t('admin.nps.npsSurveyLabel', 'NPS Survey')}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                &ldquo;{t('admin.nps.surveyQuestion', 'How likely are you to recommend us?')}&rdquo;
              </p>
            </div>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {t(
              'admin.nps.surveyDesc',
              'This will send a push notification to all active gym members asking them to rate their experience on a scale of 1 to 5. Members can also leave optional written feedback.',
            )}
          </p>
        </AdminCard>

        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-3">
          <p className="text-xs text-amber-400">
            {activeSurveys.length > 0
              ? t(
                  'admin.nps.surveyWarningReplace',
                  'Sending will deactivate the {{count}} active survey(s) currently running. Existing responses are preserved.',
                  { count: activeSurveys.length },
                )
              : t(
                  'admin.nps.surveyWarning',
                  'Members who have already responded to past surveys will not receive a duplicate notification.',
                )}
          </p>
        </div>
      </div>
    </AdminModal>
  );
}

export function EditSurveyModal({
  editingSurvey, onClose, editTitle, setEditTitle,
  onDeactivate, onUpdate, deactivatePending, updatePending,
  dateFnsLocale,
}) {
  const { t } = useTranslation('pages');
  return (
    <AdminModal
      isOpen={!!editingSurvey}
      onClose={onClose}
      title={t('admin.nps.editSurvey', 'Editar encuesta activa')}
      titleIcon={Send}
      footer={
        <>
          <button
            onClick={() => {
              if (editingSurvey) onDeactivate(editingSurvey.id);
              onClose();
            }}
            disabled={deactivatePending}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 hover:brightness-110"
            style={{
              background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)',
              color: 'var(--color-danger)',
              border: '1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)',
            }}
          >
            {t('admin.nps.deactivate', 'Desactivar')}
          </button>
          <button
            onClick={() => editingSurvey && onUpdate({ id: editingSurvey.id, title: editTitle })}
            disabled={updatePending || !editTitle.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.98]"
            style={{
              background: GOLD,
              color: 'var(--color-bg-base)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            }}
          >
            {updatePending
              ? t('admin.nps.saving', 'Guardando...')
              : t('admin.nps.save', 'Guardar')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label
            className="block text-[11px] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--color-admin-text-muted)', letterSpacing: '0.1em' }}
          >
            {t('admin.nps.surveyQuestionLabel', 'Pregunta de la encuesta')}
          </label>
          <textarea
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            rows={3}
            maxLength={200}
            placeholder={t('admin.nps.surveyQuestion', '¿Qué tan probable es que nos recomiendes?')}
            className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none resize-none"
            style={{
              background: 'var(--color-bg-deep)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
          />
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.nps.surveyQuestionHint', 'Esta es la pregunta que ven los miembros. Las respuestas se califican del 1 al 5.')}
          </p>
        </div>

        {editingSurvey && (
          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.nps.startedAgo', 'Started')}{' '}
            {formatDistanceToNow(new Date(editingSurvey.created_at), { addSuffix: true, ...dateFnsLocale })}
          </p>
        )}
      </div>
    </AdminModal>
  );
}
