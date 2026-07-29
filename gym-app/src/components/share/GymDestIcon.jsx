// GymDestIcon.jsx
// -----------------------------------------------------------------------------
// The icon on the "share to your gym" destination chip.
//
// Every OTHER destination in the share sheet shows a mark you recognise —
// Instagram's camera, WhatsApp's bubble, the Messages icon, Facebook's f. The
// gym's own chip showed a generic add-a-person glyph, so the one destination
// that IS the gym looked like the least branded option on the row. On a
// white-label product that's backwards: the gym's mark should be the most
// recognisable thing there.
//
// Falls back to the generic glyph when the gym has no logo (or it can't be
// loaded), so the chip is never empty.
// -----------------------------------------------------------------------------

import React from 'react';
import useInlinedImage from './useInlinedImage';

export default function GymDestIcon({ logoUrl }) {
  const { src, failed } = useInlinedImage(logoUrl);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        style={{ width: 34, height: 34, borderRadius: 10, objectFit: 'cover', display: 'block' }}
      />
    );
  }
  return (
    <svg
      width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="var(--color-text-on-accent, #fff)"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M18 8v6M21 11h-6" />
    </svg>
  );
}
