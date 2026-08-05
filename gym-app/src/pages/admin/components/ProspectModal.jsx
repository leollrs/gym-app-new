import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Search, X, UserPlus, Gift, AlertTriangle, MessageCircle, Copy, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { logAdminAction } from '../../../lib/adminAudit';
import { composeFullName, areNamePartsValid, splitFullName } from '../../../lib/admin/memberName';
import { validatePhone } from '../../../lib/admin/phoneValidation';
import { whatsappUrl } from '../../../lib/socialHandles';
import { AdminModal, Avatar, PhoneInput } from '../../../components/admin';
import { PROSPECT_SOURCES } from '../../../lib/admin/memberQueries';
import NameFields from './NameFields';

const EMPTY_NAME = { first: '', middle: '', last: '', second: '' };

const inputStyle = {
  background: 'var(--color-bg-input, var(--color-bg-elevated))',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
};

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
        {label}{required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-faint)' }}>{hint}</p>}
    </div>
  );
}

/**
 * Single-pick member search for "who brought them". Deliberately a NAME search,
 * not a referral-code field: at the front desk nobody is going to ask the member
 * who walked in with a friend to pull up their code.
 */
function ReferrerPicker({ gymId, value, onChange, t }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Búsqueda en el SERVIDOR. Con .limit(1000) + filtro en cliente, un gimnasio
  // que cruzara los 1000 miembros dejaba fuera del selector a todo el que
  // cayera después alfabéticamente — o sea, a esa gente no se le podía
  // atribuir un referido, que es justamente para lo que existe la ficha.
  const [refQuery, setRefQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setRefQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: members = [] } = useQuery({
    queryKey: ['admin', 'prospect-referrer-options', gymId, refQuery],
    queryFn: async () => {
      let q = supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false);
      // Sin texto se muestran los primeros por nombre, igual que antes.
      const safe = refQuery.replace(/[,()\\]/g, ' ').trim();
      if (safe) q = q.ilike('full_name', `%${safe}%`);
      const { data, error } = await q.order('full_name').limit(8);
      if (error) { logger.warn('ProspectModal: referrer options:', error); return []; }
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  // El filtrado ya lo hace el servidor (ilike + limit 8). Mientras el debounce
  // está en vuelo se siguen mostrando los resultados anteriores, que es el
  // comportamiento que se quiere en un desplegable de búsqueda.
  const filtered = members;

  if (value) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl" style={inputStyle}>
        <Avatar name={value.full_name} size="sm" src={value.avatar_url} />
        <span className="text-[13px] font-semibold flex-1 truncate" style={{ color: 'var(--color-text-primary)' }}>
          {value.full_name}
        </span>
        <button type="button" onClick={() => onChange(null)}
          aria-label={t('admin.prospects.clearReferrer', { defaultValue: 'Remove' })}
          className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-muted)' }}>
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={inputStyle}>
        <Search size={14} style={{ color: 'var(--color-text-faint)' }} />
        <input
          type="text"
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          placeholder={t('admin.prospects.referrerPlaceholder', { defaultValue: 'Search a member by name…' })}
          className="flex-1 bg-transparent outline-none text-[13px]"
          style={{ color: 'var(--color-text-primary)' }}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl overflow-hidden max-h-[240px] overflow-y-auto"
          style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', boxShadow: 'var(--shadow-card-hover)' }}>
          {filtered.map(m => (
            <button key={m.id} type="button"
              onClick={() => { onChange(m); setSearch(''); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--color-admin-panel)]">
              <Avatar name={m.full_name} size="sm" src={m.avatar_url} />
              <span className="text-[13px] truncate" style={{ color: 'var(--color-text-primary)' }}>{m.full_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Create / edit a prospect. `prospect` null means create.
 *
 * Contact consent is captured as a TIMESTAMP, not a boolean — the same shape as
 * profiles.terms_accepted_at (mig 0344). A boolean can't answer "when did they
 * agree", which is the only question that matters if anyone ever asks.
 */
export default function ProspectModal({ gymId, prospect = null, onClose, onSaved }) {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isEdit = !!prospect;
  const k = (key, fallback) => t(`admin.prospects.${key}`, { defaultValue: fallback });

  const [nameParts, setNameParts] = useState(() =>
    prospect?.full_name ? { ...EMPTY_NAME, ...splitFullName(prospect.full_name) } : EMPTY_NAME);
  const [phone, setPhone] = useState(prospect?.phone || '');
  const [email, setEmail] = useState(prospect?.email || '');
  const [source, setSource] = useState(prospect?.source || 'first_free_class');
  const [referrer, setReferrer] = useState(prospect?.referrer || null);
  const [visitedAt, setVisitedAt] = useState(() =>
    (prospect?.visited_at ? new Date(prospect.visited_at) : new Date()).toISOString().slice(0, 10));
  const [note, setNote] = useState(prospect?.note || '');
  // Consentimiento VIGENTE = aceptó y no ha revocado (mig 0690).
  const [consent, setConsent] = useState(
    !!prospect?.consent_contact_at && !prospect?.consent_revoked_at);
  const [saving, setSaving] = useState(false);
  // After a create we don't close — we show the access code so the desk can
  // send it while the person is still standing there.
  const [saved, setSaved] = useState(null);   // { id, access_code, full_name, phone }
  const [collision, setCollision] = useState(null);
  // Contador de secuencia para descartar respuestas de colisión obsoletas.
  const checkSeq = useRef(0);
  const [copied, setCopied] = useState(false);

  const fullName = composeFullName(nameParts);
  const namesOk = areNamePartsValid(nameParts);

  // Structural NANP check. `empty` stays quiet — the field is optional as long
  // as an email is given, and nagging before they've typed is noise.
  const phoneCheck = useMemo(() => validatePhone(phone), [phone]);
  const phoneBad = !!phone.trim() && !phoneCheck.ok;

  // visitedAt entra en el guard: el campo está marcado como requerido pero nada
  // lo exigía, y vaciarlo hacía que `new Date('T12:00:00')` fuera Invalid Date
  // y toISOString() lanzara un RangeError que llegaba al toast como el
  // críptico "Invalid time value", sin decir qué campo.
  const canSave = !!fullName && namesOk && (!!phone.trim() || !!email.trim())
    && !phoneBad && !!visitedAt && !saving;

  // Ask the server whether this contact is already a member or an earlier
  // prospect. Debounced, and it fails open — a lookup problem must never block
  // the desk from writing down a real person.
  useEffect(() => {
    const p = phone.trim();
    const e = email.trim();
    if (!p && !e) { setCollision(null); return undefined; }
    // Guarda de secuencia, igual que CreateInviteModal.jsx:57-58: sin ella una
    // respuesta en vuelo de una pulsación anterior podía pisar `collision` con
    // una coincidencia ya obsoleta. El clearTimeout solo cancela peticiones que
    // aún no han salido.
    checkSeq.current += 1;
    const seq = checkSeq.current;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('check_prospect_contact', {
          p_phone: p || null,
          p_email: e || null,
          p_exclude_prospect: prospect?.id ?? null,
        });
        if (seq !== checkSeq.current) return;
        if (error) { setCollision(null); return; }
        setCollision(data?.member || data?.prospect ? data : null);
      } catch { if (seq === checkSeq.current) setCollision(null); }
    }, 450);
    return () => clearTimeout(timer);
  }, [phone, email, prospect?.id]);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        gym_id: gymId,
        full_name: fullName,
        phone: phone.trim() || null,
        email: email.trim().toLowerCase() || null,
        source,
        referred_by_profile_id: referrer?.id || null,
        // Build from local date parts, never toISOString() on a date-only value
        // — that shifts the day backwards for anyone west of UTC.
        visited_at: new Date(`${visitedAt}T12:00:00`).toISOString(),
        note: note.trim() || null,
        // Revocar es un hecho NUEVO, no un borrado del anterior. Escribir null
        // sobre consent_contact_at destruía cuándo aceptó — que es lo único
        // que importa si alguien pregunta algún día.
        consent_contact_at: consent
          ? (prospect?.consent_contact_at || new Date().toISOString())
          : (prospect?.consent_contact_at ?? null),
        consent_revoked_at: consent
          ? null
          : (prospect?.consent_contact_at
              ? (prospect?.consent_revoked_at || new Date().toISOString())
              : null),
      };

      if (isEdit) {
        // .select('id'): sin esto, cero filas matcheadas resolvía con
        // error:null y la edición se anunciaba como guardada sin serlo.
        const { data: upd, error } = await supabase
          .from('gym_prospects').update(payload).eq('id', prospect.id).select('id');
        if (error) throw error;
        if (!upd || upd.length === 0) throw new Error('no rows matched');
        logAdminAction('update_prospect', 'prospect', prospect.id, { has_referrer: !!referrer });
        showToast(k('savedToast', 'Prospect saved'), 'success');
        onSaved?.();
        onClose();
      } else {
        const { data, error } = await supabase
          .from('gym_prospects')
          .insert({ ...payload, created_by: profile?.id ?? null })
          .select('id, access_code, full_name, phone')
          .single();
        if (error) throw error;
        logAdminAction('add_prospect', 'prospect', data?.id, { source, has_referrer: !!referrer });
        showToast(k('savedToast', 'Prospect saved'), 'success');
        onSaved?.();
        // Stay open on the code screen. Sending it IS the phone verification —
        // if it never arrives, the number was never real.
        setSaved(data);
      }
    } catch (err) {
      logger.error('ProspectModal: save failed:', err);
      showToast(err?.message || k('saveFailedToast', 'Could not save prospect'), 'error');
    }
    setSaving(false);
  };

  // Record which channel the code actually went out on. Best-effort: the code
  // exists either way, and a failed stamp must not look like a failed send.
  const markCodeSent = async (channel) => {
    // El error se destructura: el builder resuelve con {error} y nunca lanza,
    // así que un sello perdido era invisible — y el escalonado de seguimiento
    // trata un código sellado y uno sin sellar de forma distinta.
    const { error } = await supabase.from('gym_prospects')
      .update({ code_sent_at: new Date().toISOString(), code_channel: channel })
      .eq('id', saved.id);
    if (error) logger.warn('ProspectModal: code_sent stamp failed:', error.message);
    onSaved?.();
  };

  const codeMessage = k('codeMessage', 'Your code at the gym is {{code}}. Keep it — show it when you come back.', { code: saved?.access_code });

  const sendWhatsApp = () => {
    const url = whatsappUrl(saved.phone, codeMessage);
    if (!url) { showToast(k('noPhone', 'No phone number on file'), 'error'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
    markCodeSent('whatsapp');
  };

  const sendSms = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: { prospectId: saved.id, body: codeMessage, source: 'prospect_code' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      showToast(k('codeSent', 'Code sent'), 'success');
      markCodeSent('sms');
    } catch (err) {
      logger.error('ProspectModal: SMS send failed:', err);
      // The most likely cause right now is that send-sms hasn't been redeployed
      // with prospect support — say something the founder can act on.
      showToast(k('smsFailed', "Couldn't send by SMS — use WhatsApp, or redeploy send-sms"), 'error');
    }
  };

  if (saved) {
    return (
      <AdminModal
        isOpen
        onClose={onClose}
        title={k('codeTitle', 'Their code')}
        titleIcon={UserPlus}
        subtitle={k('codeSubtitle', 'Send it now — if it arrives, the number is real')}
        size="sm"
        footer={
          <button type="button" onClick={onClose}
            className="w-full px-4 py-2.5 rounded-xl text-[13px] font-bold"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}>
            {k('done', 'Done')}
          </button>
        }
      >
        <div className="space-y-4">
          <div className="text-center py-4 rounded-xl"
            style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-faint)' }}>
              {saved.full_name}
            </p>
            <p className="font-mono text-[30px] font-extrabold tracking-[0.18em] mt-1"
              style={{ color: 'var(--color-accent)' }}>
              {saved.access_code}
            </p>
          </div>

          <p className="text-[12.5px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
            {k('codeExplain', 'If they come back, enter this code at the desk and the visit is recorded. Someone who has come three times and still has not joined is the best lead you have.')}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={sendWhatsApp} disabled={!saved.phone}
              className="w-full px-4 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              style={{ background: '#25D366', color: '#fff' }}>
              <MessageCircle size={14} /> WhatsApp
            </button>
            <button type="button" onClick={sendSms} disabled={!saved.phone}
              className="w-full px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
              SMS
            </button>
          </div>

          <button type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(saved.access_code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch { /* clipboard blocked — the code is on screen anyway */ }
            }}
            className="w-full px-4 py-2 rounded-xl text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? k('copied', 'Copied') : k('copyCode', 'Copy code')}
          </button>
        </div>
      </AdminModal>
    );
  }

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title={isEdit ? k('editTitle', 'Edit prospect') : k('addTitle', 'New prospect')}
      titleIcon={UserPlus}
      subtitle={k('modalSubtitle', 'Someone who came in but isn\'t a member yet')}
      size="md"
      footer={
        <div className="grid grid-cols-2 gap-2 w-full">
          <button type="button" onClick={onClose}
            className="w-full px-4 py-2.5 rounded-xl text-[13px] font-semibold"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
            {k('cancel', 'Cancel')}
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave}
            className="w-full px-4 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}>
            {saving ? k('saving', 'Saving…') : k('save', 'Save prospect')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <NameFields value={nameParts} onChange={setNameParts} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={k('phone', 'Phone')}>
            <PhoneInput value={phone} onChange={setPhone} ariaLabel={k('phone', 'Phone')} />
          </Field>
          <Field label={k('email', 'Email')}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={inputStyle} />
          </Field>
        </div>
        {!phone.trim() && !email.trim() && (
          <p className="text-[11px] -mt-2" style={{ color: 'var(--color-text-faint)' }}>
            {k('contactRequired', 'Give at least a phone or an email — without one there is no follow-up.')}
          </p>
        )}

        {/* Structural, not a guess: an area code or exchange starting 0/1 is an
            impossible number, and 555-01XX is the block reserved for fiction. */}
        {phoneBad && (
          <p className="text-[11.5px] -mt-2 inline-flex items-center gap-1.5" style={{ color: 'var(--color-danger)' }}>
            <AlertTriangle size={12} />
            {k(`phoneError.${phoneCheck.reason}`, 'That phone number is not valid')}
          </p>
        )}

        {/* Already in the system. A member match means this isn't a prospect at
            all; a prospect match means they've been here before — which is the
            return visit, found without needing the code. */}
        {collision && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
            style={{ background: 'var(--color-warning-soft)', border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}>
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-warning-ink)' }} />
            <p className="text-[11.5px] leading-snug" style={{ color: 'var(--color-warning-ink)' }}>
              {collision.member
                ? k('alreadyMember', '{{name}} is already a member with this contact.', { name: collision.member.full_name })
                : k('alreadyProspect', '{{name}} came before ({{n}} visit(s)) — their code is {{code}}. Save anyway and you will have two records.', {
                    name: collision.prospect.full_name,
                    n: collision.prospect.visit_count,
                    code: collision.prospect.access_code,
                  })}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={k('sourceLabel', 'How did they come in?')} required>
            <select value={source} onChange={(e) => setSource(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={inputStyle}>
              {PROSPECT_SOURCES.map(s => (
                <option key={s} value={s}>{k(`source.${s}`, s)}</option>
              ))}
            </select>
          </Field>
          <Field label={k('visitedAt', 'Visit date')} required>
            <input type="date" value={visitedAt} onChange={(e) => setVisitedAt(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={inputStyle} />
          </Field>
        </div>

        <Field
          label={k('broughtByLabel', 'Brought by')}
          hint={k('broughtByHint', 'If a member brought them, pick them here — they get the referral credit automatically when this prospect becomes a member.')}
        >
          <ReferrerPicker gymId={gymId} value={referrer} onChange={setReferrer} t={t} />
        </Field>

        <Field label={k('note', 'Note')}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder={k('notePlaceholder', 'What did they say? What are they looking for?')}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none"
            style={inputStyle} />
        </Field>

        {/* Consent, unchecked by default. These are non-members whose contact
            details we are storing; the row is purged after 180 days if they
            never convert (mig 0681). */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 w-4 h-4 flex-shrink-0" style={{ accentColor: 'var(--color-accent)' }} />
          <span className="text-[12px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
            {k('consentLabel', 'They agreed to be contacted about membership.')}
          </span>
        </label>

        {referrer && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
            <Gift size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
            <p className="text-[11.5px] leading-snug" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.prospects.referralNotice', {
                name: referrer.full_name,
                defaultValue: '{{name}} will be credited with the referral when you convert this prospect into a member.',
              })}
            </p>
          </div>
        )}
      </div>
    </AdminModal>
  );
}
