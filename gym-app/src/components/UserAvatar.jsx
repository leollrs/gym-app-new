/**
 * Shared avatar renderer — use everywhere an avatar appears.
 *
 * Props:
 *   user  — { avatar_url, avatar_type, avatar_value, full_name, display_name, first_name, last_name }
 *   size  — pixel width/height (default 40)
 *   className — extra classes on the outer element
 *   rounded   — 'full' (circle, default) or '2xl' (squircle used on Profile page)
 */

// SVG designs — inline paths so they render instantly with no network request
const AVATAR_DESIGNS = {
  dumbbell: {
    bg: 'linear-gradient(135deg, #F0A500, #EF4444)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><rect x="8" y="24" width="8" height="16" rx="2" fill="white" opacity=".9"/><rect x="48" y="24" width="8" height="16" rx="2" fill="white" opacity=".9"/><rect x="4" y="27" width="8" height="10" rx="2" fill="white" opacity=".7"/><rect x="52" y="27" width="8" height="10" rx="2" fill="white" opacity=".7"/><rect x="16" y="30" width="32" height="4" rx="2" fill="white" opacity=".8"/></svg>,
  },
  flame: {
    bg: 'linear-gradient(135deg, #EF4444, #F97316)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M32 8c0 12-16 20-16 32a16 16 0 0032 0c0-6-4-10-8-14 0 6-4 10-8 10s-8-6-8-12c0-4 4-10 8-16z" fill="white" opacity=".85"/></svg>,
  },
  lightning: {
    bg: 'linear-gradient(135deg, #F59E0B, #EAB308)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M36 6L16 34h12L24 58 48 28H36L36 6z" fill="white" opacity=".9"/></svg>,
  },
  heart: {
    bg: 'linear-gradient(135deg, #EC4899, #F43F5E)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M32 56S8 40 8 24a12 12 0 0124 0 12 12 0 0124 0c0 16-24 32-24 32z" fill="white" opacity=".85"/></svg>,
  },
  mountain: {
    bg: 'linear-gradient(135deg, #22C55E, #14B8A6)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M4 52L24 16l10 14 8-10L58 52H4z" fill="white" opacity=".8"/><path d="M38 20l4-4 4 4" stroke="white" strokeWidth="2" opacity=".6"/></svg>,
  },
  star: {
    bg: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M32 8l7 18H58L43 38l5 18-16-11-16 11 5-18L6 26h19z" fill="white" opacity=".85"/></svg>,
  },
  rocket: {
    bg: 'linear-gradient(135deg, #3B82F6, #06B6D4)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M32 6c-8 8-12 20-12 30h24c0-10-4-22-12-30z" fill="white" opacity=".85"/><rect x="20" y="36" width="24" height="6" rx="3" fill="white" opacity=".7"/><path d="M26 42l-4 14 10-8 10 8-4-14" fill="white" opacity=".6"/></svg>,
  },
  crown: {
    bg: 'linear-gradient(135deg, #F0A500, #F59E0B)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M8 44V24l12 8 12-16 12 16 12-8v20H8z" fill="white" opacity=".85"/><rect x="8" y="44" width="48" height="6" rx="2" fill="white" opacity=".7"/></svg>,
  },
  alien: {
    bg: 'linear-gradient(135deg, #22D3EE, #A78BFA)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><ellipse cx="32" cy="28" rx="18" ry="20" fill="white" opacity=".8"/><ellipse cx="24" cy="26" rx="5" ry="7" fill="#1E293B" opacity=".7"/><ellipse cx="40" cy="26" rx="5" ry="7" fill="#1E293B" opacity=".7"/><path d="M28 38q4 4 8 0" stroke="#1E293B" strokeWidth="2" fill="none" opacity=".5"/><path d="M18 10Q14 2 10 6" stroke="white" strokeWidth="2" opacity=".6"/><path d="M46 10Q50 2 54 6" stroke="white" strokeWidth="2" opacity=".6"/></svg>,
  },
  bear: {
    bg: 'linear-gradient(135deg, #92400E, #F59E0B)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><circle cx="16" cy="18" r="8" fill="white" opacity=".7"/><circle cx="48" cy="18" r="8" fill="white" opacity=".7"/><ellipse cx="32" cy="34" rx="18" ry="20" fill="white" opacity=".8"/><circle cx="24" cy="30" r="3" fill="#1E293B" opacity=".6"/><circle cx="40" cy="30" r="3" fill="#1E293B" opacity=".6"/><ellipse cx="32" cy="38" rx="4" ry="3" fill="#1E293B" opacity=".4"/></svg>,
  },
  cat: {
    bg: 'linear-gradient(135deg, #EC4899, #8B5CF6)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M12 20L18 6l10 12h8L46 6l6 14" fill="white" opacity=".7"/><ellipse cx="32" cy="36" rx="20" ry="18" fill="white" opacity=".8"/><circle cx="24" cy="32" r="3" fill="#1E293B" opacity=".6"/><circle cx="40" cy="32" r="3" fill="#1E293B" opacity=".6"/><path d="M30 38l2 2 2-2" stroke="#1E293B" strokeWidth="1.5" fill="none" opacity=".5"/><path d="M18 38q-8 2-6 6M46 38q8 2 6 6" stroke="white" strokeWidth="1" opacity=".4"/></svg>,
  },
  kettlebell: {
    bg: 'linear-gradient(135deg, #1E293B, #6366F1)',
    svg: (s) => <svg viewBox="0 0 64 64" width={s} height={s} fill="none"><path d="M24 12a8 8 0 0116 0v6H24v-6z" fill="none" stroke="white" strokeWidth="3" opacity=".8"/><circle cx="32" cy="38" r="16" fill="white" opacity=".8"/><circle cx="32" cy="38" r="6" fill="#1E293B" opacity=".3"/></svg>,
  },
};

function getInitials(user) {
  if (!user) return '?';
  const first = user.first_name || '';
  const last  = user.last_name  || '';
  if (first && last) return (first[0] + last[0]).toUpperCase();

  const name = user.full_name || user.display_name || '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return '?';
}

export { AVATAR_DESIGNS, getInitials };

export default function UserAvatar({ user, size = 40, className = '', rounded = 'full' }) {
  const initials = getInitials(user);
  const fontSize = size < 30 ? 10 : size < 50 ? 14 : 18;
  const borderRadius = rounded === '2xl' ? 16 : size / 2;

  const type  = user?.avatar_type  || (user?.avatar_url ? 'photo' : 'color');
  const value = user?.avatar_value || '#6366F1';

  // Photo
  if (type === 'photo' && user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.full_name || user.display_name || 'Avatar'}
        className={`object-cover flex-shrink-0 ${className}`}
        style={{ width: size, height: size, borderRadius }}
      />
    );
  }

  // Design (SVG icon)
  if (type === 'design' && AVATAR_DESIGNS[value]) {
    const design = AVATAR_DESIGNS[value];
    const iconSize = Math.round(size * 0.6);
    return (
      <div
        className={`flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius,
          background: design.bg,
        }}
      >
        {design.svg(iconSize)}
      </div>
    );
  }

  // Color (solid with initials)
  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 font-bold text-white select-none ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius,
        backgroundColor: value,
        fontSize,
        lineHeight: 1,
      }}
    >
      {initials}
    </div>
  );
}
