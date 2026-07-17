-- ============================================================
-- 0635 — wire newly generated exercise demo videos to the DB
-- ============================================================
-- Sets video_url on 73 existing global exercises whose Kling demo clips
-- were just uploaded to storage bucket exercise-videos (global/ prefix), and
-- inserts the new "Dumbbell Around the World" exercise (ex_dbatw).
-- Matches exercises.js. Additive + idempotent.
-- ============================================================

UPDATE exercises AS e
SET    video_url = v.url
FROM (VALUES
    ('ex_bstanceht', 'global/b_stance_hip_thrust.mp4'),
    ('ex_bandabduct', 'global/banded_hip_abduction.mp4'),
    ('ex_btnpress', 'global/behind_the_neck_press.mp4'),
    ('ex_ckb', 'global/cable_glute_kickback.mp4'),
    ('ex_proneyraise', 'global/prone_y_raise.mp4'),
    ('ex_sadbohp', 'global/single_arm_dumbbell_overhead_press.mp4'),
    ('ex_cableabduct', 'global/standing_cable_hip_abduction.mp4'),
    ('ex_vup', 'global/v_up.mp4'),
    ('ex_zpress', 'global/z_press.mp4'),
    ('ex_assaultbike', 'global/assault_bike.mp4'),
    ('ex_bandpullapart', 'global/band_pull_apart.mp4'),
    ('ex_bbglutebr', 'global/barbell_glute_bridge.mp4'),
    ('ex_bbs', 'global/barbell_shrug.mp4'),
    ('ex_cd_basketball', 'global/basketball.mp4'),
    ('ex_bbsplitsq', 'global/barbell_split_squat.mp4'),
    ('ex_btbbbshrug', 'global/behind_the_back_barbell_shrug.mp4'),
    ('ex_birddog', 'global/bird_dog.mp4'),
    ('ex_tgu', 'global/turkish_get_up.mp4'),
    ('ex_wu_iw', 'global/inchworm.mp4'),
    ('ex_wu_jj', 'global/jumping_jacks.mp4'),
    ('ex_clnp', 'global/clean_and_press.mp4'),
    ('ex_mnmk', 'global/man_maker.mp4'),
    ('ex_cfr', 'global/cable_front_raise.mp4'),
    ('ex_cd_treadmill', 'global/treadmill.mp4'),
    ('ex_fr', 'global/front_raise.mp4'),
    ('ex_boxsquat', 'global/box_squat.mp4'),
    ('ex_cd_boxing', 'global/boxing.mp4'),
    ('ex_cblshrug', 'global/cable_shrug.mp4'),
    ('ex_cossacksq', 'global/cossack_squat.mp4'),
    ('ex_cbhc', 'global/cross_body_hammer_curl.mp4'),
    ('ex_cubanpr', 'global/cuban_press.mp4'),
    ('ex_cd_dance', 'global/dance.mp4'),
    ('ex_dbrdl', 'global/dumbbell_romanian_deadlift.mp4'),
    ('ex_dbsidebend', 'global/dumbbell_side_bend.mp4'),
    ('ex_dbs', 'global/dumbbell_shrug.mp4'),
    ('ex_dbsqzpr', 'global/dumbbell_squeeze_press.mp4'),
    ('ex_cd_elliptical', 'global/elliptical.mp4'),
    ('ex_flrpr', 'global/floor_press.mp4'),
    ('ex_flutterkick', 'global/flutter_kicks.mp4'),
    ('ex_hangkneeraz', 'global/hanging_knee_raise.mp4'),
    ('ex_cd_hiit', 'global/hiit.mp4'),
    ('ex_cd_hiking', 'global/hiking.mp4'),
    ('ex_incdbfly', 'global/incline_dumbbell_fly.mp4'),
    ('ex_cd_jumprope', 'global/jump_rope.mp4'),
    ('ex_wu_lc', 'global/jump_rope.mp4'),
    ('ex_kbpushpr', 'global/kettlebell_push_press.mp4'),
    ('ex_tbr', 'global/t_bar_row.mp4'),
    ('ex_cd_martial', 'global/martial_arts.mp4'),
    ('ex_mtclimber', 'global/mountain_climbers.mp4'),
    ('ex_pistolsq', 'global/pistol_squat.mp4'),
    ('ex_pushpress', 'global/push_press.mp4'),
    ('ex_recumbike', 'global/recumbent_bike.mp4'),
    ('ex_revcrunch', 'global/reverse_crunch.mp4'),
    ('ex_cd_rower', 'global/rowing_machine.mp4'),
    ('ex_row', 'global/rowing_machine.mp4'),
    ('ex_seatdblat', 'global/seated_dumbbell_lateral_raise.mp4'),
    ('ex_latlunge', 'global/lateral_lunge.mp4'),
    ('ex_dblunge', 'global/dumbbell_lunge.mp4'),
    ('ex_slglutebr', 'global/single_leg_glute_bridge.mp4'),
    ('ex_slrdl', 'global/single_leg_romanian_deadlift.mp4'),
    ('ex_cd_soccer', 'global/soccer.mp4'),
    ('ex_standcblcr', 'global/standing_cable_crunch.mp4'),
    ('ex_cd_swim', 'global/swimming.mp4'),
    ('ex_cd_tennis', 'global/tennis.mp4'),
    ('ex_toestobar', 'global/toes_to_bar.mp4'),
    ('ex_cd_walking', 'global/walking.mp4'),
    ('ex_wtsitup', 'global/weighted_sit_up.mp4'),
    ('ex_rkp', 'global/rack_pull.mp4'),
    ('ex_cd_bike', 'global/stationary_bike.mp4'),
    ('ex_cd_yoga', 'global/yoga.mp4'),
    ('ex_bbc', 'global/barbell_curl.mp4'),
    ('ex_dbc', 'global/dumbbell_curl.mp4'),
    ('ex_rfly', 'global/rear_delt_fly.mp4')
) AS v(id, url)
WHERE e.id = v.id AND e.gym_id IS NULL;

-- New exercise: Dumbbell Around the World (not in the original 305 seed)
INSERT INTO exercises
  (id, gym_id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, instructions_es, primary_regions, secondary_regions, video_url, muscle_scores, movement_pattern, station, is_active)
VALUES
  ('ex_dbatw', NULL, 'Dumbbell Around the World', 'Círculos con mancuernas', 'Shoulders', 'Dumbbell', 'Hypertrophy', 3, '10-12', 90,
   'Hold a dumbbell in each hand at your thighs, arms straight. Sweep them out and up in a big circle until they meet overhead, then reverse back down.',
   NULL, ARRAY['front_delts','side_delts'], ARRAY['upper_chest'], 'global/dumbbell_around_the_world.mp4',
   '{"front_delts":70,"side_delts":60,"upper_chest":35,"traps":25}'::jsonb, 'isolation_push', 'Dumbbell Area', TRUE)
ON CONFLICT (id) DO UPDATE SET
  video_url = EXCLUDED.video_url,
  muscle_scores = EXCLUDED.muscle_scores,
  movement_pattern = EXCLUDED.movement_pattern,
  station = EXCLUDED.station,
  is_active = TRUE;
