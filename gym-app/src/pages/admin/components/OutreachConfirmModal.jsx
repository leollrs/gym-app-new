// Confirmar antes de enviar.
//
// Enviar es irreversible y no lo parecía: un botón normal, sin desglose ni
// confirmación, a trescientas personas. Este modal enseña lo que no cabe en el
// botón — a cuántos llega por canal, cuánto cuesta el SMS, quién queda fuera y
// qué van a leer — y recién entonces ofrece el envío.
import { Send, Clock, Loader2 } from 'lucide-react';
import AdminModal from '../../../components/admin/AdminModal';
import { smsCost, smsSegments } from '../../../lib/admin/outreachReach';

function KV({ k, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
      <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{k}</span>
      <span className="text-[12.5px] font-semibold text-right min-w-0" style={{ color: 'var(--color-text-primary)' }}>{children}</span>
    </div>
  );
}

export default function OutreachConfirmModal({
  reach, audienceLabel, channelName, missReason, subject, body,
  designerName, sending, onSend, onClose, t,
}) {
  const cost = reach.per.sms && reach.active.includes('sms') ? smsCost(reach.per.sms, body) : 0;

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      size="md"
      title={t('admin.outreach.confirmTitle', 'Confirmar envío')}
      subtitle={t('admin.outreach.confirmSubtitle', 'Esto no se puede deshacer. Lo que sale, sale.')}
      titleIcon={Send}
      footer={(
        <div className="grid grid-cols-2 gap-3 w-full">
          <button
            type="button" onClick={onClose} disabled={sending}
            className="h-[46px] rounded-xl text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
          >
            {t('admin.outreach.cancel', 'Cancelar')}
          </button>
          <button
            type="button" onClick={onSend} disabled={sending}
            className="h-[46px] rounded-xl text-[13px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {t('admin.outreach.confirmSend', { count: reach.unique, defaultValue: 'Enviar a {{count}}' })}
          </button>
        </div>
      )}
    >
      <div className="flex items-end gap-3 mb-4">
        <span className="text-[42px] font-extrabold leading-none tabular-nums" style={{ color: 'var(--color-accent)' }}>
          {reach.unique}
        </span>
        <span className="text-[12px] leading-snug pb-1" style={{ color: 'var(--color-text-muted)' }}>
          <b style={{ color: 'var(--color-text-primary)' }}>
            {t('admin.outreach.confirmPeople', { count: reach.unique, defaultValue: 'personas recibirán este mensaje' })}
          </b><br />
          {t('admin.outreach.confirmMessages', {
            messages: reach.messages, channels: reach.active.length,
            defaultValue: '{{messages}} mensajes en total por {{channels}} canal(es)',
          })}
        </span>
      </div>

      <KV k={t('admin.outreach.audienceLabel', 'Audiencia')}>
        {audienceLabel}
        <span className="block text-[11.5px] font-normal" style={{ color: 'var(--color-text-subtle)' }}>
          {t('admin.outreach.inGroup', { count: reach.total, defaultValue: '{{count}} en el grupo' })}
        </span>
      </KV>

      {reach.active.map((c) => (
        <KV key={c} k={channelName(c)}>
          {t('admin.outreach.nRecipients', { count: reach.per[c], defaultValue: '{{count}} destinatarios' })}
          {c === 'sms' && cost > 0 && (
            <span className="block text-[11.5px] font-bold" style={{ color: 'var(--color-warning, var(--color-accent))' }}>
              ${cost.toFixed(2)} {t('admin.outreach.inSms', { segs: smsSegments(body), defaultValue: 'en SMS · {{segs}} tramo(s) por persona' })}
            </span>
          )}
        </KV>
      ))}

      {reach.missing.length > 0 && (
        <KV k={t('admin.outreach.leftOut', 'Quedan fuera')}>
          <span className="font-normal text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
            {reach.missing.map(m => `${m.count} ${missReason(m.channel)}`).join(' · ')}
          </span>
        </KV>
      )}

      {designerName && (
        <KV k={t('admin.outreach.channelEmailShort', 'Correo')}>
          {t('admin.outreach.withDesign', { name: designerName, defaultValue: 'Diseño «{{name}}»' })}
        </KV>
      )}

      <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
        <p className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
          {t('admin.outreach.whatTheyRead', 'Lo que van a leer')}
        </p>
        {subject && <p className="text-[12.5px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>{subject}</p>}
        <p className="text-[12px] leading-relaxed whitespace-pre-wrap max-h-[110px] overflow-auto" style={{ color: 'var(--color-text-secondary)' }}>
          {body || t('admin.outreach.bodyIsDesign', '(el correo usa el diseño adjunto)')}
        </p>
      </div>

      <div className="flex gap-2 mt-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        <Clock size={14} className="flex-shrink-0 mt-0.5" />
        <span>{t('admin.outreach.confirmRateNote', 'El correo sale por la cola del servidor: puedes cerrar esta página. Quien se dio de baja de promocionales queda fuera aunque esté en la audiencia.')}</span>
      </div>
    </AdminModal>
  );
}
