-- ============================================================
-- 0617 — goal notifications: milestone-aware copy + correct route
-- ============================================================
-- Two fixes to the existing goal notification producers (0442 / 0444):
--
-- (1) ROUTE — both routed taps to '/profile', but the member's goal cards live
--     on the Progress page (GoalsSection in ProgressOverview). Point them at
--     '/progress' so tapping a goal notification lands on the goals.
--
-- (2) MILESTONE COPY — fire_member_goal_completed now distinguishes a milestone
--     ("Milestone hit 🎯 — keep pushing toward <the big goal>") from a real
--     long-term goal ("Goal achieved 🎉"). Milestones are ordinary member_goals
--     rows, so they already triggered the generic "Goal achieved" — this just
--     makes the copy honest (a milestone isn't the finish line).
--
-- Bodies reproduced verbatim from 0442 / 0444 with only those two changes.
-- ============================================================

-- ── Goal achieved / milestone hit → the member ────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_member_goal_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_title TEXT;
BEGIN
  -- Fire only on the completion TRANSITION (NULL → set). UPDATE-only trigger,
  -- so OLD always exists. Deliberately NOT on INSERT: onboarding seeds goals
  -- with achieved_at already set (a baseline, not an achievement).
  IF NEW.achieved_at IS NULL OR OLD.achieved_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_milestone THEN
    SELECT NULLIF(title, '') INTO v_parent_title
      FROM member_goals WHERE id = NEW.parent_goal_id;

    PERFORM public._notify_push(
      NEW.profile_id, NEW.gym_id, 'member'::user_role, 'goal'::notification_type,
      'Milestone hit 🎯',
      'You hit "' || COALESCE(NULLIF(NEW.title, ''), 'a milestone')
        || '" — keep pushing toward ' || COALESCE(v_parent_title, 'your goal') || '.',
      '¡Hito alcanzado! 🎯',
      'Lograste "' || COALESCE(NULLIF(NEW.title, ''), 'un hito')
        || '" — sigue hacia ' || COALESCE(v_parent_title, 'tu meta') || '.',
      jsonb_build_object('route', '/progress', 'goal_id', NEW.id, 'goal_type', NEW.goal_type, 'is_milestone', true),
      'goal_done_' || NEW.id::text
    );
  ELSE
    PERFORM public._notify_push(
      NEW.profile_id, NEW.gym_id, 'member'::user_role, 'goal'::notification_type,
      'Goal achieved 🎉',
      'You hit your goal: ' || COALESCE(NULLIF(NEW.title, ''), 'your target') || '. Time to set the next one.',
      '¡Meta alcanzada! 🎉',
      'Lograste tu meta: ' || COALESCE(NULLIF(NEW.title, ''), 'tu objetivo') || '. Hora de fijar la siguiente.',
      jsonb_build_object('route', '/progress', 'goal_id', NEW.id, 'goal_type', NEW.goal_type),
      'goal_done_' || NEW.id::text
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_member_goal_completed failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ── Goal deadline approaching (daily cron) — route fix only ────────────────
CREATE OR REPLACE FUNCTION public.send_goal_deadline_reminders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g       RECORD;
  v_days  INTEGER;
BEGIN
  FOR g IN
    SELECT id, profile_id, gym_id, title, target_date
    FROM member_goals
    WHERE achieved_at IS NULL
      AND target_date IS NOT NULL
      AND target_date >= CURRENT_DATE
      AND target_date <= CURRENT_DATE + 7
  LOOP
    v_days := (g.target_date - CURRENT_DATE);
    PERFORM public._notify_push(
      g.profile_id, g.gym_id, 'member'::user_role, 'goal'::notification_type,
      'Goal deadline soon ⏳',
      'Your goal "' || COALESCE(NULLIF(g.title, ''), 'your target') || '" is due in ' || v_days || ' day(s). Push to finish it.',
      'Tu meta vence pronto ⏳',
      'Tu meta "' || COALESCE(NULLIF(g.title, ''), 'tu objetivo') || '" vence en ' || v_days || ' día(s). Dale para lograrla.',
      jsonb_build_object('route', '/progress', 'goal_id', g.id),
      'goal_deadline_' || g.id::text
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'send_goal_deadline_reminders failed: %', SQLERRM;
END;
$$;

NOTIFY pgrst, 'reload schema';
