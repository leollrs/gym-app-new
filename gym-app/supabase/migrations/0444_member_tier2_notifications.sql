-- ============================================================
-- 0444 — Member Tier-2 notifications
-- ============================================================
--   goal_deadline_approaching ← daily cron: goal target_date within 7 days, not achieved
--   punch_card_one_to_go      ← member_punch_cards: one stamp away from the reward
--
-- In-app + push, bilingual, via _notify_push (0440). DEPENDS ON 0440 and 0442
-- (the 'goal' + 'reward' enum values were added in 0442). Apply after both.
-- ============================================================

-- ── Goal deadline approaching (daily cron) ────────────────────────────────
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
      jsonb_build_object('route', '/profile', 'goal_id', g.id),
      'goal_deadline_' || g.id::text  -- once per goal, when it enters the 7-day window
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'send_goal_deadline_reminders failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_goal_deadline_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.send_goal_deadline_reminders() TO service_role;

SELECT cron.schedule(
  'send-goal-deadline-reminders',
  '0 13 * * *',  -- daily ~9am AST
  $$ SELECT public.send_goal_deadline_reminders(); $$
);

-- ── Punch card: one stamp to go ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_punch_card_one_to_go()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target INTEGER;
BEGIN
  IF NEW.punches <= OLD.punches THEN
    RETURN NEW; -- only on increment
  END IF;

  SELECT punch_card_target INTO v_target FROM gym_products WHERE id = NEW.product_id;
  IF v_target IS NULL OR v_target < 2 OR NEW.punches <> v_target - 1 THEN
    RETURN NEW; -- only fire at exactly one-away
  END IF;

  PERFORM public._notify_push(
    NEW.member_id, NEW.gym_id, 'member'::user_role, 'reward'::notification_type,
    'One stamp to go 🎁',
    'Just one more visit and your punch card reward is yours.',
    'Te falta un sello 🎁',
    'Una visita más y tu recompensa de la tarjeta es tuya.',
    jsonb_build_object('route', '/rewards', 'punch_card_id', NEW.id),
    'punch_onetogo_' || NEW.id::text || '_' || NEW.total_completed::text  -- once per card cycle
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_punch_card_one_to_go failed (card %): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_punch_card_one_to_go ON member_punch_cards;
CREATE TRIGGER trg_punch_card_one_to_go
  AFTER UPDATE OF punches ON member_punch_cards
  FOR EACH ROW EXECUTE FUNCTION fire_punch_card_one_to_go();

NOTIFY pgrst, 'reload schema';
