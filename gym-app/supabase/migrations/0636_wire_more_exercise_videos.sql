-- ============================================================
-- 0636 — wire today's exercise demo videos to the DB
-- ============================================================
-- Sets video_url on 39 existing global exercises whose Kling demo clips were
-- uploaded to storage bucket exercise-videos (global/ prefix) today, and inserts
-- the new "Incline Cable Fly" exercise (ex_inccblfly). Matches exercises.js.
-- Additive + idempotent. (Walking Lunges warm-up reuses the Walking Lunge clip.)
-- ============================================================

UPDATE exercises AS e
SET    video_url = v.url
FROM (VALUES
    ('ex_dbflrpr', 'global/dumbbell_floor_press.mp4'),
    ('ex_bearcrawl', 'global/bear_crawl.mp4'),
    ('ex_roppushdn', 'global/rope_pushdown.mp4'),
    ('ex_catcow', 'global/cat_cow.mp4'),
    ('ex_dbpullover', 'global/dumbbell_pullover.mp4'),
    ('ex_deadhang', 'global/dead_hang.mp4'),
    ('ex_decdbfly', 'global/decline_dumbbell_fly.mp4'),
    ('ex_decpushup', 'global/decline_push_up.mp4'),
    ('ex_devilspress', 'global/devils_press.mp4'),
    ('ex_dgfl', 'global/dragon_flag.mp4'),
    ('ex_dbsnatch', 'global/dumbbell_snatch.mp4'),
    ('ex_fwk', 'global/farmers_walk.mp4'),
    ('ex_frankkicks', 'global/frankenstein_kicks.mp4'),
    ('ex_gorrow', 'global/gorilla_row.mp4'),
    ('ex_wu_hw', 'global/high_knees.mp4'),
    ('ex_kbclean', 'global/kettlebell_clean.mp4'),
    ('ex_kbohcarry', 'global/kettlebell_overhead_carry.mp4'),
    ('ex_kbsnatch', 'global/kettlebell_snatch.mp4'),
    ('ex_kbwindmill', 'global/kettlebell_windmill.mp4'),
    ('ex_krocrow', 'global/kroc_row.mp4'),
    ('ex_hcf', 'global/high_to_low_cable_fly.mp4'),
    ('ex_nglatpd', 'global/neutral_grip_lat_pulldown.mp4'),
    ('ex_pdr', 'global/pendlay_row.mp4'),
    ('ex_pcln', 'global/power_clean.mp4'),
    ('ex_renrow', 'global/renegade_row.mp4'),
    ('ex_bandfly', 'global/resistance_band_fly.mp4'),
    ('ex_bandpr', 'global/resistance_band_chest_press.mp4'),
    ('ex_rdl', 'global/romanian_deadlift.mp4'),
    ('ex_sealrow', 'global/seal_row.mp4'),
    ('ex_sldl', 'global/sled_pull.mp4'),
    ('ex_sldp', 'global/sled_push.mp4'),
    ('ex_incsmpr', 'global/incline_smith_machine_press.mp4'),
    ('ex_smop', 'global/smith_machine_shoulder_press.mp4'),
    ('ex_spanishsq', 'global/spanish_squat.mp4'),
    ('ex_spdc', 'global/spider_curl.mp4'),
    ('ex_wu_trot', 'global/torso_rotations.mp4'),
    ('ex_wglatpd', 'global/wide_grip_lat_pulldown.mp4'),
    ('ex_worldstretch', 'global/worlds_greatest_stretch.mp4'),
    ('ex_wu_wls', 'global/black_trainer_walking_lunges.mp4')
) AS v(id, url)
WHERE e.id = v.id AND e.gym_id IS NULL;

-- New exercise: Incline Cable Fly (bench between two low cable pulleys)
INSERT INTO exercises
  (id, gym_id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, instructions_es, primary_regions, secondary_regions, video_url, muscle_scores, movement_pattern, station, is_active)
VALUES
  ('ex_inccblfly', NULL, 'Incline Cable Fly', 'Aperturas en polea en banco inclinado', 'Chest', 'Cable', 'Hypertrophy', 3, '12-15', 90,
   'Lie on an incline bench set between two low cable pulleys. With a slight elbow bend, open your arms wide, then sweep the handles up and together above your chest.',
   NULL, ARRAY['upper_chest'], ARRAY['front_delts'], 'global/incline_cable_fly.mp4',
   '{"upper_chest":90,"mid_chest":40,"front_delts":35,"serratus":15}'::jsonb, 'isolation_push', 'Cable Station', TRUE)
ON CONFLICT (id) DO UPDATE SET
  video_url = EXCLUDED.video_url, muscle_scores = EXCLUDED.muscle_scores,
  movement_pattern = EXCLUDED.movement_pattern, station = EXCLUDED.station, is_active = TRUE;
