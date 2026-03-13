// ── Shared Exercise Constants ────────────────────────────────────────────────

/**
 * Maps injury areas to Sets of exercise IDs that should be excluded
 * when a user has reported that injury.
 */
export const INJURY_EXCLUSIONS = {
  lower_back: new Set(['ex_dl', 'ex_rdl', 'ex_bbr']),
  knees:      new Set(['ex_sq', 'ex_fsq', 'ex_lp_l', 'ex_lunge', 'ex_bdl']),
  shoulders:  new Set(['ex_ohp', 'ex_lr', 'ex_fr', 'ex_dips']),
  wrists:     new Set(['ex_bbc', 'ex_fr']),
  elbows:     new Set(['ex_ske', 'ex_oe', 'ex_cgp', 'ex_tpd']),
  hips:       new Set(['ex_hth', 'ex_sq', 'ex_fsq']),
  ankles:     new Set(['ex_scr', 'ex_secr']),
};
