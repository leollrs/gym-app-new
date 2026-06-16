import { useEffect, useMemo } from 'react';
import MemberDetail from '../../admin/components/MemberDetail';

/**
 * PlatformMemberDetail — platform (super-admin) wrapper around the admin
 * MemberDetail modal.
 *
 * MemberDetail is built for the admin tier, where its surfaces, text and
 * semantic colors come from the `--color-admin-*` / `--color-*-soft|ink`
 * design-system CSS variables. Those variables default to the LIGHT cream admin
 * palette (:root in index.css) and are only flipped to dark by `html.dark`,
 * which the always-dark platform tier does not rely on. Rendering MemberDetail
 * here unchanged would therefore paint it cream-on-dark.
 *
 * This wrapper re-skins it WITHOUT touching MemberDetail by overriding every
 * admin variable it actually consumes with platform-dark values. The overrides
 * are applied in two places:
 *   1. On the wrapper root (covers the modal panel itself), and
 *   2. On <html> for the lifetime of the wrapper (covers MemberDetail's child
 *      modals — AdminModal / cancellation flows — which portal to document.body
 *      and so live outside the wrapper subtree).
 * The document-level vars are snapshotted and restored on unmount, so the admin
 * tier's own MemberDetail usage is never affected.
 */

// Platform-dark mapping for every CSS variable MemberDetail (and its child
// modals / btnTone helper) reads. Values mirror the platform palette used
// across GymDetail (#05070B bg, #0F172A panels, #111827 nested, gold accent).
const PLATFORM_DARK_VARS = {
  // Admin surfaces / text
  '--color-admin-sidebar': '#0F172A',   // modal panel + elevated surfaces
  '--color-admin-panel': '#111827',     // nested cards / inputs
  '--color-admin-border': 'rgba(255,255,255,0.08)',
  '--color-admin-text': '#E5E7EB',
  '--color-admin-text-sub': '#B8B4AC',
  '--color-admin-text-muted': '#9CA3AF',
  '--color-admin-text-faint': '#6B7280',
  '--color-bg-hover': 'rgba(255,255,255,0.04)',

  // Accent (platform gold) + on-accent text
  '--color-accent': '#D4AF37',
  '--color-text-on-accent': '#000000',
  '--color-on-brand': '#000000',

  // Member tokens used by the portaled AdminModal shell (kept consistent with
  // the dark platform so child confirm/delete modals match).
  '--color-bg-card': '#0F172A',
  '--color-bg-deep': '#0B0F18',
  '--color-border-subtle': 'rgba(255,255,255,0.08)',
  '--color-text-primary': '#E5E7EB',
  '--color-text-muted': '#9CA3AF',
  '--color-text-subtle': '#6B7280',
  '--color-bg-input': '#111827',
  '--color-bg-elevated': '#111827',

  // Semantic soft/ink/solid tones (risk strip, status banners, danger zone,
  // outcome pills, toasts inside the modal).
  '--color-success': '#34D399',
  '--color-success-soft': 'rgba(52,211,153,0.14)',
  '--color-success-ink': '#6EE7B7',
  '--color-warning': '#F59E0B',
  '--color-warning-soft': 'rgba(245,158,11,0.14)',
  '--color-warning-ink': '#FBBF24',
  '--color-danger': '#EF4444',
  '--color-danger-soft': 'rgba(239,68,68,0.16)',
  '--color-danger-ink': '#FCA5A5',
  '--color-info': '#60A5FA',
  '--color-info-soft': 'rgba(96,165,250,0.16)',

  // Shadow — deepen for the dark backdrop.
  '--shadow-lg': '0 4px 12px rgba(0,0,0,0.4), 0 12px 36px rgba(0,0,0,0.35)',
};

export default function PlatformMemberDetail({ member, gymId, onClose, onNoteSaved, onStatusChanged }) {
  // The platform roster (GymDetail.fetchMembers) selects a thin column set and
  // does NOT compute churn enrichment (score/state/daysInactive/recentWorkouts).
  // Without these, MemberDetail's risk strip renders NaN widths and an
  // "undefined%" score, and `member.full_name.split(...)` would crash on a null
  // name. Provide honest, neutral defaults: state 'insufficient_data' makes the
  // strip read "Not enough data" (no fabricated risk %), and keeps
  // isFollowupCandidate false — which is correct, since the platform has no
  // churn signal here AND the follow-up DM path uses a same-gym-only RPC.
  const safeMember = useMemo(() => ({
    score: 0,
    state: 'insufficient_data',
    daysInactive: null,
    neverActive: false,
    recentWorkouts: 0,
    ...member,
    // Guard the few fields MemberDetail dereferences without null checks.
    full_name: member?.full_name || member?.username || 'Member',
  }), [member]);

  // Apply the dark variable overrides at <html> scope for the wrapper's lifetime
  // so body-portaled child modals inherit them too; restore prior values on
  // unmount so the admin tier is untouched.
  useEffect(() => {
    const root = document.documentElement;
    const prev = {};
    for (const [k, v] of Object.entries(PLATFORM_DARK_VARS)) {
      prev[k] = root.style.getPropertyValue(k);
      root.style.setProperty(k, v);
    }
    return () => {
      for (const k of Object.keys(PLATFORM_DARK_VARS)) {
        if (prev[k]) root.style.setProperty(k, prev[k]);
        else root.style.removeProperty(k);
      }
    };
  }, []);

  return (
    <div style={PLATFORM_DARK_VARS}>
      <MemberDetail
        member={safeMember}
        gymId={gymId}
        onClose={onClose}
        onNoteSaved={onNoteSaved}
        onStatusChanged={onStatusChanged}
      />
    </div>
  );
}
