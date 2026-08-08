// Detalle de una invitación pendiente + reenvío.
//
// Antes la fila solo dejaba copiar el código, ver el QR o borrarla: si alguien
// no aparecía, el admin no podía ni comprobar a qué correo se mandó ni volver a
// mandarla. Tenía que borrarla y crearla otra vez — con un código NUEVO, que
// invalida el que ya le habías dicho por teléfono.
//
// Los canales se derivan de lo que la invitación TIENE (ver
// InviteResendButtons). Un botón de correo en una invitación sin correo es un
// botón que miente; allí sencillamente no está.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, Loader2, Clock, CheckCircle, XCircle, Share2, Pencil, X, Send, PlusCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { format, differenceInDays } from 'date-fns';
import AdminModal from '../../../components/admin/AdminModal';
import { inviteUrl as buildInviteUrl } from '../../../lib/appUrls';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { validateEmail } from '../../../lib/validateEmail';
import { logAdminAction } from '../../../lib/adminAudit';
import logger from '../../../lib/logger';
import InviteResendButtons from './InviteResendButtons';
import { inviteChannels } from '../../../lib/admin/inviteChannels';

function Row({ label, children }) {
  return (
    <div className="flex items-baseline gap-3 py-2 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
      <span className="text-[11px] uppercase tracking-wider flex-shrink-0 w-[110px]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="text-[13px] flex-1 min-w-0 break-words" style={{ color: 'var(--color-text-primary)' }}>{children}</span>
    </div>
  );
}

function SectionLabel({ children, action }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>{children}</span>
      <span className="flex-1 h-px" style={{ background: 'var(--color-border-subtle)' }} />
      {action}
    </div>
  );
}

// ── Historial de envíos ────────────────────────────────────────────────────
// «¿Se la mandé o no?» es la pregunta que trae al admin a este modal, y hasta
// ahora la pantalla no la contestaba: enseñaba el estado actual y nada de lo
// que había pasado. Sale del registro de acciones, la misma tabla que lee la
// consola de plataforma, filtrada por esta invitación.
const HISTORY_ACTIONS = ['send_invite', 'resend_invite', 'update_invite'];

function InviteHistory({ invite, gymId, dateFnsLocale, k }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['admin', 'invite-history', invite.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_audit_log')
        .select('id, action, details, created_at')
        .eq('gym_id', gymId)
        .eq('entity_id', invite.id)
        .in('action', HISTORY_ACTIONS)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) { logger.error('invite history failed:', error); return []; }
      return data || [];
    },
    enabled: !!gymId && !!invite.id,
    staleTime: 15_000,
  });

  const chan = (c) => ({
    email: k('email', 'Correo'), sms: 'SMS', whatsapp: 'WhatsApp',
  }[c] || c || '');

  const when = (d) => {
    try { return format(new Date(d), 'd MMM, p', dateFnsLocale); } catch { return ''; }
  };

  // La creación no se registra con el id de la invitación, así que se sintetiza
  // de la propia fila — es un dato que ya tenemos y cierra la línea de tiempo.
  const entries = [
    ...rows.map((r) => ({
      id: r.id,
      icon: r.action === 'update_invite' ? Pencil : Send,
      tone: r.action === 'update_invite' ? 'var(--color-text-muted)' : 'var(--color-success)',
      text: r.action === 'update_invite'
        ? k('hUpdated', 'Datos corregidos')
        : `${r.action === 'send_invite' ? k('hSent', 'Enviada') : k('hResent', 'Reenviada')} ${k('hVia', 'por')} ${chan(r.details?.channel)}`,
      at: when(r.created_at),
    })),
    {
      id: 'created',
      icon: PlusCircle,
      tone: 'var(--color-text-muted)',
      text: k('hCreated', 'Invitación creada'),
      at: when(invite.created_at),
    },
  ];

  return (
    <div>
      <SectionLabel>{k('history', 'Historial')}</SectionLabel>
      {isLoading ? (
        <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => {
            const Icon = e.icon;
            return (
              <li key={e.id} className="flex items-center gap-2.5 text-[12px]">
                <Icon size={13} style={{ color: e.tone, flexShrink: 0 }} />
                <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text-secondary)' }}>{e.text}</span>
                <span className="tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>{e.at}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function InviteDetailModal({ invite, status, gymId, dateFnsLocale, onClose, onSaved }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const k = (key, fallback) => t(`admin.inviteDetail.${key}`, fallback);

  const [copied, setCopied] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  // El padre monta este modal con key={id}, así que el estado inicial basta:
  // abrir otra invitación remonta el componente en vez de reciclarlo con los
  // valores de la anterior dentro.
  const [form, setForm] = useState({
    member_name: invite?.member_name || '',
    email: invite?.email || '',
    phone: invite?.phone || '',
  });

  if (!invite) return null;

  const url = buildInviteUrl(invite.invite_code);
  const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null;
  const daysLeft = expiresAt && status === 'pending' ? differenceInDays(expiresAt, new Date()) : null;
  const fmt = (d) => (d ? format(new Date(d), 'PPP', dateFnsLocale) : '—');

  // Guardar los datos de contacto. El caso real es tecleaste mal el correo y la
  // invitación nunca llegó: antes había que borrarla y crear otra, lo que cambia
  // el código y deja inútil el que ya diste.
  const save = async () => {
    const name = form.member_name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();

    // Sin correo ni teléfono no hay a dónde reenviar; guardarlo así dejaría una
    // invitación que solo se puede entregar a mano, en silencio.
    if (!email && !phone) {
      setFormError(k('needContact', 'Hace falta un correo o un teléfono.'));
      return;
    }
    if (email) {
      const v = validateEmail(email);
      if (!v.valid) { setFormError(v.reason); return; }
    }

    setFormError(null);
    setSaving(true);
    // El builder de supabase RESUELVE con { error } en vez de lanzar, así que
    // esto se comprueba a mano — un try/catch aquí no vería nada.
    const { error } = await supabase
      .from('gym_invites')
      .update({ member_name: name || null, email: email || null, phone: phone || null })
      .eq('id', invite.id)
      .eq('gym_id', gymId);
    setSaving(false);

    if (error) {
      logger.error('Failed to update invite:', error);
      showToast(k('saveFailed', 'No se pudo guardar'), 'error');
      return;
    }
    logAdminAction('update_invite', 'invite', invite.id, {
      changed: ['member_name', 'email', 'phone'].filter((f) => (invite[f] || '') !== ({ member_name: name, email, phone })[f]),
    });
    setEditing(false);
    showToast(k('saved', 'Guardado'), 'success');
    onSaved?.({ ...invite, member_name: name || null, email: email || null, phone: phone || null });
  };

  const cancelEdit = () => {
    setForm({ member_name: invite.member_name || '', email: invite.email || '', phone: invite.phone || '' });
    setFormError(null);
    setEditing(false);
  };

  const copy = async (what, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch (err) {
      logger.error('copy failed:', err);
    }
  };

  const share = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: k('shareTitle', 'Invitación'), text: invite.invite_code, url });
      } else if (navigator.share) {
        await navigator.share({ title: k('shareTitle', 'Invitación'), text: invite.invite_code, url });
      } else {
        copy('link', url);
      }
    } catch { /* el usuario canceló la hoja de compartir */ }
  };

  const StatusIcon = status === 'claimed' ? CheckCircle : status === 'expired' ? XCircle : Clock;
  // Variables del tema, NO hexadecimales. Metí un dorado fijo y en un gimnasio
  // con la marca en rojo el modal quedaba de otro color que todos sus vecinos.
  // --color-accent lo pone applyBranding() con el color del gimnasio.
  const statusColor = status === 'claimed'
    ? 'var(--color-success)'
    : status === 'expired' ? 'var(--color-danger)' : 'var(--color-accent)';
  const statusLabel = status === 'claimed'
    ? k('claimed', 'Reclamada')
    : status === 'expired'
      ? k('expired', 'Vencida')
      : daysLeft !== null
        ? `${k('pending', 'Pendiente')} · ${daysLeft}${k('daysLeftShort', 'd')}`
        : k('pending', 'Pendiente');

  // Una invitación ya reclamada o vencida no se reenvía: el enlace no serviría
  // de nada y el admin se quedaría esperando a alguien que no puede entrar.
  const canResend = status === 'pending';
  const hasContact = inviteChannels(invite).length > 0;

  const btn = 'flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[42px]';
  const btnStyle = { background: 'var(--color-bg-hover)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' };
  const inputCls = 'w-full rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]';
  const inputStyle = { background: 'var(--color-bg-input)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-primary)' };

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title={invite.member_name || k('unnamed', 'Sin nombre')}
      titleIcon={StatusIcon}
      subtitle={statusLabel}
      size="md"
      // El pie solo existe mientras se edita, con Cancelar / Guardar al 50-50
      // como el resto de los modales. Antes «Editar» vivía ahí solo, alineado a
      // la derecha, colgando debajo de todo sin nada que lo acompañara: ahora
      // es un botón pequeño junto a los datos que edita.
      footer={editing ? (
        <div className="grid grid-cols-2 gap-3 w-full">
          <button className={btn} style={btnStyle} onClick={cancelEdit} disabled={saving}>
            <X size={13} /> {k('cancel', 'Cancelar')}
          </button>
          <button className={btn} onClick={save} disabled={saving}
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)', border: '1px solid var(--color-accent)' }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {k('save', 'Guardar cambios')}
          </button>
        </div>
      ) : null}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
          {/* El código DEBAJO del QR: son la misma llave en dos formatos. Suelto
              en la lista de datos parecía un campo más entre el correo y la
              fecha, cuando es lo único que el socio necesita si el QR falla. */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <div className="bg-white p-3 rounded-xl">
              <QRCodeSVG value={url} size={132} level="H" />
            </div>
            <code className="font-mono tracking-[0.18em] text-[15px] leading-none" style={{ color: statusColor }}>
              {invite.invite_code}
            </code>
          </div>

          <div className="flex-1 min-w-0 w-full">
            <SectionLabel
              action={!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 px-2 h-[26px] rounded-lg text-[11.5px] font-semibold transition-colors"
                  style={{ background: 'var(--color-bg-hover)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                >
                  <Pencil size={11} /> {k('edit', 'Editar')}
                </button>
              ) : null}
            >
              {k('details', 'Datos')}
            </SectionLabel>

            <Row label={k('name', 'Nombre')}>
              {editing
                ? <input className={inputCls} style={inputStyle} value={form.member_name} autoFocus
                    onChange={(e) => setForm((f) => ({ ...f, member_name: e.target.value }))}
                    placeholder={k('unnamed', 'Sin nombre')} />
                : (invite.member_name || '—')}
            </Row>
            <Row label={k('email', 'Correo')}>
              {editing
                ? <input className={inputCls} style={inputStyle} type="email" inputMode="email" value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="nombre@correo.com" />
                : (invite.email || '—')}
            </Row>
            <Row label={k('phone', 'Teléfono')}>
              {editing
                ? <input className={inputCls} style={inputStyle} type="tel" inputMode="tel" value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+1 787 555 0100" />
                : (invite.phone || '—')}
            </Row>
            <Row label={k('created', 'Creada')}>{fmt(invite.created_at)}</Row>
            <Row label={k('expires', 'Vence')}>{fmt(invite.expires_at)}</Row>

            {formError && (
              <p className="text-[12px] mt-2" style={{ color: 'var(--color-danger)' }}>{formError}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button className={btn} style={btnStyle} onClick={() => copy('code', invite.invite_code)}>
            {copied === 'code' ? <Check size={14} /> : <Copy size={14} />} {k('copyCode', 'Copiar código')}
          </button>
          <button className={btn} style={btnStyle} onClick={() => copy('link', url)}>
            {copied === 'link' ? <Check size={14} /> : <Copy size={14} />} {k('copyLink', 'Copiar enlace')}
          </button>
        </div>

        {/* Mientras se edita, reenviar iría al correo VIEJO — el de la fila, no
            el que estás escribiendo. Se oculta hasta guardar en vez de mandar a
            un sitio que el admin ya cree haber cambiado. */}
        {!editing && canResend && hasContact && (
          <div>
            <SectionLabel>{k('resendVia', 'Reenviar por')}</SectionLabel>
            <InviteResendButtons invite={invite} />
            <button className={`${btn} w-full mt-2`} style={btnStyle} onClick={share}>
              <Share2 size={14} /> {k('share', 'Compartir')}
            </button>
          </div>
        )}

        {!editing && canResend && !hasContact && (
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {k('noContact', 'Esta invitación no tiene correo ni teléfono, así que no hay a dónde reenviarla. Copia el código o el enlace y dáselo a mano.')}
          </p>
        )}

        {!editing && !canResend && (
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {status === 'claimed'
              ? k('alreadyClaimed', 'Ya la reclamaron — no hace falta reenviarla.')
              : k('alreadyExpired', 'Está vencida: el enlace ya no funciona. Crea una invitación nueva.')}
          </p>
        )}

        {!editing && <InviteHistory invite={invite} gymId={gymId} dateFnsLocale={dateFnsLocale} k={k} />}
      </div>
    </AdminModal>
  );
}
