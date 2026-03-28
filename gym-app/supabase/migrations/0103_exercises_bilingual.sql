-- 0103: Add bilingual (Spanish) columns to exercises table
-- Adds name_es and instructions_es columns, populates Spanish names for all 146 exercises,
-- and creates a search index covering both languages.

-- Step 1: Add new columns
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS name_es TEXT,
  ADD COLUMN IF NOT EXISTS instructions_es TEXT;

-- Step 2: Populate Spanish names for all 146 exercises
UPDATE exercises
SET name_es = CASE id
  -- ═══════════════════════════════════════
  -- CHEST (16)
  -- ═══════════════════════════════════════
  WHEN 'ex_bp'    THEN 'Press de Banca con Barra'
  WHEN 'ex_cfly'  THEN 'Aperturas con Cable'
  WHEN 'ex_dcbp'  THEN 'Press Declinado con Barra'
  WHEN 'ex_ddbp'  THEN 'Press Declinado con Mancuernas'
  WHEN 'ex_dbp'   THEN 'Press de Banca con Mancuernas'
  WHEN 'ex_dfly'  THEN 'Aperturas con Mancuernas'
  WHEN 'ex_hcf'   THEN 'Aperturas de Cable Alto a Bajo'
  WHEN 'ex_ibp'   THEN 'Press Inclinado con Barra'
  WHEN 'ex_idbp'  THEN 'Press Inclinado con Mancuernas'
  WHEN 'ex_lcf'   THEN 'Aperturas de Cable Bajo a Alto'
  WHEN 'ex_mcp'   THEN 'Press de Pecho en Máquina'
  WHEN 'ex_pdk'   THEN 'Pec Deck'
  WHEN 'ex_pup'   THEN 'Flexiones'
  WHEN 'ex_smbp'  THEN 'Press de Banca en Smith'
  WHEN 'ex_svp'   THEN 'Press Svend'
  WHEN 'ex_dips'  THEN 'Fondos con Peso'

  -- ═══════════════════════════════════════
  -- BACK (19)
  -- ═══════════════════════════════════════
  WHEN 'ex_hyp'   THEN 'Extensión de Espalda'
  WHEN 'ex_bbr'   THEN 'Remo con Barra'
  WHEN 'ex_cbr'   THEN 'Remo con Cable'
  WHEN 'ex_csr'   THEN 'Remo con Apoyo en Pecho'
  WHEN 'ex_chu'   THEN 'Dominadas Supinas'
  WHEN 'ex_cglp'  THEN 'Jalón al Pecho Agarre Cerrado'
  WHEN 'ex_dl'    THEN 'Peso Muerto Convencional'
  WHEN 'ex_dbr'   THEN 'Remo con Mancuerna'
  WHEN 'ex_lp'    THEN 'Jalón al Pecho'
  WHEN 'ex_mdwr'  THEN 'Remo Meadows'
  WHEN 'ex_pdr'   THEN 'Remo Pendlay'
  WHEN 'ex_pu'    THEN 'Dominadas'
  WHEN 'ex_rkp'   THEN 'Rack Pull'
  WHEN 'ex_rdl'   THEN 'Peso Muerto Rumano'
  WHEN 'ex_smr'   THEN 'Remo Sentado en Máquina'
  WHEN 'ex_sap'   THEN 'Jalón con Brazos Rectos'
  WHEN 'ex_sdl'   THEN 'Peso Muerto Sumo'
  WHEN 'ex_tbr'   THEN 'Remo en T'
  WHEN 'ex_tbdl'  THEN 'Peso Muerto con Barra Hexagonal'

  -- ═══════════════════════════════════════
  -- SHOULDERS (16)
  -- ═══════════════════════════════════════
  WHEN 'ex_arnp'  THEN 'Press Arnold'
  WHEN 'ex_cfr'   THEN 'Elevación Frontal con Cable'
  WHEN 'ex_clr'   THEN 'Elevación Lateral con Cable'
  WHEN 'ex_dbop'  THEN 'Press de Hombros con Mancuernas'
  WHEN 'ex_fcu'   THEN 'Face Pull'
  WHEN 'ex_fr'    THEN 'Elevación Frontal'
  WHEN 'ex_lmp'   THEN 'Press Landmine'
  WHEN 'ex_lr'    THEN 'Elevación Lateral'
  WHEN 'ex_lur'   THEN 'Elevación Lu'
  WHEN 'ex_mlr'   THEN 'Elevación Lateral en Máquina'
  WHEN 'ex_mrdf'  THEN 'Pájaro en Máquina'
  WHEN 'ex_mshp'  THEN 'Press de Hombros en Máquina'
  WHEN 'ex_ohp'   THEN 'Press Militar'
  WHEN 'ex_rfly'  THEN 'Pájaro'
  WHEN 'ex_smop'  THEN 'Press Militar en Smith'
  WHEN 'ex_upr'   THEN 'Remo al Mentón'

  -- ═══════════════════════════════════════
  -- BICEPS (12)
  -- ═══════════════════════════════════════
  WHEN 'ex_bbc'   THEN 'Curl con Barra'
  WHEN 'ex_bayc'  THEN 'Curl Bayesiano con Cable'
  WHEN 'ex_cc'    THEN 'Curl con Cable'
  WHEN 'ex_conc'  THEN 'Curl Concentrado'
  WHEN 'ex_cbhc'  THEN 'Curl Martillo Cruzado'
  WHEN 'ex_dbc'   THEN 'Curl con Mancuernas'
  WHEN 'ex_ezc'   THEN 'Curl con Barra EZ'
  WHEN 'ex_hc'    THEN 'Curl Martillo'
  WHEN 'ex_idbc'  THEN 'Curl Inclinado con Mancuernas'
  WHEN 'ex_mbc'   THEN 'Curl de Bíceps en Máquina'
  WHEN 'ex_pcc'   THEN 'Curl Predicador'
  WHEN 'ex_spdc'  THEN 'Curl Araña'

  -- ═══════════════════════════════════════
  -- TRICEPS (11)
  -- ═══════════════════════════════════════
  WHEN 'ex_sq'    THEN 'Sentadilla con Barra'
  WHEN 'ex_bdip'  THEN 'Fondos en Banco'
  WHEN 'ex_coe'   THEN 'Extensión sobre Cabeza con Cable'
  WHEN 'ex_cgp'   THEN 'Press de Banca Agarre Cerrado'
  WHEN 'ex_dmpu'  THEN 'Flexiones Diamante'
  WHEN 'ex_jmp'   THEN 'Press JM'
  WHEN 'ex_oe'    THEN 'Extensión de Tríceps sobre Cabeza'
  WHEN 'ex_ske'   THEN 'Press de Cráneo'
  WHEN 'ex_tdm'   THEN 'Máquina de Fondos para Tríceps'
  WHEN 'ex_tkb'   THEN 'Patada de Tríceps'
  WHEN 'ex_tpd'   THEN 'Extensión de Tríceps con Cable'

  -- ═══════════════════════════════════════
  -- LEGS (22)
  -- ═══════════════════════════════════════
  WHEN 'ex_btsq'  THEN 'Sentadilla con Cinturón'
  WHEN 'ex_bdl'   THEN 'Sentadilla Búlgara'
  WHEN 'ex_dbrdl' THEN 'Peso Muerto Rumano con Mancuernas'
  WHEN 'ex_fsq'   THEN 'Sentadilla Frontal'
  WHEN 'ex_gsq'   THEN 'Sentadilla Goblet'
  WHEN 'ex_gm'    THEN 'Buenos Días'
  WHEN 'ex_hsq'   THEN 'Sentadilla Hack'
  WHEN 'ex_habd'  THEN 'Máquina de Abductores'
  WHEN 'ex_hadd'  THEN 'Máquina de Aductores'
  WHEN 'ex_lc'    THEN 'Curl de Piernas'
  WHEN 'ex_le'    THEN 'Extensión de Piernas'
  WHEN 'ex_lp_l'  THEN 'Prensa de Piernas'
  WHEN 'ex_nhc'   THEN 'Curl Nórdico'
  WHEN 'ex_psq'   THEN 'Sentadilla Péndulo'
  WHEN 'ex_rlng'  THEN 'Zancada Inversa'
  WHEN 'ex_slc'   THEN 'Curl de Piernas Sentado'
  WHEN 'ex_sllp'  THEN 'Prensa de Piernas Unilateral'
  WHEN 'ex_sisq'  THEN 'Sentadilla Sissy'
  WHEN 'ex_smsq'  THEN 'Sentadilla en Smith'
  WHEN 'ex_stup'  THEN 'Subida al Cajón'
  WHEN 'ex_lunge' THEN 'Zancadas Caminando'
  WHEN 'ex_wlst'  THEN 'Sentadilla en Pared'

  -- ═══════════════════════════════════════
  -- GLUTES (9)
  -- ═══════════════════════════════════════
  WHEN 'ex_ckb'   THEN 'Patada de Glúteo con Cable'
  WHEN 'ex_cpt'   THEN 'Tirón con Cable'
  WHEN 'ex_frgp'  THEN 'Frog Pump'
  WHEN 'ex_gkb'   THEN 'Máquina de Patada de Glúteo'
  WHEN 'ex_ghr'   THEN 'Glute-Ham Raise'
  WHEN 'ex_hth'   THEN 'Empuje de Cadera'
  WHEN 'ex_kg'    THEN 'Swing con Kettlebell'
  WHEN 'ex_slht'  THEN 'Empuje de Cadera Unilateral'
  WHEN 'ex_smht'  THEN 'Empuje de Cadera en Smith'

  -- ═══════════════════════════════════════
  -- CORE (17)
  -- ═══════════════════════════════════════
  WHEN 'ex_abwh'  THEN 'Rueda Abdominal'
  WHEN 'ex_bcr'   THEN 'Crunch Bicicleta'
  WHEN 'ex_cr'    THEN 'Crunch con Cable'
  WHEN 'ex_wdch'  THEN 'Leñador con Cable'
  WHEN 'ex_cpplk' THEN 'Plancha de Copenhague'
  WHEN 'ex_dbug'  THEN 'Dead Bug'
  WHEN 'ex_dsu'   THEN 'Abdominal Declinado'
  WHEN 'ex_dgfl'  THEN 'Bandera del Dragón'
  WHEN 'ex_llr'   THEN 'Elevación de Piernas Colgado'
  WHEN 'ex_hbh'   THEN 'Hollow Body Hold'
  WHEN 'ex_mcr'   THEN 'Crunch en Máquina'
  WHEN 'ex_palp'  THEN 'Press Pallof'
  WHEN 'ex_plank' THEN 'Plancha'
  WHEN 'ex_rtwt'  THEN 'Giro Ruso'
  WHEN 'ex_splk'  THEN 'Plancha Lateral'
  WHEN 'ex_scc'   THEN 'Acarreo de Maleta'
  WHEN 'ex_vup'   THEN 'V-Up'

  -- ═══════════════════════════════════════
  -- CALVES (5)
  -- ═══════════════════════════════════════
  WHEN 'ex_dkcr'  THEN 'Elevación de Pantorrillas en Burro'
  WHEN 'ex_lpcr'  THEN 'Elevación de Pantorrillas en Prensa'
  WHEN 'ex_secr'  THEN 'Elevación de Pantorrillas Sentado'
  WHEN 'ex_slcr'  THEN 'Elevación de Pantorrillas Unilateral'
  WHEN 'ex_scr'   THEN 'Elevación de Pantorrillas de Pie'

  -- ═══════════════════════════════════════
  -- FULL BODY (12)
  -- ═══════════════════════════════════════
  WHEN 'ex_brsl'  THEN 'Cuerdas de Batalla'
  WHEN 'ex_bxjp'  THEN 'Salto al Cajón'
  WHEN 'ex_burp'  THEN 'Burpee'
  WHEN 'ex_clnp'  THEN 'Cargada y Press'
  WHEN 'ex_dbth'  THEN 'Thruster con Mancuernas'
  WHEN 'ex_mnmk'  THEN 'Man Maker'
  WHEN 'ex_pcln'  THEN 'Cargada de Potencia'
  WHEN 'ex_row'   THEN 'Máquina de Remo'
  WHEN 'ex_sldl'  THEN 'Tirón de Trineo'
  WHEN 'ex_sldp'  THEN 'Empuje de Trineo'
  WHEN 'ex_thrst' THEN 'Thruster'
  WHEN 'ex_tgu'   THEN 'Levantamiento Turco'

  -- ═══════════════════════════════════════
  -- FOREARMS (4)
  -- ═══════════════════════════════════════
  WHEN 'ex_fwk'   THEN 'Paseo del Granjero'
  WHEN 'ex_rvc'   THEN 'Curl Inverso'
  WHEN 'ex_rwc'   THEN 'Curl de Muñeca Inverso'
  WHEN 'ex_wrc'   THEN 'Curl de Muñeca'

  -- ═══════════════════════════════════════
  -- TRAPS (3)
  -- ═══════════════════════════════════════
  WHEN 'ex_bbs'   THEN 'Encogimientos con Barra'
  WHEN 'ex_dbs'   THEN 'Encogimientos con Mancuernas'
  WHEN 'ex_sms'   THEN 'Encogimientos en Smith'

  ELSE name_es
END
WHERE id IN (
  -- Chest
  'ex_bp','ex_cfly','ex_dcbp','ex_ddbp','ex_dbp','ex_dfly','ex_hcf','ex_ibp',
  'ex_idbp','ex_lcf','ex_mcp','ex_pdk','ex_pup','ex_smbp','ex_svp','ex_dips',
  -- Back
  'ex_hyp','ex_bbr','ex_cbr','ex_csr','ex_chu','ex_cglp','ex_dl','ex_dbr',
  'ex_lp','ex_mdwr','ex_pdr','ex_pu','ex_rkp','ex_rdl','ex_smr','ex_sap',
  'ex_sdl','ex_tbr','ex_tbdl',
  -- Shoulders
  'ex_arnp','ex_cfr','ex_clr','ex_dbop','ex_fcu','ex_fr','ex_lmp','ex_lr',
  'ex_lur','ex_mlr','ex_mrdf','ex_mshp','ex_ohp','ex_rfly','ex_smop','ex_upr',
  -- Biceps
  'ex_bbc','ex_bayc','ex_cc','ex_conc','ex_cbhc','ex_dbc','ex_ezc','ex_hc',
  'ex_idbc','ex_mbc','ex_pcc','ex_spdc',
  -- Triceps
  'ex_sq','ex_bdip','ex_coe','ex_cgp','ex_dmpu','ex_jmp','ex_oe','ex_ske',
  'ex_tdm','ex_tkb','ex_tpd',
  -- Legs
  'ex_btsq','ex_bdl','ex_dbrdl','ex_fsq','ex_gsq','ex_gm','ex_hsq','ex_habd',
  'ex_hadd','ex_lc','ex_le','ex_lp_l','ex_nhc','ex_psq','ex_rlng','ex_slc',
  'ex_sllp','ex_sisq','ex_smsq','ex_stup','ex_lunge','ex_wlst',
  -- Glutes
  'ex_ckb','ex_cpt','ex_frgp','ex_gkb','ex_ghr','ex_hth','ex_kg','ex_slht','ex_smht',
  -- Core
  'ex_abwh','ex_bcr','ex_cr','ex_wdch','ex_cpplk','ex_dbug','ex_dsu','ex_dgfl',
  'ex_llr','ex_hbh','ex_mcr','ex_palp','ex_plank','ex_rtwt','ex_splk','ex_scc','ex_vup',
  -- Calves
  'ex_dkcr','ex_lpcr','ex_secr','ex_slcr','ex_scr',
  -- Full Body
  'ex_brsl','ex_bxjp','ex_burp','ex_clnp','ex_dbth','ex_mnmk','ex_pcln','ex_row',
  'ex_sldl','ex_sldp','ex_thrst','ex_tgu',
  -- Forearms
  'ex_fwk','ex_rvc','ex_rwc','ex_wrc',
  -- Traps
  'ex_bbs','ex_dbs','ex_sms'
);

-- Step 3: Create bilingual search indexes
-- B-tree index for exact lookups on name_es
CREATE INDEX IF NOT EXISTS idx_exercises_name_es ON exercises (name_es);

-- GIN trigram index for fuzzy/partial text search across both languages
CREATE INDEX IF NOT EXISTS idx_exercises_bilingual_search
  ON exercises
  USING GIN (
    (COALESCE(name, '') || ' ' || COALESCE(name_es, '')) gin_trgm_ops
  );
