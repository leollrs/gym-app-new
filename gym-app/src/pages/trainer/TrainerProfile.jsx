import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Bell, Edit2, Check, X, Loader2,
  Camera, Shield, Trash2, Plus, Eye, Share2,
  Settings, Dumbbell, Star, Repeat,
  MapPin, Zap, Calendar,
} from 'lucide-react';
import ViewSwitcherModal from '../../components/ViewSwitcherModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { validateImageFile } from '../../lib/validateImage';
import { stripExif } from '../../lib/stripExif';
import AvatarPicker from '../../components/AvatarPicker';
import { TT, TFont, avatarIdx } from './components/designTokens';
import {
  TCard, TPill, TAvatar, TPrimaryButton, TDarkButton, TIconButton,
} from './components/designPrimitives';

const COVER_GRADIENT = 'linear-gradient(135deg, #FFB86B 0%, #FF7A3D 60%, #FF5A2E 100%)';
const AVATAR_GRADIENT = 'linear-gradient(135deg, #19B8B8 0%, #2EE0E0 100%)';

const DOW_LETTERS_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DOW_INDEX_TO_KEY = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 0: 'sun' };

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
const fmtPrice = (cents, currency = 'USD') => {
  if (cents == null || isNaN(cents)) return '—';
  const n = Math.round(cents) / 100;
  if (currency === 'USD' || !currency) return `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

const fmtTime12 = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const hr = ((h % 12) || 12);
  return `${hr}:${String(m || 0).padStart(2, '0')} ${period}`;
};

// Collapse contiguous days that share the same hours into a "Mon–Fri · 6:00 AM – 8:00 PM" string
function summarizeAvailability(availability, dayLabels) {
  if (!availability || typeof availability !== 'object') return '';
  // Build week order Mon..Sun (1..6,0)
  const order = [1, 2, 3, 4, 5, 6, 0];
  const cells = order.map(d => {
    const slot = availability[String(d)];
    if (slot && slot.open && slot.close) {
      return { d, label: dayLabels[DOW_INDEX_TO_KEY[d]], open: slot.open, close: slot.close };
    }
    return null;
  });
  // Group contiguous ranges with identical open/close
  const groups = [];
  let cur = null;
  for (const c of cells) {
    if (!c) { if (cur) { groups.push(cur); cur = null; } continue; }
    if (cur && cur.open === c.open && cur.close === c.close) {
      cur.end = c.label;
    } else {
      if (cur) groups.push(cur);
      cur = { start: c.label, end: c.label, open: c.open, close: c.close };
    }
  }
  if (cur) groups.push(cur);
  if (groups.length === 0) return '';
  return groups
    .map(g => {
      const range = g.start === g.end ? g.start : `${g.start}–${g.end}`;
      return `${range} · ${fmtTime12(g.open)} – ${fmtTime12(g.close)}`;
    })
    .join(' · ');
}

// ────────────────────────────────────────────────────────────────────
// Modal shell — center-aligned mid-page modal
// ────────────────────────────────────────────────────────────────────
function ModalShell({ open, onClose, title, children, footer, maxWidth = 460 }) {
  const { t } = useTranslation(['common']);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(11,15,18,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: TT.surface,
          borderRadius: 18,
          width: '100%', maxWidth, maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          boxShadow: TT.shadowLg,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: `1px solid ${TT.border}`,
          flexShrink: 0,
        }}>
          <div style={{
            fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
            color: TT.text, letterSpacing: -0.3,
          }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 999,
              border: 'none', background: TT.surface2, color: TT.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {children}
        </div>
        {footer && (
          <div style={{
            padding: '12px 16px', borderTop: `1px solid ${TT.border}`,
            display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  fontSize: 13.5, border: `1px solid ${TT.borderSolid}`,
  background: TT.surface, color: TT.text, outline: 'none',
  fontFamily: 'inherit',
};
const labelStyle = {
  fontSize: 11.5, fontWeight: 800, color: TT.textSub,
  letterSpacing: 0.4, textTransform: 'uppercase',
  marginBottom: 6, display: 'block',
};

// ────────────────────────────────────────────────────────────────────
// Edit Identity Modal
// ────────────────────────────────────────────────────────────────────
function EditIdentityModal({ open, onClose, profile, currentEmail, onSave, saving }) {
  const { t } = useTranslation(['pages', 'common']);
  const [draft, setDraft] = useState(() => ({
    full_name: profile?.full_name || '',
    username: profile?.username || '',
    email: currentEmail || '',
    phone_number: profile?.phone_number || '',
    trainer_pronouns: profile?.trainer_pronouns || '',
    trainer_location: profile?.trainer_location || '',
    trainer_years_exp: profile?.trainer_years_exp != null ? String(profile.trainer_years_exp) : '',
    bio: profile?.bio || '',
    trainer_tagline: profile?.trainer_tagline || '',
    trainer_default_rate: profile?.trainer_default_rate != null ? String(profile.trainer_default_rate) : '',
    trainer_rate_unit: profile?.trainer_rate_unit || 'month',
  }));

  const submit = () => {
    const phone = draft.phone_number.trim() || null;
    const email = draft.email.trim() || null;
    const updates = {
      full_name: draft.full_name.trim() || null,
      username: draft.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || null,
      phone_number: phone,
      trainer_pronouns: draft.trainer_pronouns.trim() || null,
      trainer_location: draft.trainer_location.trim() || null,
      trainer_years_exp: draft.trainer_years_exp.trim()
        ? Math.max(0, Math.min(80, parseInt(draft.trainer_years_exp, 10) || 0))
        : null,
      bio: draft.bio.trim() || null,
      trainer_tagline: draft.trainer_tagline.trim() || null,
      trainer_default_rate: draft.trainer_default_rate.trim() ? Math.max(0, Number(draft.trainer_default_rate) || 0) : null,
      trainer_rate_unit: draft.trainer_default_rate.trim() ? (draft.trainer_rate_unit || 'month') : null,
    };
    // Email is on auth.users, not profiles — pass it as a side-channel so the
    // parent can route it through supabase.auth.updateUser (verification email).
    onSave(updates, { email, originalEmail: currentEmail });
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('pages:trainerProfile.editIdentity.title', 'Edit profile')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'transparent', color: TT.textSub,
              border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('common:cancel', 'Cancel')}
          </button>
          <TPrimaryButton onClick={submit} disabled={saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={2.4} />}
            {saving ? t('common:saving', 'Saving...') : t('common:save', 'Save')}
          </TPrimaryButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>{t('pages:profile.fullName', 'Full name')}</label>
          <input
            type="text"
            value={draft.full_name}
            onChange={(e) => setDraft(d => ({ ...d, full_name: e.target.value }))}
            maxLength={80}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('pages:profile.username', 'Username')}</label>
          <input
            type="text"
            value={draft.username}
            onChange={(e) => setDraft(d => ({ ...d, username: e.target.value }))}
            maxLength={30}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.editIdentity.email', 'Email')}</label>
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft(d => ({ ...d, email: e.target.value }))}
            placeholder={t('pages:trainerProfile.editIdentity.emailPlaceholder', 'you@example.com')}
            maxLength={120}
            autoComplete="email"
            style={inputStyle}
          />
          {draft.email.trim().toLowerCase() !== (currentEmail || '').trim().toLowerCase() && draft.email.trim() && (
            <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 4, lineHeight: 1.4 }}>
              {t('pages:trainerProfile.editIdentity.emailHint', "We'll send a verification link to your new address.")}
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.editIdentity.phone', 'Phone')}</label>
          <input
            type="tel"
            value={draft.phone_number}
            onChange={(e) => setDraft(d => ({ ...d, phone_number: e.target.value }))}
            placeholder={t('pages:trainerProfile.editIdentity.phonePlaceholder', '+1 555 123 4567')}
            maxLength={20}
            autoComplete="tel"
            style={inputStyle}
          />
          <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 4, lineHeight: 1.4 }}>
            {t('pages:trainerProfile.editIdentity.phoneHint', 'Format: +1 followed by 10 digits.')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('pages:trainerProfile.editIdentity.pronouns', 'Pronouns')}</label>
            <input
              type="text"
              value={draft.trainer_pronouns}
              onChange={(e) => setDraft(d => ({ ...d, trainer_pronouns: e.target.value }))}
              placeholder={t('pages:trainerProfile.editIdentity.pronounsPlaceholder', 'she/her')}
              maxLength={20}
              style={inputStyle}
            />
          </div>
          <div style={{ width: 120 }}>
            <label style={labelStyle}>{t('pages:trainerProfile.editIdentity.years', 'Years exp')}</label>
            <input
              type="number"
              min="0" max="80"
              value={draft.trainer_years_exp}
              onChange={(e) => setDraft(d => ({ ...d, trainer_years_exp: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.editIdentity.location', 'Location')}</label>
          <input
            type="text"
            value={draft.trainer_location}
            onChange={(e) => setDraft(d => ({ ...d, trainer_location: e.target.value }))}
            placeholder={t('pages:trainerProfile.editIdentity.locationPlaceholder', 'San Juan, PR')}
            maxLength={80}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.editIdentity.rate', 'Your rate (optional)')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: TT.textSub }}>$</span>
              <input
                type="text" inputMode="decimal"
                value={draft.trainer_default_rate}
                onChange={(e) => setDraft(d => ({ ...d, trainer_default_rate: e.target.value.replace(/[^0-9.]/g, '') }))}
                placeholder={t('pages:trainerProfile.editIdentity.ratePlaceholder', 'e.g. 50')}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {['month', 'session'].map(u => {
                const on = (draft.trainer_rate_unit || 'month') === u;
                return (
                  <button key={u} type="button" onClick={() => setDraft(d => ({ ...d, trainer_rate_unit: u }))}
                    style={{ padding: '0 12px', borderRadius: 10, border: on ? 'none' : `1px solid ${TT.border}`, background: on ? TT.accent : TT.surface2, color: on ? '#fff' : TT.textSub, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {u === 'month' ? t('pages:trainerProfile.editIdentity.perMonth', '/mo') : t('pages:trainerProfile.editIdentity.perSession', '/sess')}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ fontSize: 11, color: TT.textMute, marginTop: 5 }}>
            {t('pages:trainerProfile.editIdentity.rateHint', 'Pre-fills new clients’ fees. Optional.')}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.editIdentity.tagline', 'Tagline')}</label>
          <input
            type="text"
            value={draft.trainer_tagline}
            onChange={(e) => setDraft(d => ({ ...d, trainer_tagline: e.target.value }))}
            maxLength={140}
            placeholder={t('pages:trainerProfile.editIdentity.taglinePlaceholder', 'One-line summary clients will see first')}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.bio', 'Bio')}</label>
          <textarea
            value={draft.bio}
            onChange={(e) => setDraft(d => ({ ...d, bio: e.target.value.slice(0, 500) }))}
            rows={4}
            placeholder={t('pages:trainerProfile.bioPlaceholder', 'Tell clients about yourself...')}
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>
      </div>
    </ModalShell>
  );
}

// ────────────────────────────────────────────────────────────────────
// Service Edit Modal
// ────────────────────────────────────────────────────────────────────
function ServiceEditModal({ open, onClose, service, onSave, onDelete, saving }) {
  const { t } = useTranslation(['pages', 'common']);
  const isNew = !service?.id;
  const [draft, setDraft] = useState(() => ({
    name: service?.name || '',
    duration_min: service?.duration_min || 60,
    price_dollars: service?.price_cents != null ? String(service.price_cents / 100) : '',
    description: service?.description || '',
    popular: !!service?.popular,
  }));

  const submit = () => {
    const priceVal = parseFloat(draft.price_dollars);
    if (!Number.isFinite(priceVal) || priceVal <= 0) return;
    if (!draft.name.trim()) return;
    const cents = Math.round(priceVal * 100);
    const next = {
      id: service?.id || `svc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: draft.name.trim(),
      duration_min: Math.max(5, Math.min(480, parseInt(draft.duration_min, 10) || 60)),
      price_cents: cents,
      currency: 'USD',
      description: draft.description.trim() || null,
      popular: !!draft.popular,
    };
    onSave(next);
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={isNew
        ? t('pages:trainerProfile.services.add', 'Add service')
        : t('pages:trainerProfile.services.edit', 'Edit service')}
      footer={
        <>
          {!isNew && (
            <button
              type="button"
              onClick={() => onDelete(service.id)}
              style={{
                padding: '10px 14px', borderRadius: 10,
                background: 'transparent', color: TT.hot,
                border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                marginRight: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <Trash2 size={12} /> {t('common:delete', 'Delete')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'transparent', color: TT.textSub,
              border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('common:cancel', 'Cancel')}
          </button>
          <TPrimaryButton onClick={submit} disabled={saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={2.4} />}
            {t('common:save', 'Save')}
          </TPrimaryButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.services.name', 'Service name')}</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))}
            maxLength={60}
            placeholder={t('pages:trainerProfile.services.namePlaceholder', '1-on-1 session')}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('pages:trainerProfile.services.duration', 'Duration (min)')}</label>
            <input
              type="number"
              min="5" max="480"
              value={draft.duration_min}
              onChange={(e) => setDraft(d => ({ ...d, duration_min: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('pages:trainerProfile.services.price', 'Price ($)')}</label>
            <input
              type="number"
              min="0" step="0.01"
              value={draft.price_dollars}
              onChange={(e) => setDraft(d => ({ ...d, price_dollars: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.services.description', 'Description')}</label>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft(d => ({ ...d, description: e.target.value.slice(0, 200) }))}
            rows={3}
            placeholder={t('pages:trainerProfile.services.descriptionPlaceholder', 'What clients should expect...')}
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 10,
          background: TT.surface2, cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={draft.popular}
            onChange={(e) => setDraft(d => ({ ...d, popular: e.target.checked }))}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>
            {t('pages:trainerProfile.services.popular', 'Mark as popular')}
          </span>
        </label>
      </div>
    </ModalShell>
  );
}

// ────────────────────────────────────────────────────────────────────
// Credential Edit Modal
// ────────────────────────────────────────────────────────────────────
function CredentialEditModal({ open, onClose, credential, idx, onSave, onDelete, saving }) {
  const { t } = useTranslation(['pages', 'common']);
  const isNew = idx == null;
  const [draft, setDraft] = useState(() => ({
    name: credential?.name || '',
    issuer: credential?.issuer || '',
    year: credential?.year != null ? String(credential.year) : '',
  }));

  const submit = () => {
    if (!draft.name.trim() || !draft.issuer.trim()) return;
    const next = {
      name: draft.name.trim(),
      issuer: draft.issuer.trim(),
      year: draft.year.trim() ? parseInt(draft.year, 10) || null : null,
      verified: credential?.verified || false,
    };
    onSave(next);
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={isNew
        ? t('pages:trainerProfile.credentials.add', 'Add credential')
        : t('pages:trainerProfile.credentials.edit', 'Edit credential')}
      footer={
        <>
          {!isNew && (
            <button
              type="button"
              onClick={() => onDelete(idx)}
              style={{
                padding: '10px 14px', borderRadius: 10,
                background: 'transparent', color: TT.hot,
                border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                marginRight: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <Trash2 size={12} /> {t('common:delete', 'Delete')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'transparent', color: TT.textSub,
              border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('common:cancel', 'Cancel')}
          </button>
          <TPrimaryButton onClick={submit} disabled={saving || !draft.name.trim()}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={2.4} />}
            {t('common:save', 'Save')}
          </TPrimaryButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.credentials.name', 'Name')}</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))}
            maxLength={60}
            placeholder={t('pages:trainerProfile.credentials.namePlaceholder', 'NSCA-CSCS')}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.credentials.issuer', 'Issuer')}</label>
          <input
            type="text"
            value={draft.issuer}
            onChange={(e) => setDraft(d => ({ ...d, issuer: e.target.value }))}
            maxLength={80}
            placeholder={t('pages:trainerProfile.credentials.issuerPlaceholder', 'Certified Strength & Conditioning Specialist')}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('pages:trainerProfile.credentials.year', 'Year')}</label>
          <input
            type="number"
            min="1950" max="2100"
            value={draft.year}
            onChange={(e) => setDraft(d => ({ ...d, year: e.target.value }))}
            style={{ ...inputStyle, maxWidth: 160 }}
          />
        </div>
        {credential?.verified && (
          <div style={{
            padding: 10, borderRadius: 10, background: TT.goodSoft,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Check size={14} style={{ color: TT.goodInk }} strokeWidth={3} />
            <div style={{ fontSize: 12, fontWeight: 700, color: TT.goodInk }}>
              {t('pages:trainerProfile.credentials.verifiedNote', 'Verified by gym admin')}
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ────────────────────────────────────────────────────────────────────
// Specialties Edit Modal
// ────────────────────────────────────────────────────────────────────
function SpecialtiesEditModal({ open, onClose, current, onSave, saving }) {
  const { t } = useTranslation(['pages', 'common']);
  const [items, setItems] = useState(() => (Array.isArray(current) ? [...current] : []));
  const [next, setNext] = useState('');

  const add = () => {
    const v = next.trim();
    if (v && !items.includes(v)) setItems(prev => [...prev, v]);
    setNext('');
  };
  const remove = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('pages:trainerProfile.specialties.editTitle', 'Edit specialties')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'transparent', color: TT.textSub,
              border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('common:cancel', 'Cancel')}
          </button>
          <TPrimaryButton onClick={() => onSave(items)} disabled={saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={2.4} />}
            {t('common:save', 'Save')}
          </TPrimaryButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map((s, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 999,
                background: TT.surface2, color: TT.text,
                fontSize: 12, fontWeight: 700,
                border: `1px solid ${TT.borderSolid}`,
              }}>
                {s}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={t('common:remove', 'Remove')}
                  style={{
                    background: 'transparent', border: 'none', padding: 0,
                    color: TT.textMute, cursor: 'pointer', display: 'flex',
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={t('pages:trainerProfile.specialtyPlaceholder', 'e.g. CrossFit L2, Yoga...')}
            maxLength={50}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={add}
            disabled={!next.trim()}
            aria-label={t('common:add', 'Add')}
            style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              border: `1px solid ${TT.borderSolid}`,
              background: TT.surface, color: TT.accent,
              cursor: next.trim() ? 'pointer' : 'not-allowed',
              opacity: next.trim() ? 1 : 0.4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ────────────────────────────────────────────────────────────────────
// Availability Edit Modal
// ────────────────────────────────────────────────────────────────────
function AvailabilityEditModal({ open, onClose, current, onSave, saving }) {
  const { t } = useTranslation(['pages', 'common']);
  const [draft, setDraft] = useState(() => {
    const start = {};
    [1, 2, 3, 4, 5, 6, 0].forEach(d => {
      const k = String(d);
      const slot = current?.[k];
      start[k] = {
        enabled: !!(slot && slot.open && slot.close),
        open: slot?.open || '06:00',
        close: slot?.close || '20:00',
      };
    });
    return start;
  });

  const submit = () => {
    const out = {};
    Object.entries(draft).forEach(([k, v]) => {
      if (v.enabled) out[k] = { open: v.open, close: v.close };
    });
    onSave(out);
  };

  const dayLabels = t('pages:trainerProfile.availability.days', { returnObjects: true, defaultValue: {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  }}) || {};

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('pages:trainerProfile.availability.edit', 'Edit hours')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'transparent', color: TT.textSub,
              border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('common:cancel', 'Cancel')}
          </button>
          <TPrimaryButton onClick={submit} disabled={saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={2.4} />}
            {t('common:save', 'Save')}
          </TPrimaryButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const k = String(d);
          const v = draft[k] || { enabled: false, open: '06:00', close: '20:00' };
          return (
            <div key={d} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 10,
              background: TT.surface2,
            }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: 130, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={v.enabled}
                  onChange={(e) => setDraft(prev => ({ ...prev, [k]: { ...v, enabled: e.target.checked } }))}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>
                  {dayLabels[DOW_INDEX_TO_KEY[d]] || DOW_INDEX_TO_KEY[d]}
                </span>
              </label>
              <input
                type="time"
                value={v.open}
                disabled={!v.enabled}
                onChange={(e) => setDraft(prev => ({ ...prev, [k]: { ...v, open: e.target.value } }))}
                style={{ ...inputStyle, flex: 1, opacity: v.enabled ? 1 : 0.4 }}
              />
              <span style={{ color: TT.textMute, fontWeight: 700 }}>–</span>
              <input
                type="time"
                value={v.close}
                disabled={!v.enabled}
                onChange={(e) => setDraft(prev => ({ ...prev, [k]: { ...v, close: e.target.value } }))}
                style={{ ...inputStyle, flex: 1, opacity: v.enabled ? 1 : 0.4 }}
              />
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

// ────────────────────────────────────────────────────────────────────
// Service row card
// ────────────────────────────────────────────────────────────────────
function ServiceRow({ svc, tone, soft, onClick }) {
  const { t } = useTranslation(['pages', 'common']);
  return (
    <TCard
      padded={0}
      style={{ overflow: 'hidden', cursor: 'pointer' }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div style={{ width: 4, background: tone, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: soft, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Dumbbell size={16} color={tone} strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: 800, color: TT.text,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {svc.name}
              </span>
              {svc.popular && <TPill tone="teal" size="s">{t('pages:trainerProfile.services.popular', 'POPULAR')}</TPill>}
            </div>
            <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 2 }}>
              {svc.duration_min} {t('common:min', 'min')}{svc.description ? ` · ${svc.description}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
              color: TT.text, letterSpacing: -0.4,
            }}>
              {fmtPrice(svc.price_cents, svc.currency)}
            </div>
            <ChevronRight size={14} style={{ color: TT.textMute }} />
          </div>
        </div>
      </div>
    </TCard>
  );
}

// ────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────
export default function TrainerProfile() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile, patchProfile, gymName, availableRoles } = useAuth();
  const hasMultipleViews = Array.isArray(availableRoles) && availableRoles.length > 1;
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);
  const { showToast } = useToast();
  const { t, i18n } = useTranslation(['pages', 'common']);

  // Set the browser tab title — without this it stays at whatever the
  // previous page had set (e.g. "Notificaciones | TuGymPR").
  useEffect(() => {
    const prev = document.title;
    document.title = `${t('trainerProfile.title', 'Profile')} | TuGymPR`;
    return () => { document.title = prev; };
  }, [t]);

  const [activeTab, setActiveTab] = useState('services');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Modals
  const [identityOpen, setIdentityOpen] = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [serviceModal, setServiceModal] = useState({ open: false, service: null });
  const [savingService, setSavingService] = useState(false);
  const [credModal, setCredModal] = useState({ open: false, credential: null, idx: null });
  const [savingCred, setSavingCred] = useState(false);
  const [specialtiesOpen, setSpecialtiesOpen] = useState(false);
  const [savingSpecialties, setSavingSpecialties] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Stats
  const [clientCount, setClientCount] = useState(0);
  const [sessionsThisMonth, setSessionsThisMonth] = useState(0);
  const [adherencePct, setAdherencePct] = useState(null);
  const [reviewSummary, setReviewSummary] = useState({ review_count: 0, avg_rating: null, five_pct: 0 });
  const [recentReviews, setRecentReviews] = useState([]);

  // (Account list / language / delete-account UX moved to /trainer/settings.)

  // ── Data fetching ────────────────────────
  useEffect(() => {
    if (!profile?.id) return;

    // Active clients
    supabase
      .from('trainer_clients')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', profile.id)
      .eq('is_active', true)
      .then(({ count }) => setClientCount(count || 0));

    // Sessions this month (completed)
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    supabase
      .from('trainer_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', profile.id)
      .eq('status', 'completed')
      .gte('started_at', monthStart.toISOString())
      .then(({ count }) => setSessionsThisMonth(count || 0));

    // Avg adherence — average of (completed/planned) across clients for the current week
    supabase
      .rpc('get_trainer_adherence', { p_trainer_id: profile.id })
      .then(({ data }) => {
        if (Array.isArray(data) && data.length) {
          const ratios = data
            .map(r => (r.planned_count > 0 ? r.completed_count / r.planned_count : null))
            .filter(v => v != null);
          if (ratios.length) {
            const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
            setAdherencePct(Math.round(Math.min(1, avg) * 100));
          }
        }
      });

    // Review summary
    supabase
      .rpc('get_trainer_review_summary', { p_trainer_id: profile.id })
      .then(({ data }) => {
        if (Array.isArray(data) && data.length) {
          const r = data[0];
          setReviewSummary({
            review_count: Number(r.review_count) || 0,
            avg_rating: r.avg_rating != null ? Number(r.avg_rating) : null,
            five_pct: r.five_pct != null ? Number(r.five_pct) : 0,
          });
        }
      });

    // Recent reviews (top 3) — separate query for the reviewer profile
    supabase
      .from('trainer_reviews')
      .select('id, rating, body, created_at, reviewer_id')
      .eq('trainer_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(async ({ data }) => {
        if (Array.isArray(data) && data.length) {
          const ids = [...new Set(data.map(r => r.reviewer_id))];
          const { data: reviewers } = await supabase
            .from('profiles')
            .select('id, full_name, username, avatar_url')
            .in('id', ids);
          const byId = new Map((reviewers || []).map(p => [p.id, p]));
          setRecentReviews(data.map(r => ({ ...r, reviewer: byId.get(r.reviewer_id) || null })));
        } else {
          setRecentReviews([]);
        }
      });
  }, [profile?.id]);

  // ── Helpers — JSONB column writes ────────
  const upsertColumn = useCallback(async (column, nextValue) => {
    const { error } = await supabase
      .from('profiles')
      .update({ [column]: nextValue })
      .eq('id', profile.id);
    if (error) throw error;
    patchProfile({ [column]: nextValue });
  }, [profile?.id, patchProfile]);

  // ── Avatar save (preserved from previous version) ──
  const handleAvatarSave = async ({ type, value, file }) => {
    setUploadingAvatar(true);
    try {
      if (type === 'photo' && file) {
        const validation = await validateImageFile(file);
        if (!validation.valid) {
          showToast(validation.error, 'error');
          setUploadingAvatar(false);
          return;
        }
        const cleanFile = await stripExif(file);
        const path = `${user.id}/${Date.now()}.jpg`;
        const { error: storageErr } = await supabase.storage
          .from('avatars')
          .upload(path, cleanFile, { upsert: true, contentType: 'image/jpeg' });
        if (storageErr) throw storageErr;
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ avatar_url: urlData.publicUrl, avatar_type: 'photo', avatar_value: null })
          .eq('id', user.id);
        if (updateErr) throw updateErr;
        patchProfile({ avatar_url: urlData.publicUrl, avatar_type: 'photo', avatar_value: null });
      } else {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ avatar_type: type, avatar_value: value })
          .eq('id', user.id);
        if (updateErr) throw updateErr;
        patchProfile({ avatar_type: type, avatar_value: value });
      }
      setAvatarPickerOpen(false);
      showToast(t('pages:profile.avatarUpdated', 'Avatar updated'), 'success');
      refreshProfile();
    } catch {
      showToast(t('pages:trainerProfile.avatarUploadError', 'Failed to upload avatar'), 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  // ── Cover upload ─────────────────────────
  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingCover(true);
    try {
      const validation = await validateImageFile(file);
      if (!validation.valid) {
        showToast(validation.error, 'error');
        return;
      }
      const cleanFile = await stripExif(file);
      const path = `${user.id}/cover-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('progress-photos')
        .upload(path, cleanFile, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('progress-photos').getPublicUrl(path);
      await upsertColumn('trainer_cover_url', urlData.publicUrl);
      showToast(t('pages:trainerProfile.cover.updated', 'Cover updated'), 'success');
    } catch (err) {
      showToast(err?.message || t('pages:trainerProfile.cover.uploadError', 'Failed to upload cover'), 'error');
    } finally {
      setUploadingCover(false);
    }
  };

  // ── Modal save handlers ──────────────────
  const saveIdentity = async (updates, sideChannel = {}) => {
    setSavingIdentity(true);
    try {
      // Phone validation matches member's Profile.jsx — `+1` + 10 digits or null.
      const phone = updates.phone_number;
      if (phone && !/^\+1\d{10}$/.test(phone.replace(/\s+/g, ''))) {
        showToast(t('pages:trainerProfile.editIdentity.phoneInvalid', 'Phone must be +1 followed by 10 digits'), 'error');
        setSavingIdentity(false);
        return;
      }
      // Normalize stored phone (strip whitespace).
      const normalizedUpdates = { ...updates };
      if (phone) normalizedUpdates.phone_number = phone.replace(/\s+/g, '');

      const { error } = await supabase.from('profiles').update(normalizedUpdates).eq('id', profile.id);
      if (error) throw error;
      Object.entries(normalizedUpdates).forEach(([k, v]) => patchProfile({ [k]: v }));

      // Email change goes through Supabase auth — sends a confirmation link
      // to the new address. The address only flips after the link is clicked.
      const newEmail = sideChannel.email;
      const oldEmail = sideChannel.originalEmail;
      if (newEmail && newEmail.toLowerCase() !== (oldEmail || '').toLowerCase()) {
        const { error: emailErr } = await supabase.auth.updateUser({ email: newEmail });
        if (emailErr) {
          // Profile updates already saved — surface the email error but don't roll back.
          showToast(emailErr.message || t('pages:trainerProfile.editIdentity.emailFailed', 'Email update failed'), 'error');
        } else {
          showToast(t('pages:trainerProfile.editIdentity.emailSent', 'Verification email sent. Check your inbox.'), 'success');
        }
      }

      await refreshProfile();
      setIdentityOpen(false);
      showToast(t('pages:trainerProfile.personalInfoSaved', 'Personal info updated'), 'success');
    } catch (err) {
      showToast(err?.message || t('pages:trainerProfile.personalInfoSaveError', 'Failed to save personal info'), 'error');
    } finally {
      setSavingIdentity(false);
    }
  };

  const saveService = async (svc) => {
    setSavingService(true);
    try {
      const list = Array.isArray(profile?.trainer_services) ? [...profile.trainer_services] : [];
      const idx = list.findIndex(s => s.id === svc.id);
      if (idx >= 0) list[idx] = svc; else list.push(svc);
      await upsertColumn('trainer_services', list);
      setServiceModal({ open: false, service: null });
      showToast(t('pages:trainerProfile.services.saved', 'Service saved'), 'success');
    } catch (err) {
      showToast(err?.message || t('pages:trainerProfile.services.saveError', 'Failed to save service'), 'error');
    } finally {
      setSavingService(false);
    }
  };

  const deleteService = async (id) => {
    setSavingService(true);
    try {
      const list = (Array.isArray(profile?.trainer_services) ? profile.trainer_services : [])
        .filter(s => s.id !== id);
      await upsertColumn('trainer_services', list);
      setServiceModal({ open: false, service: null });
      showToast(t('pages:trainerProfile.services.deleted', 'Service removed'), 'success');
    } catch (err) {
      showToast(err?.message || t('pages:trainerProfile.services.saveError', 'Failed to save service'), 'error');
    } finally {
      setSavingService(false);
    }
  };

  const saveCredential = async (cred) => {
    setSavingCred(true);
    try {
      const list = Array.isArray(profile?.trainer_credentials) ? [...profile.trainer_credentials] : [];
      if (credModal.idx != null) list[credModal.idx] = cred; else list.push(cred);
      await upsertColumn('trainer_credentials', list);
      setCredModal({ open: false, credential: null, idx: null });
      showToast(t('pages:trainerProfile.credentials.saved', 'Credential saved'), 'success');
    } catch (err) {
      showToast(err?.message || t('pages:trainerProfile.credentials.saveError', 'Failed to save credential'), 'error');
    } finally {
      setSavingCred(false);
    }
  };

  const deleteCredential = async (idx) => {
    setSavingCred(true);
    try {
      const list = (Array.isArray(profile?.trainer_credentials) ? profile.trainer_credentials : [])
        .filter((_, i) => i !== idx);
      await upsertColumn('trainer_credentials', list);
      setCredModal({ open: false, credential: null, idx: null });
      showToast(t('pages:trainerProfile.credentials.deleted', 'Credential removed'), 'success');
    } catch (err) {
      showToast(err?.message || t('pages:trainerProfile.credentials.saveError', 'Failed to save credential'), 'error');
    } finally {
      setSavingCred(false);
    }
  };

  const saveSpecialties = async (items) => {
    setSavingSpecialties(true);
    try {
      await upsertColumn('trainer_specialties', items);
      setSpecialtiesOpen(false);
      showToast(t('pages:trainerProfile.specialties.saved', 'Specialties updated'), 'success');
    } catch (err) {
      showToast(err?.message || t('pages:trainerProfile.specialties.saveError', 'Failed to save specialties'), 'error');
    } finally {
      setSavingSpecialties(false);
    }
  };

  const saveAvailability = async (next) => {
    setSavingAvailability(true);
    try {
      await upsertColumn('trainer_availability', next);
      setAvailabilityOpen(false);
      showToast(t('pages:trainerProfile.availability.saved', 'Hours updated'), 'success');
    } catch (err) {
      showToast(err?.message || t('pages:trainerProfile.availability.saveError', 'Failed to save hours'), 'error');
    } finally {
      setSavingAvailability(false);
    }
  };

  // (Account/sign-out/language/delete handlers live on /trainer/settings.)

  // ── Derived values ────────────────────────
  const displayName = profile?.full_name || profile?.username || t('pages:trainerProfile.trainerBadge', 'Trainer');
  const initial = (displayName || '?').trim()[0]?.toUpperCase() || 'T';
  const isVerified = !!profile?.trainer_verified;
  const services = Array.isArray(profile?.trainer_services) ? profile.trainer_services : [];
  const credentials = Array.isArray(profile?.trainer_credentials) ? profile.trainer_credentials : [];
  const specialties = Array.isArray(profile?.trainer_specialties) ? profile.trainer_specialties : [];
  const availability = (profile?.trainer_availability && typeof profile.trainer_availability === 'object')
    ? profile.trainer_availability : {};
  const topCredential = credentials[0]?.name || null;

  const dayLabelsFull = useMemo(() => (
    t('pages:trainerProfile.availability.days', { returnObjects: true, defaultValue: {
      mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
    } }) || {}
  ), [t, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayLabelShort = useMemo(() => (
    t('pages:trainerProfile.availability.daysShort', { returnObjects: true, defaultValue: {
      mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S',
    } }) || {}
  ), [t, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  const availabilitySummary = summarizeAvailability(availability, {
    mon: dayLabelsFull.mon || 'Mon',
    tue: dayLabelsFull.tue || 'Tue',
    wed: dayLabelsFull.wed || 'Wed',
    thu: dayLabelsFull.thu || 'Thu',
    fri: dayLabelsFull.fri || 'Fri',
    sat: dayLabelsFull.sat || 'Sat',
    sun: dayLabelsFull.sun || 'Sun',
  });

  // Rotate tones per service
  const TONE_ROTATION = [
    { tone: TT.accent, soft: TT.accentSoft },
    { tone: TT.coach,  soft: TT.coachSoft  },
    { tone: TT.hot,    soft: TT.hotSoft    },
    { tone: TT.warn,   soft: TT.warnSoft   },
  ];

  const reviewCount = reviewSummary.review_count;
  const ratingDisplay = reviewSummary.avg_rating != null
    ? Number(reviewSummary.avg_rating).toFixed(1)
    : '—';

  // ── Render ────────────────────────────────
  return (
    <div style={{ background: TT.bg, minHeight: '100%', paddingBottom: 100 }}>
      {/* ─────── COVER + AVATAR ─────── */}
      <div style={{ position: 'relative' }}>
        <div style={{
          height: 130,
          background: profile?.trainer_cover_url
            ? `url(${profile.trainer_cover_url}) center/cover, ${COVER_GRADIENT}`
            : COVER_GRADIENT,
          position: 'relative', overflow: 'hidden',
        }}>
          {!profile?.trainer_cover_url && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.18), transparent 50%)',
              pointerEvents: 'none',
            }} />
          )}
          {/* Top bar */}
          <div style={{
            position: 'absolute', top: 12, left: 16, right: 16, zIndex: 2,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t('pages:trainerProfile.goBack', 'Go back')}
              style={{
                width: 36, height: 36, borderRadius: 10, border: 'none',
                background: 'rgba(255,255,255,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <ChevronLeft size={18} color="#fff" strokeWidth={2.2} />
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/trainers/${profile?.id || ''}`;
                  if (navigator.share) {
                    navigator.share({ url, title: displayName }).catch(() => {});
                  } else {
                    navigator.clipboard?.writeText(url);
                    showToast(t('pages:trainerProfile.share.copied', 'Link copied'), 'success');
                  }
                }}
                aria-label={t('pages:trainerProfile.share.label', 'Share')}
                style={{
                  width: 36, height: 36, borderRadius: 10, border: 'none',
                  background: 'rgba(255,255,255,0.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Share2 size={16} color="#fff" strokeWidth={2} />
              </button>
              {hasMultipleViews && (
                <button
                  type="button"
                  onClick={() => setShowViewSwitcher(true)}
                  aria-label={t('common:viewSwitcher.title', 'Switch view')}
                  title={t('common:viewSwitcher.title', 'Switch view')}
                  style={{
                    width: 36, height: 36, borderRadius: 10, border: 'none',
                    background: 'rgba(255,255,255,0.22)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Repeat size={16} color="#fff" strokeWidth={2} />
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/trainer/settings')}
                aria-label={t('pages:trainerProfile.settings.general', 'Settings')}
                style={{
                  width: 36, height: 36, borderRadius: 10, border: 'none',
                  background: 'rgba(255,255,255,0.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Settings size={16} color="#fff" strokeWidth={2} />
              </button>
            </div>
          </div>
          {/* Edit cover pill */}
          <label style={{
            position: 'absolute', bottom: 12, right: 16, zIndex: 2,
            padding: '6px 10px', borderRadius: 999,
            background: 'rgba(0,0,0,0.35)', color: '#fff',
            fontSize: 10.5, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            cursor: 'pointer',
          }}>
            {uploadingCover
              ? <Loader2 size={11} color="#fff" className="animate-spin" />
              : <Camera size={11} color="#fff" strokeWidth={2.2} />}
            {t('pages:trainerProfile.cover.edit', 'Edit cover')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleCoverUpload}
              style={{ display: 'none' }}
              disabled={uploadingCover}
            />
          </label>
        </div>

        {/* Avatar */}
        <div style={{ position: 'absolute', left: 16, top: 80, zIndex: 3 }}>
          <div style={{ position: 'relative' }}>
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={displayName}
                style={{
                  width: 90, height: 90, borderRadius: 24,
                  border: `4px solid ${TT.bg === '#f0eee9' ? '#FAF7F0' : TT.bg}`,
                  objectFit: 'cover', display: 'block',
                }}
              />
            ) : (
              <div style={{
                width: 90, height: 90, borderRadius: 24,
                background: AVATAR_GRADIENT,
                border: `4px solid ${TT.bg === '#f0eee9' ? '#FAF7F0' : TT.bg}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: TFont.display, fontSize: 36, fontWeight: 900, color: '#06363B',
                letterSpacing: -1,
              }}>
                {initial}
              </div>
            )}
            {/* Camera button */}
            <button
              type="button"
              onClick={() => setAvatarPickerOpen(true)}
              disabled={uploadingAvatar}
              aria-label={t('pages:profile.editAvatar', 'Edit avatar')}
              style={{
                position: 'absolute', bottom: -2, right: -2,
                width: 28, height: 28, borderRadius: 999,
                background: TT.text, color: '#fff',
                border: `3px solid ${TT.bg === '#f0eee9' ? '#FAF7F0' : TT.bg}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              {uploadingAvatar
                ? <Loader2 size={12} color="#fff" className="animate-spin" />
                : <Camera size={12} color="#fff" strokeWidth={2.2} />}
            </button>
            {isVerified && (
              <div
                aria-label={t('pages:trainerProfile.verified', 'Verified')}
                style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 22, height: 22, borderRadius: 999,
                  background: TT.goodInk,
                  border: `2px solid ${TT.bg === '#f0eee9' ? '#FAF7F0' : TT.bg}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Check size={11} color="#fff" strokeWidth={3} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─────── IDENTITY ─────── */}
      <div className="max-w-3xl mx-auto" style={{ padding: '46px 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 26, fontWeight: 800,
              color: TT.text, letterSpacing: -1, lineHeight: 1.05,
            }}>
              {displayName}
            </div>
            <div style={{ fontSize: 12, color: TT.textSub, marginTop: 4 }}>
              {profile?.username ? `@${profile.username}` : ''}
              {profile?.username && profile?.trainer_pronouns ? ' · ' : ''}
              {profile?.trainer_pronouns || ''}
              {!profile?.username && !profile?.trainer_pronouns && gymName ? gymName : ''}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {topCredential && (
                <TPill tone="teal" size="s">
                  {t('pages:trainerProfile.certified', 'CERTIFIED')} · {topCredential}
                </TPill>
              )}
              {profile?.trainer_years_exp != null && profile?.trainer_years_exp > 0 && (
                <TPill tone="dark" size="s">
                  <Zap size={9} strokeWidth={2.4} />
                  {t('pages:trainerProfile.yrsExperience', '{{n}} yrs experience', { n: profile.trainer_years_exp })}
                </TPill>
              )}
              {profile?.trainer_location && (
                <TPill tone="outline" size="s">
                  <MapPin size={9} strokeWidth={2.4} />
                  {profile.trainer_location}
                </TPill>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIdentityOpen(true)}
            aria-label={t('pages:trainerProfile.editProfile', 'Edit profile')}
            style={{
              padding: '8px 12px', borderRadius: 10,
              border: `1px solid ${TT.borderSolid}`, background: TT.surface,
              fontSize: 12, fontWeight: 800, color: TT.text,
              display: 'inline-flex', alignItems: 'center', gap: 5,
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Edit2 size={13} strokeWidth={2.2} />
            {t('common:edit', 'Edit')}
          </button>
        </div>

        {/* Tagline */}
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 12,
          background: TT.surface, border: `1px solid ${TT.border}`,
        }}>
          <div style={{
            fontSize: 13, lineHeight: 1.4, fontStyle: 'italic',
            fontFamily: TFont.body,
            color: profile?.trainer_tagline ? TT.text : TT.textMute,
          }}>
            {profile?.trainer_tagline
              ? `"${profile.trainer_tagline}"`
              : t('pages:trainerProfile.editIdentity.taglinePlaceholder', 'One-line summary clients will see first')}
          </div>
        </div>
      </div>

      {/* ─────── PRIVATE BANNER ─────── */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          padding: '10px 12px', borderRadius: 12,
          background: TT.accentSoft, border: `1px solid ${TT.accent}33`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: TT.accent, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Eye size={14} color="#06363B" strokeWidth={2.4} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: TT.accentInk }}>
              {t('pages:trainerProfile.privateBanner.title', 'This is your private view')}
            </div>
            <div style={{ fontSize: 10.5, color: TT.accentInk, opacity: 0.7 }}>
              {t('pages:trainerProfile.privateBanner.body', 'Tap "Preview public" to see what clients see.')}
            </div>
          </div>
          <TDarkButton
            onClick={() => navigate(`/trainers/${profile?.id}`)}
            style={{ padding: '6px 10px', fontSize: 11, borderRadius: 8 }}
          >
            {t('pages:trainerProfile.privateBanner.preview', 'Preview')}
          </TDarkButton>
        </div>
      </div>

      {/* ─────── THIS MONTH ─────── */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
          color: TT.text, letterSpacing: -0.2, marginBottom: 8,
        }}>
          {t('pages:trainerProfile.thisMonth', 'This month')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[
            { v: clientCount, l: t('pages:trainerProfile.kpi.clients', 'Clients'), tone: TT.accent },
            { v: sessionsThisMonth, l: t('pages:trainerProfile.kpi.sessions', 'Sessions'), tone: TT.coach },
            {
              v: adherencePct != null ? `${adherencePct}%` : '—',
              l: t('pages:trainerProfile.kpi.adherence', 'Adh'),
              tone: TT.good,
            },
            {
              v: ratingDisplay,
              l: t('pages:trainerProfile.kpi.rating', 'Rating'),
              tone: '#E8C547', star: true,
            },
          ].map((s, i) => (
            <div key={i} style={{
              padding: '10px 6px', borderRadius: 10,
              background: TT.surface, border: `1px solid ${TT.border}`,
              textAlign: 'center',
            }}>
              <div style={{
                fontFamily: TFont.display, fontSize: 18, fontWeight: 800,
                color: s.tone, letterSpacing: -0.5, lineHeight: 1,
                display: 'inline-flex', alignItems: 'center', gap: 3, justifyContent: 'center',
              }}>
                {s.star && <Star size={12} fill={s.tone} stroke={s.tone} />}
                {s.v}
              </div>
              <div style={{
                fontSize: 9.5, color: TT.textSub, fontWeight: 700,
                marginTop: 5, letterSpacing: 0.5, textTransform: 'uppercase',
              }}>
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─────── TABS ─────── */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          display: 'flex', gap: 4, padding: 4,
          background: TT.surface, borderRadius: 12,
          border: `1px solid ${TT.border}`,
        }}>
          {[
            { id: 'services', label: t('pages:trainerProfile.tabs.services', 'Services') },
            { id: 'about', label: t('pages:trainerProfile.tabs.about', 'About') },
            { id: 'reviews', label: `${t('pages:trainerProfile.tabs.reviews', 'Reviews')} · ${reviewCount}` },
            { id: 'schedule', label: t('pages:trainerProfile.tabs.schedule', 'Schedule') },
          ].map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 8, textAlign: 'center',
                  background: active ? TT.text : 'transparent',
                  color: active ? '#fff' : TT.textSub,
                  fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                  minHeight: 32,
                }}
                aria-pressed={active}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─────── SERVICES TAB ─────── */}
      {activeTab === 'services' && (
        <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginBottom: 8,
          }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
              color: TT.text, letterSpacing: -0.2,
            }}>
              {t('pages:trainerProfile.services.title', 'Services & rates')}
            </div>
            <button
              type="button"
              onClick={() => setServiceModal({ open: true, service: null })}
              style={{
                fontSize: 11.5, color: TT.accent, fontWeight: 700,
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '4px 4px',
              }}
            >
              + {t('pages:trainerProfile.services.add', 'Add')}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {services.map((svc, i) => {
              const tones = TONE_ROTATION[i % TONE_ROTATION.length];
              return (
                <ServiceRow
                  key={svc.id || i}
                  svc={svc}
                  tone={tones.tone}
                  soft={tones.soft}
                  onClick={() => setServiceModal({ open: true, service: svc })}
                />
              );
            })}
            <button
              type="button"
              onClick={() => setServiceModal({ open: true, service: null })}
              style={{
                padding: '14px', borderRadius: 18,
                border: `1.5px dashed ${TT.borderSolid}`,
                background: 'transparent', color: TT.textSub,
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Plus size={14} strokeWidth={2.2} />
              {t('pages:trainerProfile.services.addAnother', '+ Add service')}
            </button>
          </div>
        </div>
      )}

      {/* ─────── ABOUT TAB (credentials, specialties, bio) ─────── */}
      {activeTab === 'about' && (
        <>
          {/* Credentials */}
          <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: 8,
            }}>
              <div style={{
                fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
                color: TT.text, letterSpacing: -0.2,
              }}>
                {t('pages:trainerProfile.credentials.title', 'Credentials')}
              </div>
              <button
                type="button"
                onClick={() => setCredModal({ open: true, credential: null, idx: null })}
                style={{
                  fontSize: 11.5, color: TT.accent, fontWeight: 700,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '4px 4px',
                }}
              >
                + {t('pages:trainerProfile.credentials.add', 'Add')}
              </button>
            </div>
            {credentials.length === 0 ? (
              <TCard padded={14}>
                <div style={{ fontSize: 12.5, color: TT.textMute, fontStyle: 'italic' }}>
                  {t('pages:trainerProfile.credentials.empty', 'No credentials yet. Add certifications to build trust with clients.')}
                </div>
              </TCard>
            ) : (
              <TCard padded={0}>
                {credentials.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCredModal({ open: true, credential: c, idx: i })}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px',
                      borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                      background: 'transparent', border: 'none', textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: c.verified ? TT.goodSoft : TT.surface2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Shield size={16} color={c.verified ? TT.goodInk : TT.textSub} strokeWidth={2.2} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: TT.text }}>{c.name}</div>
                        {c.verified && <Check size={12} color={TT.goodInk} strokeWidth={3} />}
                      </div>
                      {c.issuer && (
                        <div style={{ fontSize: 11, color: TT.textSub, marginTop: 1 }}>{c.issuer}</div>
                      )}
                      {c.year && (
                        <div style={{ fontSize: 10, color: TT.textMute, marginTop: 1 }}>
                          {c.year}{c.verified ? ` · ${t('pages:trainerProfile.credentials.verified', 'verified')}` : ''}
                        </div>
                      )}
                    </div>
                    <ChevronRight size={14} style={{ color: TT.textMute, flexShrink: 0 }} />
                  </button>
                ))}
              </TCard>
            )}
          </div>

          {/* Specialties */}
          <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
              color: TT.text, letterSpacing: -0.2, marginBottom: 8,
            }}>
              {t('pages:trainerProfile.specialties.title', 'Specialties')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {specialties.map((s, i) => (
                <span key={i} style={{
                  padding: '6px 10px', borderRadius: 999,
                  background: TT.surface, border: `1px solid ${TT.borderSolid}`,
                  fontSize: 11.5, fontWeight: 700, color: TT.text,
                }}>
                  {s}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setSpecialtiesOpen(true)}
                style={{
                  padding: '6px 10px', borderRadius: 999,
                  background: 'transparent', border: `1px dashed ${TT.borderSolid}`,
                  fontSize: 11.5, fontWeight: 700, color: TT.textSub,
                  cursor: 'pointer',
                }}
              >
                + {t('pages:trainerProfile.specialties.add', 'Add')}
              </button>
            </div>
          </div>

          {/* Bio (long form) */}
          {profile?.bio && (
            <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
              <div style={{
                fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
                color: TT.text, letterSpacing: -0.2, marginBottom: 8,
              }}>
                {t('pages:trainerProfile.about', 'About')}
              </div>
              <TCard padded={14}>
                <div style={{
                  fontSize: 13, color: TT.text, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                }}>
                  {profile.bio}
                </div>
              </TCard>
            </div>
          )}
        </>
      )}

      {/* ─────── REVIEWS TAB ─────── */}
      {activeTab === 'reviews' && (
        <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
          <div style={{
            fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
            color: TT.text, letterSpacing: -0.2, marginBottom: 8,
          }}>
            {t('pages:trainerProfile.reviews.recent', 'Recent reviews')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 36, fontWeight: 800,
              color: TT.text, letterSpacing: -1.2, lineHeight: 1,
            }}>
              {ratingDisplay}
            </div>
            <div>
              <div style={{ display: 'flex', gap: 1.5 }}>
                {[1, 2, 3, 4, 5].map(n => {
                  const filled = reviewSummary.avg_rating != null && Number(reviewSummary.avg_rating) >= n - 0.5;
                  return (
                    <Star
                      key={n}
                      size={14}
                      fill={filled ? '#E8C547' : 'none'}
                      stroke="#E8C547"
                      strokeWidth={2}
                    />
                  );
                })}
              </div>
              <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 2 }}>
                {t('pages:trainerProfile.reviews.summary', '{{count}} reviews · {{pct}}% recommend', {
                  count: reviewCount,
                  pct: Math.round(reviewSummary.five_pct || 0),
                })}
              </div>
            </div>
          </div>
          {recentReviews.length === 0 ? (
            <TCard padded={14}>
              <div style={{ fontSize: 12.5, color: TT.textMute, fontStyle: 'italic' }}>
                {t('pages:trainerProfile.reviews.empty', 'No reviews yet. Once clients rate you, they\'ll show up here.')}
              </div>
            </TCard>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentReviews.map((r, i) => {
                const reviewerName = r.reviewer?.full_name || r.reviewer?.username || t('pages:trainerProfile.reviews.anon', 'Anonymous');
                return (
                  <TCard key={r.id || i} padded={14}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <TAvatar name={reviewerName} size={28} idx={avatarIdx(r.reviewer_id)} src={r.reviewer?.avatar_url || undefined} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: TT.text }}>{reviewerName}</div>
                        <div style={{ fontSize: 10, color: TT.textMute }}>
                          {r.created_at ? new Date(r.created_at).toLocaleDateString(i18n.language) : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 1 }}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <Star
                            key={n}
                            size={11}
                            fill={n <= r.rating ? '#E8C547' : 'none'}
                            stroke="#E8C547"
                            strokeWidth={2}
                          />
                        ))}
                      </div>
                    </div>
                    {r.body && (
                      <div style={{ fontSize: 12, color: TT.text, lineHeight: 1.45, fontStyle: 'italic' }}>
                        "{r.body}"
                      </div>
                    )}
                  </TCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────── SCHEDULE TAB ─────── */}
      {activeTab === 'schedule' && (
        <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginBottom: 8,
          }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
              color: TT.text, letterSpacing: -0.2,
            }}>
              {t('pages:trainerProfile.availability.title', 'Availability')}
            </div>
            <button
              type="button"
              onClick={() => setAvailabilityOpen(true)}
              style={{
                fontSize: 11.5, color: TT.accent, fontWeight: 700,
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '4px 4px',
              }}
            >
              {t('pages:trainerProfile.availability.edit', 'Edit hours')} →
            </button>
          </div>
          <TCard padded={14}>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 4, marginBottom: 8,
            }}>
              {DOW_LETTERS_KEYS.map((key, i) => {
                const dow = i === 6 ? 0 : i + 1; // mon..sun → 1..6,0
                const slot = availability[String(dow)];
                const open = !!(slot && slot.open && slot.close);
                return (
                  <div key={i} style={{
                    aspectRatio: '1', borderRadius: 8,
                    background: open ? TT.accentSoft : TT.surface2,
                    border: open ? `1px solid ${TT.accent}55` : `1px solid ${TT.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
                    color: open ? TT.accentInk : TT.textMute,
                  }}>
                    {dayLabelShort[key] || key.charAt(0).toUpperCase()}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: TT.textSub, fontWeight: 700 }}>
              {availabilitySummary || t('pages:trainerProfile.availability.empty', 'No hours set')}
            </div>
          </TCard>

          {/* Schedule shortcut to existing calendar */}
          <button
            type="button"
            onClick={() => navigate('/trainer/calendar')}
            style={{
              marginTop: 10, width: '100%', padding: '12px',
              borderRadius: 12, background: TT.surface,
              border: `1px solid ${TT.border}`,
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: TT.accentSoft, color: TT.accentInk,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Calendar size={15} strokeWidth={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: TT.text }}>
                {t('pages:trainerProfile.schedule.openCalendar', 'Open full calendar')}
              </div>
              <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 1 }}>
                {t('pages:trainerProfile.schedule.openCalendarSub', 'See and manage all sessions')}
              </div>
            </div>
            <ChevronRight size={14} style={{ color: TT.textMute }} />
          </button>
        </div>
      )}

      {/* ─────── REVIEWS SNIPPET (always visible below tabs) ─────── */}
      {activeTab !== 'reviews' && reviewCount > 0 && (
        <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginBottom: 8,
          }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
              color: TT.text, letterSpacing: -0.2,
            }}>
              {t('pages:trainerProfile.reviews.recent', 'Recent reviews')}
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('reviews')}
              style={{
                fontSize: 11.5, color: TT.accent, fontWeight: 700,
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
            >
              {t('pages:trainerProfile.reviews.seeAll', 'See {{n}}', { n: reviewCount })} →
            </button>
          </div>
          {recentReviews[0] && (
            <TCard padded={14}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <TAvatar
                  name={recentReviews[0].reviewer?.full_name || recentReviews[0].reviewer?.username || '?'}
                  size={28}
                  idx={avatarIdx(recentReviews[0].reviewer_id)}
                  src={recentReviews[0].reviewer?.avatar_url || undefined}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: TT.text }}>
                    {recentReviews[0].reviewer?.full_name || recentReviews[0].reviewer?.username || t('pages:trainerProfile.reviews.anon', 'Anonymous')}
                  </div>
                  <div style={{ fontSize: 10, color: TT.textMute }}>
                    {recentReviews[0].created_at ? new Date(recentReviews[0].created_at).toLocaleDateString(i18n.language) : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 1 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <Star
                      key={n}
                      size={11}
                      fill={n <= recentReviews[0].rating ? '#E8C547' : 'none'}
                      stroke="#E8C547"
                      strokeWidth={2}
                    />
                  ))}
                </div>
              </div>
              {recentReviews[0].body && (
                <div style={{ fontSize: 12, color: TT.text, lineHeight: 1.45, fontStyle: 'italic' }}>
                  "{recentReviews[0].body}"
                </div>
              )}
            </TCard>
          )}
        </div>
      )}


      {/* ─────── MODALS ─────── */}
      <AvatarPicker
        isOpen={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        currentAvatar={{ type: profile?.avatar_type || 'color', value: profile?.avatar_value || '#6366F1' }}
        user={profile}
        onSave={handleAvatarSave}
        uploading={uploadingAvatar}
      />
      {identityOpen && (
        <EditIdentityModal
          open={identityOpen}
          onClose={() => setIdentityOpen(false)}
          profile={profile}
          currentEmail={user?.email}
          onSave={saveIdentity}
          saving={savingIdentity}
        />
      )}
      {serviceModal.open && (
        <ServiceEditModal
          key={serviceModal.service?.id || 'new'}
          open={serviceModal.open}
          onClose={() => setServiceModal({ open: false, service: null })}
          service={serviceModal.service}
          onSave={saveService}
          onDelete={deleteService}
          saving={savingService}
        />
      )}
      {credModal.open && (
        <CredentialEditModal
          key={credModal.idx ?? 'new'}
          open={credModal.open}
          onClose={() => setCredModal({ open: false, credential: null, idx: null })}
          credential={credModal.credential}
          idx={credModal.idx}
          onSave={saveCredential}
          onDelete={deleteCredential}
          saving={savingCred}
        />
      )}
      {specialtiesOpen && (
        <SpecialtiesEditModal
          open={specialtiesOpen}
          onClose={() => setSpecialtiesOpen(false)}
          current={specialties}
          onSave={saveSpecialties}
          saving={savingSpecialties}
        />
      )}
      {availabilityOpen && (
        <AvailabilityEditModal
          open={availabilityOpen}
          onClose={() => setAvailabilityOpen(false)}
          current={availability}
          onSave={saveAvailability}
          saving={savingAvailability}
        />
      )}
      <ViewSwitcherModal open={showViewSwitcher} onClose={() => setShowViewSwitcher(false)} />
    </div>
  );
}

