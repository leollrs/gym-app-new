export const USERS = {
  "current_user": {
    id: "user_1",
    username: "fitleo",
    displayName: "Leo",
    friends: ["user_2", "user_3"],
    goals: "Build muscle, increase strength",
    joinDate: "2024-01-15",
  },
  "user_2": {
    id: "user_2",
    username: "gymbro_mark",
    displayName: "Mark",
    friends: ["user_1"],
    goals: "Stay fit",
    joinDate: "2024-02-10",
  },
  "user_3": {
    id: "user_3",
    username: "sarah_lifts",
    displayName: "Sarah",
    friends: ["user_1"],
    goals: "Marathon prep",
    joinDate: "2024-03-01",
  }
};

export const EXERCISES = [
  { id: "e1", name: "Barbell Bench Press", targetMuscles: ["Chest", "Triceps"] },
  { id: "e2", name: "Barbell Squat", targetMuscles: ["Quads", "Glutes"] },
  { id: "e3", name: "Deadlift", targetMuscles: ["Hamstrings", "Back"] },
  { id: "e4", name: "Pull-ups", targetMuscles: ["Lats", "Biceps"] },
  { id: "e5", name: "Overhead Press", targetMuscles: ["Shoulders", "Triceps"] },
];

export const WORKOUT_TEMPLATES = [
  {
    id: "tpl_1",
    authorId: "system",
    name: "Push Day Power",
    description: "Heavy chest, shoulders, and triceps.",
    exercises: [
      { exerciseId: "e1", defaultSets: 3, defaultReps: 8 },
      { exerciseId: "e5", defaultSets: 3, defaultReps: 10 },
    ]
  },
  {
    id: "tpl_2",
    authorId: "user_2",
    name: "Mark's Leg Day Killer",
    description: "Squats to failure.",
    exercises: [
      { exerciseId: "e2", defaultSets: 5, defaultReps: 5 },
    ]
  }
];

export const WORKOUT_LOGS = [
  {
    id: "log_1",
    userId: "user_1",
    date: "2024-03-10T10:00:00Z",
    workoutName: "Push Day Power",
    exercises: [
      {
        exerciseId: "e1",
        sets: [
          { reps: 8, weight: 135, isPr: false },
          { reps: 8, weight: 135, isPr: false },
          { reps: 7, weight: 135, isPr: false },
        ]
      }
    ]
  }
];

// Progressive Overload Utility
export const suggestNextTargets = (exerciseId, userLogs) => {
  // Finds the last time the user did this exercise, calculates the max weight/reps,
  // and suggests +5 lbs or +1 rep depending on goals.
  const pastLogs = userLogs.filter(log => log.exercises.some(e => e.exerciseId === exerciseId));
  if (pastLogs.length === 0) return { suggestedWeight: "Start light", suggestedReps: 10 };
  
  // Very rough mock logic:
  const lastLog = pastLogs[pastLogs.length - 1];
  const exLog = lastLog.exercises.find(e => e.exerciseId === exerciseId);
  const bestSet = exLog.sets.reduce((best, current) => current.weight > best.weight ? current : best, exLog.sets[0]);
  
  return {
    suggestedWeight: bestSet.weight + 5,
    suggestedReps: bestSet.reps,
    note: "Added 5 lbs for progressive overload!"
  };
};
