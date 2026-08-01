// The onboarding flow's own palette.
//
// Extracted out of Onboarding.jsx so OnboardingTargets can share it without an
// import cycle (Onboarding → OnboardingTargets → Onboarding). The cycle worked
// — both modules finish evaluating before any component renders — but it is the
// kind of thing that breaks silently later when someone reads a token at module
// scope instead of inside a render.
//
// Why the Targets sheet needs it at all: it was styled from the generic app
// tokens while every other onboarding screen uses these, and that mismatch is
// what made the step look like a different product.

export const OB = {
  bg:          '#f0eee9',
  surface:     '#ffffff',
  surface2:    '#e8e5de',
  ink:         '#0B0F12',
  sub:         '#6B6A63',
  mute:        '#9A988E',
  line:        'rgba(11,15,18,0.08)',
  lineStrong:  'rgba(11,15,18,0.14)',
  teal:        '#2EC4C4',
  tealDeep:    '#0FA5A5',
  tealSoft:    '#D7F1F1',
  orange:      '#FF5A2E',
  orangeSoft:  '#FBE0D3',
  purple:      '#6D5FDB',
  purpleSoft:  '#E0DCF5',
  gold:        '#E8C547',
  goldSoft:    '#F6ECB6',
  green:       '#5EAA5E',
  greenSoft:   '#DDEBD6',
  shadow:      '0 1px 2px rgba(11,15,18,0.04), 0 6px 18px rgba(11,15,18,0.05)',
  shadowLg:    '0 2px 4px rgba(11,15,18,0.05), 0 16px 40px rgba(11,15,18,0.08)',
};
