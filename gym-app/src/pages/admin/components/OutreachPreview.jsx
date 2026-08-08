// «Así lo ve tu socio» — el mensaje, en el sitio donde va a aparecer.
//
// Antes se escribía en una caja de texto gris y no se veía nada más. Con un
// diseño adjunto era peor: al correo le va la maqueta y al push el texto plano,
// y eso se explicaba con UNA FRASE en vez de enseñarlo. Aquí se enseña.
import { Bell, Smartphone, Mail, MessageSquare, Info } from 'lucide-react';
import { AdminCard } from '../../../components/admin';
import { PUSH_PREVIEW_CHARS, SMS_SEGMENT_CHARS, smsSegments } from '../../../lib/admin/outreachReach';

const ICONS = { push: Bell, inApp: Smartphone, email: Mail, sms: MessageSquare };

// Los merge tags se rellenan con una persona DE VERDAD de la audiencia. Con
// «{{first_name}}» a la vista nadie lee el mensaje, lee la plantilla.
function fill(text, { firstName, fullName, gymName }) {
  return (text || '')
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{name\}\}/g, fullName)
    .replace(/\{\{gym\}\}/g, gymName);
}

export default function OutreachPreview({
  channel, onChannel, activeChannels, channelName,
  subject, body, designerHtml, gymName, sampleRecipient, t,
}) {
  if (!activeChannels.length) return null;
  const active = activeChannels.includes(channel) ? channel : activeChannels[0];

  const fullName = sampleRecipient?.full_name || t('admin.outreach.previewSampleName', 'María Rodríguez');
  const firstName = fullName.split(' ')[0];
  const vars = { firstName, fullName, gymName: gymName || 'TuGymPR' };

  const text = fill(body, vars) || t('admin.outreach.previewEmpty', 'Escribe el mensaje y aparece aquí.');
  const subj = fill(subject, vars);
  const initials = (gymName || 'TG').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  const surface = { background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' };
  let stage = null;
  let note = '';

  if (active === 'push') {
    const cut = text.length > PUSH_PREVIEW_CHARS;
    const shown = cut ? `${text.slice(0, PUSH_PREVIEW_CHARS)}…` : text;
    stage = (
      <div className="rounded-xl p-3.5 flex flex-col items-center gap-2" style={surface}>
        <span className="text-[26px] font-light leading-none tabular-nums" style={{ color: 'var(--color-text-primary)' }}>9:41</span>
        <div className="w-full rounded-[14px] p-2.5 flex gap-2.5" style={{ background: 'var(--color-bg-hover)' }}>
          <span className="w-[26px] h-[26px] rounded-[7px] grid place-items-center text-[9.5px] font-bold flex-shrink-0"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{gymName || 'TuGymPR'}</span>
            <span className="block text-[11.5px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>{shown}</span>
          </span>
        </div>
      </div>
    );
    if (cut) note = t('admin.outreach.previewPushCut', { n: PUSH_PREVIEW_CHARS, defaultValue: 'Se corta a los {{n}} caracteres en la pantalla de bloqueo.' });
  } else if (active === 'inApp') {
    stage = (
      <div className="rounded-xl p-3 space-y-2" style={surface}>
        <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          <Smartphone size={11} /> {gymName || 'TuGymPR'}
        </div>
        <div className="rounded-[10px] p-2.5" style={{ background: 'var(--color-bg-hover)', borderLeft: '2px solid var(--color-accent)' }}>
          <p className="text-[12px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
            {subj || t('admin.outreach.previewInAppTitle', 'Mensaje del gimnasio')}
          </p>
          <p className="text-[11.5px] leading-snug whitespace-pre-wrap" style={{ color: 'var(--color-text-secondary)' }}>{text}</p>
        </div>
        {[70, 88, 52].map((w, i) => (
          <div key={i} className="h-[7px] rounded-full" style={{ width: `${w}%`, background: 'var(--color-bg-hover)' }} />
        ))}
      </div>
    );
    note = t('admin.outreach.previewInAppNote', 'No interrumpe: lo ve al abrir la app.');
  } else if (active === 'email') {
    stage = (
      <div className="rounded-xl overflow-hidden" style={surface}>
        <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--color-text-muted)' }}>
            <span className="w-[18px] h-[18px] rounded-[5px] grid place-items-center text-[8px] font-bold"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}>{initials}</span>
            {gymName || 'TuGymPR'}
          </div>
          <p className="text-[12.5px] font-bold mt-1.5 truncate" style={{ color: 'var(--color-text-primary)' }}>
            {subj || t('admin.outreach.previewNoSubject', 'Sin asunto')}
          </p>
        </div>
        {designerHtml ? (
          <div style={{ height: 220, overflow: 'hidden', background: '#f0eee9' }}>
            <iframe
              title="outreach-email-preview" srcDoc={designerHtml} scrolling="no" tabIndex={-1} aria-hidden="true"
              style={{ width: 640, height: 620, border: 0, transform: 'scale(0.44)', transformOrigin: 'top left', pointerEvents: 'none' }}
            />
          </div>
        ) : (
          <p className="px-3 py-3 text-[11.5px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text-secondary)' }}>{text}</p>
        )}
      </div>
    );
    if (designerHtml) note = t('admin.outreach.previewDesignNote', 'Con diseño adjunto el correo NO usa el cuerpo de texto — usa la maqueta.');
  } else {
    const segs = smsSegments(text);
    const first = text.slice(0, SMS_SEGMENT_CHARS);
    const rest = text.slice(SMS_SEGMENT_CHARS);
    stage = (
      <div className="rounded-xl p-3" style={surface}>
        <p className="rounded-[14px] rounded-bl-[4px] px-3 py-2 text-[11.5px] leading-snug whitespace-pre-wrap inline-block max-w-full"
          style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }}>{first}</p>
        {rest && (
          <p className="rounded-[14px] rounded-bl-[4px] px-3 py-2 mt-1.5 text-[11.5px] leading-snug whitespace-pre-wrap inline-block max-w-full"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border-default)' }}>{rest}</p>
        )}
        <p className="text-[10.5px] mt-2" style={{ color: 'var(--color-text-subtle)' }}>
          {t('admin.outreach.previewSmsMeta', { segs, chars: text.length, defaultValue: '{{segs}} mensaje(s) · {{chars}} caracteres' })}
        </p>
      </div>
    );
    if (segs > 1) note = t('admin.outreach.previewSmsSplit', 'Pasa de 160 caracteres: se cobra y llega como mensajes separados.');
  }

  return (
    <AdminCard padding="p-4">
      <span className="text-[11px] font-bold uppercase tracking-wider block mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
        {t('admin.outreach.previewTitle', 'Así lo ve tu socio')}
      </span>

      {activeChannels.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {activeChannels.map((c) => {
            const Icon = ICONS[c];
            const on = c === active;
            return (
              <button
                key={c} type="button" onClick={() => onChannel(c)}
                className="inline-flex items-center gap-1.5 px-2.5 h-[28px] rounded-lg text-[11.5px] font-semibold transition-colors"
                style={{
                  background: on ? 'color-mix(in srgb, var(--color-accent) 13%, transparent)' : 'var(--color-bg-deep)',
                  border: `1px solid ${on ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-border-subtle)'}`,
                  color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                <Icon size={12} /> {channelName(c)}
              </button>
            );
          })}
        </div>
      )}

      {stage}

      {note && (
        <div className="flex gap-2 mt-2.5 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>{note}</span>
        </div>
      )}
    </AdminCard>
  );
}
