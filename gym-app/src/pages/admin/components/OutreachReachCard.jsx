// «Alcance real» — el número que no puedes deducir mirando la pantalla.
//
// El resumen viejo repetía la audiencia y los canales elegidos. Este dice
// cuántos lo reciben DE VERDAD y, sobre todo, por qué los demás no.
import { Ban, Info, Bell, Smartphone, Mail, MessageSquare } from 'lucide-react';
import { AdminCard } from '../../../components/admin';

const ICONS = { push: Bell, inApp: Smartphone, email: Mail, sms: MessageSquare };

export default function OutreachReachCard({ reach, audienceLabel, channelName, missReason, compact = false, onEditChannels, t }) {
  const label = (
    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
      {t('admin.outreach.realReach', 'Alcance real')}
    </span>
  );

  // Sin canales todavía no hay alcance que enseñar, solo tamaño de grupo —
  // y decir «96» a secas invitaría a leerlo como «96 lo reciben».
  if (!reach.active.length) {
    return (
      <AdminCard padding="p-4">
        {label}
        <div className="flex items-end gap-3 mt-3">
          <span className="text-[38px] font-extrabold leading-none tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
            {reach.total}
          </span>
          <span className="text-[12px] leading-snug pb-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.outreach.inAudience', 'en la audiencia')}<br />
            <span style={{ color: 'var(--color-text-secondary)' }}>{audienceLabel}</span>
          </span>
        </div>
        <div className="flex gap-2 mt-3 pt-3 text-[11.5px] leading-relaxed" style={{ borderTop: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>{t('admin.outreach.reachHint', 'Elige canales y aquí verás cuántos lo reciben de verdad, no cuántos caen en el grupo.')}</span>
        </div>
      </AdminCard>
    );
  }

  // En el paso de escribir, la tarjeta se encoge a una línea: el sitio lo
  // necesita la vista previa, y a esas alturas el alcance ya está decidido.
  if (compact) {
    return (
      <AdminCard padding="p-3.5">
        <div className="flex items-center gap-3">
          <span className="text-[26px] font-extrabold leading-none tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
            {reach.unique}
          </span>
          <span className="text-[11.5px] leading-snug flex-1 min-w-0" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.outreach.ofNReceive', { total: reach.total, defaultValue: 'de {{total}} lo reciben' })}<br />
            <span className="truncate block" style={{ color: 'var(--color-text-subtle)' }}>
              {reach.active.map(channelName).join(' · ')}
            </span>
          </span>
          <button
            type="button"
            onClick={onEditChannels}
            className="px-2.5 h-[30px] rounded-lg text-[11.5px] font-semibold flex-shrink-0"
            style={{ border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            {t('admin.outreach.change', 'Cambiar')}
          </button>
        </div>
      </AdminCard>
    );
  }

  return (
    <AdminCard padding="p-4">
      {label}
      <div className="flex items-end gap-3 mt-3">
        <span className="text-[38px] font-extrabold leading-none tabular-nums" style={{ color: 'var(--color-accent)' }}>
          {reach.unique}
        </span>
        <span className="text-[12px] leading-snug pb-1" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.outreach.ofNAtLeastOne', {
            total: reach.total,
            defaultValue: 'de {{total}} reciben al menos un mensaje',
          })}
        </span>
      </div>

      <div className="mt-3.5 space-y-2">
        {reach.active.map((c) => {
          const Icon = ICONS[c];
          const pct = reach.total ? (reach.per[c] / reach.total) * 100 : 0;
          return (
            <div key={c} className="flex items-center gap-2.5">
              <span className="flex items-center gap-1.5 text-[11.5px] w-[74px] flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                <Icon size={12} /> {channelName(c)}
              </span>
              <span className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'var(--color-bg-deep)' }}>
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--color-accent)', transition: 'width 300ms ease' }} />
              </span>
              <span className="text-[12px] font-bold tabular-nums w-[34px] text-right flex-shrink-0" style={{ color: 'var(--color-text-primary)' }}>
                {reach.per[c]}
              </span>
            </div>
          );
        })}
      </div>

      {reach.missing.length > 0 && (
        <div className="flex gap-2 mt-3 pt-3 text-[11.5px] leading-relaxed" style={{ borderTop: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
          <Ban size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            {t('admin.outreach.cantReach', 'No los alcanzas:')}{' '}
            {reach.missing.map((m, i) => (
              <span key={m.channel}>
                {i > 0 && ' · '}
                <b style={{ color: 'var(--color-text-secondary)' }}>{m.count}</b> {missReason(m.channel)}
              </span>
            ))}.
          </span>
        </div>
      )}

      {/* El correo es el único canal cuya dirección el navegador no ve: vive en
          auth.users. El número de arriba cuenta el consentimiento, y el resto
          lo descuenta el servidor al enviar. Decirlo es más útil que redondear. */}
      {reach.active.includes('email') && (
        <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--color-text-subtle)' }}>
          {t('admin.outreach.emailCaveat', 'En correo eso es quien lo consiente. Quien no tenga dirección utilizable o haya rebotado se descuenta al enviar.')}
        </p>
      )}
    </AdminCard>
  );
}
