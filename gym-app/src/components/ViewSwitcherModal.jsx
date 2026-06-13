import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, X, User, Dumbbell, Shield, Star } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const ROLE_META = {
  member:      { Icon: User,     landing: '/' },
  trainer:     { Icon: Dumbbell, landing: '/trainer' },
  admin:       { Icon: Shield,   landing: '/admin' },
  // Landing must match PlatformLayout's primary tab — /platform/operations was
  // the pre-Attention landing and left switchers on a secondary page.
  super_admin: { Icon: Star,     landing: '/platform/attention' },
};

/**
 * Modal that lists every role the user is entitled to and lets them flip
 * between experiences. After switching, navigates to that role's landing
 * route so the URL matches what's now rendering.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <ViewSwitcherModal open={open} onClose={() => setOpen(false)} />
 */
export default function ViewSwitcherModal({ open, onClose }) {
  const { t } = useTranslation(['common', 'pages']);
  const { availableRoles, activeView, switchView } = useAuth();
  const navigate = useNavigate();

  // Close on Esc, lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  // Hide the switcher entirely if the user only has one view.
  if (!availableRoles || availableRoles.length < 2) {
    onClose();
    return null;
  }

  const handleSwitch = async (role) => {
    if (role === activeView) { onClose(); return; }
    // CRITICAL: switchView is async (it runs get_effective_roles server-side
    // before flipping setActiveView). Previously we assigned the unresolved
    // Promise to `ok` — always truthy — and navigated immediately. On slow
    // networks ProtectedRoute / AdminRoute / TrainerRoute then read the OLD
    // activeView and bounced the user back to their previous experience.
    // Awaiting the boolean result fixes the race and also lets us honor a
    // server-side rejection (get_effective_roles returning false) by simply
    // closing without navigation.
    const ok = await switchView(role);
    if (!ok) { onClose(); return; }
    onClose();
    const landing = ROLE_META[role]?.landing || '/';
    // Use replace so the user can't back-button into the previous view's
    // URL (which the new view's guards would just bounce away anyway).
    navigate(landing, { replace: true });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(8,10,14,0.6)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="view-switcher-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380,
          background: 'var(--color-bg-card, #fff)',
          color: 'var(--color-text-primary, #0B0F12)',
          borderRadius: 18,
          padding: '18px 18px 14px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--color-accent, #19B8B8)' }}>
              {t('common:viewSwitcher.eyebrow', 'Switch view')}
            </div>
            <div id="view-switcher-title" style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.4, marginTop: 4 }}>
              {t('common:viewSwitcher.title', 'Choose your experience')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'var(--color-bg-hover, rgba(0,0,0,0.04))',
              border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{
          fontSize: 12, color: 'var(--color-text-muted, #5A6570)', lineHeight: 1.45,
          marginBottom: 14,
        }}>
          {t('common:viewSwitcher.help', 'Your data and identity stay the same — only the layout changes.')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {availableRoles.map((role) => {
            const meta = ROLE_META[role];
            if (!meta) return null;
            const Icon = meta.Icon;
            const active = role === activeView;
            return (
              <button
                key={role}
                type="button"
                onClick={() => handleSwitch(role)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%', minHeight: 56, padding: '12px 14px',
                  borderRadius: 12,
                  background: active ? 'rgba(25,184,184,0.12)' : 'transparent',
                  border: active ? '1px solid var(--color-accent, #19B8B8)' : '1px solid transparent',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: active ? 'var(--color-accent, #19B8B8)' : 'var(--color-bg-hover, rgba(0,0,0,0.05))',
                  color: active ? '#06363B' : 'var(--color-text-secondary, #5A6570)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={17} strokeWidth={2.2} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>
                    {t(`common:viewSwitcher.role.${role}.label`, defaultLabel(role))}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                    {t(`common:viewSwitcher.role.${role}.desc`, defaultDesc(role))}
                  </div>
                </div>
                {active && <Check size={16} style={{ color: 'var(--color-accent, #19B8B8)' }} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const defaultLabel = (role) => ({
  member: 'Member',
  trainer: 'Trainer',
  admin: 'Admin',
  super_admin: 'Super admin',
}[role] || role);

const defaultDesc = (role) => ({
  member: 'Track your own workouts, nutrition, social.',
  trainer: 'Manage clients, plans, sessions, classes.',
  admin: 'Run your gym — members, churn, analytics.',
  super_admin: 'Platform-wide operations across all gyms.',
}[role] || '');
