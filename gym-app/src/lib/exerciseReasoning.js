/**
 * exerciseReasoning.js
 *
 * Generates human-readable explanations for why an exercise was chosen
 * in a generated program, based on the user's onboarding profile and
 * the exercise's metadata. No API calls — pure template-based logic.
 */

// ── Goal descriptions ────────────────────────────────────────────────────────
const GOAL_LABELS = {
  muscle_gain:     { en: 'muscle gain',      es: 'ganancia muscular' },
  fat_loss:        { en: 'fat loss',          es: 'pérdida de grasa' },
  strength:        { en: 'strength',          es: 'fuerza' },
  endurance:       { en: 'endurance',         es: 'resistencia' },
  general_fitness: { en: 'general fitness',   es: 'fitness general' },
};

// Compound exercises — exercises that work multiple joints
const COMPOUND_IDS = new Set([
  'ex_bp', 'ex_ibp', 'ex_dcbp', 'ex_dbp', 'ex_idbp', 'ex_ddbp', 'ex_dips', 'ex_smbp',
  'ex_row', 'ex_dbr', 'ex_cr', 'ex_seal', 'ex_pend', 'ex_tbr',
  'ex_dl', 'ex_rdl', 'ex_sldl', 'ex_trap', 'ex_sumo',
  'ex_squat', 'ex_fs', 'ex_bss', 'ex_lunge', 'ex_smsq', 'ex_gobs',
  'ex_ohp', 'ex_dbohp', 'ex_push', 'ex_arno', 'ex_smohp',
  'ex_pu', 'ex_chin', 'ex_pup',
]);

// Muscle-to-goal relevance
const MUSCLE_GOAL_MAP = {
  muscle_gain: {
    Chest: 'primary upper-body mass builder',
    Back: 'key for a balanced, muscular physique',
    Shoulders: 'essential for upper-body width',
    Legs: 'largest muscle group — major growth stimulus',
    Arms: 'direct arm hypertrophy',
    Core: 'stabiliser for heavy compound lifts',
  },
  fat_loss: {
    Chest: 'large muscle engagement for calorie burn',
    Back: 'high-calorie compound movements',
    Shoulders: 'metabolic conditioning',
    Legs: 'highest calorie expenditure per set',
    Arms: 'circuit-friendly isolation',
    Core: 'functional core conditioning',
  },
  strength: {
    Chest: 'bench press pattern — key strength indicator',
    Back: 'deadlift and row patterns — posterior chain power',
    Shoulders: 'overhead press pattern — upper-body strength',
    Legs: 'squat pattern — foundational strength movement',
    Arms: 'lockout and grip strength support',
    Core: 'bracing for heavy lifts',
  },
  endurance: {
    Chest: 'push endurance conditioning',
    Back: 'pull endurance conditioning',
    Shoulders: 'overhead endurance',
    Legs: 'lower-body stamina',
    Arms: 'grip and arm endurance',
    Core: 'postural endurance',
  },
  general_fitness: {
    Chest: 'well-rounded upper-body development',
    Back: 'posture and functional pulling strength',
    Shoulders: 'shoulder health and mobility',
    Legs: 'lower-body functional fitness',
    Arms: 'balanced arm development',
    Core: 'core stability for daily activities',
  },
};

/**
 * @param {object} exercise - { id, name, name_es, muscle, equipment, category }
 * @param {object} onboarding - { primary_goal, available_equipment, injuries_notes, fitness_level }
 * @param {string} lang - 'en' | 'es'
 * @returns {string[]} Array of reasoning strings
 */
export function getExerciseReasoning(exercise, onboarding, lang = 'en') {
  if (!exercise) return [];
  const reasons = [];
  const goal = onboarding?.primary_goal || 'general_fitness';
  const goalLabel = GOAL_LABELS[goal]?.[lang] || GOAL_LABELS.general_fitness[lang];
  const equipment = onboarding?.available_equipment || [];
  const injuries = (onboarding?.injuries_notes || '').toLowerCase();
  const isCompound = COMPOUND_IDS.has(exercise.id) || exercise.category === 'Strength';
  const exName = lang === 'es' && exercise.name_es ? exercise.name_es : exercise.name;
  const muscle = exercise.muscle || 'unknown';

  // 1. Goal-based reason
  const muscleGoalReason = MUSCLE_GOAL_MAP[goal]?.[muscle] || MUSCLE_GOAL_MAP.general_fitness[muscle];
  if (muscleGoalReason) {
    if (isCompound) {
      reasons.push(
        lang === 'es'
          ? `Compuesto principal para ${muscle.toLowerCase()} — ${muscleGoalReason} para tu objetivo de ${goalLabel}`
          : `Primary compound for ${muscle.toLowerCase()} — ${muscleGoalReason} for your ${goalLabel} goal`
      );
    } else {
      reasons.push(
        lang === 'es'
          ? `Trabaja ${muscle.toLowerCase()} — ${muscleGoalReason} para tu objetivo de ${goalLabel}`
          : `Targets ${muscle.toLowerCase()} — ${muscleGoalReason} for your ${goalLabel} goal`
      );
    }
  }

  // 2. Equipment-based reason
  if (exercise.equipment) {
    const equipLower = exercise.equipment.toLowerCase();
    const hasEquip = equipment.some(e => e.toLowerCase() === equipLower);
    if (hasEquip || equipLower === 'bodyweight') {
      reasons.push(
        lang === 'es'
          ? equipLower === 'bodyweight'
            ? 'No requiere equipamiento — se puede hacer en cualquier lugar'
            : `Seleccionado porque tienes acceso a ${exercise.equipment.toLowerCase()}`
          : equipLower === 'bodyweight'
            ? 'No equipment needed — can be done anywhere'
            : `Selected because you have access to ${exercise.equipment.toLowerCase()}`
      );
    }
  }

  // 3. Injury-based reason (check if this might be a substitution)
  if (injuries) {
    const lowerBack = /lower\s*back|lumbar|espalda\s*baja/i.test(injuries);
    const knee = /knee|rodilla/i.test(injuries);
    const shoulder = /shoulder|hombro/i.test(injuries);

    // Leg press instead of squats for lower back
    if (lowerBack && exercise.id === 'ex_lp') {
      reasons.push(
        lang === 'es'
          ? 'Prensa de piernas en lugar de sentadillas — protegiendo la espalda baja'
          : 'Leg press instead of squats — protecting lower back'
      );
    }
    // Machine exercises for shoulder issues
    if (shoulder && exercise.equipment === 'Machine' && muscle === 'Chest') {
      reasons.push(
        lang === 'es'
          ? 'Máquina elegida para reducir estrés en el hombro'
          : 'Machine selected to reduce shoulder stress'
      );
    }
    // Leg extension / hamstring curl for knee issues (less impact)
    if (knee && (exercise.id === 'ex_le' || exercise.id === 'ex_lc')) {
      reasons.push(
        lang === 'es'
          ? 'Movimiento controlado que reduce la carga sobre las rodillas'
          : 'Controlled movement that reduces knee joint loading'
      );
    }
    // General machine substitution for injuries
    if ((lowerBack || knee || shoulder) && exercise.equipment === 'Machine' && reasons.length < 2) {
      reasons.push(
        lang === 'es'
          ? 'Máquina guiada para un movimiento más seguro dado tu historial'
          : 'Guided machine path for safer movement given your history'
      );
    }
  }

  // 4. Category-based reason (if we still have room)
  if (reasons.length < 2) {
    if (exercise.category === 'Strength' && (goal === 'strength' || goal === 'muscle_gain')) {
      reasons.push(
        lang === 'es'
          ? 'Ejercicio de fuerza — ideal para progresión de cargas'
          : 'Strength exercise — ideal for progressive overload'
      );
    } else if (exercise.category === 'Hypertrophy' && goal === 'muscle_gain') {
      reasons.push(
        lang === 'es'
          ? 'Ejercicio de hipertrofia — rango de repeticiones óptimo para crecimiento'
          : 'Hypertrophy exercise — optimal rep range for growth'
      );
    } else if (exercise.category === 'Endurance' && (goal === 'endurance' || goal === 'fat_loss')) {
      reasons.push(
        lang === 'es'
          ? 'Alto volumen de repeticiones para resistencia y quema calórica'
          : 'High rep volume for endurance and calorie burn'
      );
    }
  }

  return reasons;
}
