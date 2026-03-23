// ── Shared Exercise Constants ────────────────────────────────────────────────

/**
 * Maps injury areas to Sets of exercise IDs that should be excluded
 * when a user has reported that injury.
 */
export const INJURY_EXCLUSIONS = {
  lower_back: new Set(['ex_dl', 'ex_sdl', 'ex_tbdl', 'ex_rdl', 'ex_bbr', 'ex_pdr', 'ex_tbr', 'ex_rkp', 'ex_gm', 'ex_clnp', 'ex_pcln', 'ex_mnmk']),
  knees:      new Set(['ex_sq', 'ex_fsq', 'ex_gsq', 'ex_smsq', 'ex_hsq', 'ex_psq', 'ex_btsq', 'ex_lp_l', 'ex_sllp', 'ex_lunge', 'ex_rlng', 'ex_bdl', 'ex_stup', 'ex_sisq', 'ex_nhc', 'ex_thrst', 'ex_dbth', 'ex_burp', 'ex_bxjp']),
  shoulders:  new Set(['ex_ohp', 'ex_smop', 'ex_arnp', 'ex_lr', 'ex_clr', 'ex_mlr', 'ex_fr', 'ex_cfr', 'ex_lur', 'ex_dips', 'ex_lmp', 'ex_upr', 'ex_clnp', 'ex_thrst', 'ex_dbth', 'ex_brsl']),
  wrists:     new Set(['ex_bbc', 'ex_fr', 'ex_wrc', 'ex_rwc', 'ex_rvc', 'ex_pup', 'ex_dmpu', 'ex_jmp']),
  elbows:     new Set(['ex_ske', 'ex_oe', 'ex_coe', 'ex_cgp', 'ex_tpd', 'ex_jmp', 'ex_bdip']),
  hips:       new Set(['ex_hth', 'ex_smht', 'ex_sq', 'ex_fsq', 'ex_gsq', 'ex_sdl', 'ex_cpt', 'ex_hadd', 'ex_habd', 'ex_frgp']),
  ankles:     new Set(['ex_scr', 'ex_secr', 'ex_lpcr', 'ex_dkcr', 'ex_slcr', 'ex_lunge', 'ex_rlng', 'ex_stup', 'ex_bxjp']),
};
