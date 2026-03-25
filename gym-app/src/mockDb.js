// Mock Database for B2C Gym App Experience

export const currentUser = {
    id: 'u1',
    username: 'iron_lifter_99',
    fullName: 'Alex Chen',
    avatarUrl: 'https://i.pravatar.cc/150?img=11',
    joinDate: '2023-11-15',
    homeGym: 'TuGymPR Demo Gym',
    stats: {
        workoutsCompleted: 142,
        currentStreak: 4,
        totalVolumeLbs: 850400,
        level: 12
    }
};

export const announcements = [
    {
        id: 'a1',
        title: 'Spring Lifting Competition!',
        message: 'Join the deadlift marathon starting March 1st. Talk to the front desk to register.',
        date: '2026-02-28',
        type: 'event'
    },
    {
        id: 'a2',
        title: 'New Equipment Alert',
        message: 'We just installed 3 new Rouge Power Racks in the main hall.',
        date: '2026-02-25',
        type: 'news'
    }
];

export const upcomingWorkouts = [
    {
        id: 'w1',
        name: 'Heavy Lower Body',
        date: 'Today',
        duration: '60 min',
        exercises: 6,
        type: 'hypertrophy'
    },
    {
        id: 'w2',
        name: 'Upper Body Pump',
        date: 'Tomorrow',
        duration: '45 min',
        exercises: 5,
        type: 'hypertrophy'
    }
];

export const recentActivity = [
    {
        id: 'ac1',
        userId: 'u2',
        username: 'sarah_squats',
        avatarUrl: 'https://i.pravatar.cc/150?img=5',
        action: 'hit a PR on squats',
        detail: '225 lbs x 3',
        time: '2 hours ago',
        likes: 12,
        comments: 2
    },
    {
        id: 'ac2',
        userId: 'u3',
        username: 'mike_lifts',
        avatarUrl: 'https://i.pravatar.cc/150?img=12',
        action: 'completed workout',
        detail: 'Back & Biceps Annihilation',
        time: '5 hours ago',
        likes: 8,
        comments: 0
    },
    {
        id: 'ac3',
        userId: 'u1',
        username: 'iron_lifter_99',
        avatarUrl: 'https://i.pravatar.cc/150?img=11',
        action: 'earned achievement',
        detail: 'Consistency King (100 workouts loggged)',
        time: 'Yesterday',
        likes: 24,
        comments: 5
    }
];

export const progressData = [
    { day: 'Mon', volume: 8500 },
    { day: 'Tue', volume: 12200 },
    { day: 'Wed', volume: 0 },
    { day: 'Thu', volume: 9400 },
    { day: 'Fri', volume: 14500 },
    { day: 'Sat', volume: 11000 },
    { day: 'Sun', volume: 0 },
];

// Personal Records — best set ever logged per exercise
export const personalRecords = {
    'ex_bp':   { weight: 205, reps: 5,  date: '2026-02-10', label: 'Barbell Bench Press' },
    'ex_sq':   { weight: 315, reps: 3,  date: '2026-01-28', label: 'Barbell Back Squat' },
    'ex_dl':   { weight: 385, reps: 2,  date: '2026-02-14', label: 'Conventional Deadlift' },
    'ex_ohp':  { weight: 135, reps: 5,  date: '2026-01-15', label: 'Overhead Press' },
    'ex_bbc':  { weight: 115, reps: 8,  date: '2026-02-01', label: 'Barbell Curl' },
    'ex_idbp': { weight: 80,  reps: 10, date: '2026-02-20', label: 'Incline Dumbbell Press' },
    'ex_bbr':  { weight: 185, reps: 6,  date: '2026-02-18', label: 'Barbell Row' },
};

// Workout history per routine — last session's sets for reference
export const workoutHistory = {
    cw1: {
        routineName: 'Push Day (Hypertrophy)',
        exercises: [
            { id: 'ex_bp',   name: 'Barbell Bench Press',   targetSets: 4, targetReps: '8-10',  restSeconds: 120, history: [{ weight: 185, reps: 10 }, { weight: 185, reps: 9 }, { weight: 185, reps: 8 }, { weight: 185, reps: 7 }] },
            { id: 'ex_idbp', name: 'Incline Dumbbell Press',targetSets: 3, targetReps: '10-12', restSeconds: 90,  history: [{ weight: 75, reps: 12 }, { weight: 75, reps: 10 }, { weight: 75, reps: 9 }] },
            { id: 'ex_tpd',  name: 'Tricep Pushdown',       targetSets: 4, targetReps: '12-15', restSeconds: 60,  history: [{ weight: 55, reps: 15 }, { weight: 55, reps: 13 }, { weight: 55, reps: 12 }, { weight: 55, reps: 11 }] },
        ]
    },
    cw2: {
        routineName: 'Pull & Abs',
        exercises: [
            { id: 'ex_dl',  name: 'Conventional Deadlift', targetSets: 4, targetReps: '3-5',   restSeconds: 180, history: [{ weight: 365, reps: 5 }, { weight: 365, reps: 4 }, { weight: 365, reps: 3 }, { weight: 345, reps: 5 }] },
            { id: 'ex_bbr', name: 'Barbell Row',           targetSets: 4, targetReps: '6-8',   restSeconds: 120, history: [{ weight: 175, reps: 8 }, { weight: 175, reps: 7 }, { weight: 175, reps: 6 }, { weight: 165, reps: 8 }] },
            { id: 'ex_lp',  name: 'Lat Pulldown',          targetSets: 3, targetReps: '10-12', restSeconds: 90,  history: [{ weight: 140, reps: 12 }, { weight: 140, reps: 10 }, { weight: 140, reps: 9 }] },
            { id: 'ex_llr', name: 'Hanging Leg Raise',     targetSets: 3, targetReps: '12-15', restSeconds: 60,  history: [{ weight: 0, reps: 15 }, { weight: 0, reps: 13 }, { weight: 0, reps: 12 }] },
        ]
    },
    cw3: {
        routineName: 'Leg Day Annihilation',
        exercises: [
            { id: 'ex_sq',   name: 'Barbell Back Squat',  targetSets: 5, targetReps: '5',     restSeconds: 180, history: [{ weight: 295, reps: 5 }, { weight: 295, reps: 5 }, { weight: 295, reps: 5 }, { weight: 285, reps: 5 }, { weight: 285, reps: 4 }] },
            { id: 'ex_lp_l', name: 'Leg Press',           targetSets: 4, targetReps: '10-12', restSeconds: 120, history: [{ weight: 360, reps: 12 }, { weight: 360, reps: 11 }, { weight: 360, reps: 10 }, { weight: 340, reps: 12 }] },
            { id: 'ex_lc',   name: 'Leg Curl',            targetSets: 3, targetReps: '12-15', restSeconds: 90,  history: [{ weight: 120, reps: 15 }, { weight: 120, reps: 13 }, { weight: 120, reps: 12 }] },
            { id: 'ex_hth',  name: 'Hip Thrust',          targetSets: 4, targetReps: '8-12',  restSeconds: 90,  history: [{ weight: 225, reps: 12 }, { weight: 225, reps: 10 }, { weight: 225, reps: 10 }, { weight: 225, reps: 9 }] },
            { id: 'ex_scr',  name: 'Standing Calf Raise', targetSets: 4, targetReps: '15-20', restSeconds: 60,  history: [{ weight: 180, reps: 20 }, { weight: 180, reps: 18 }, { weight: 180, reps: 16 }, { weight: 180, reps: 15 }] },
        ]
    }
};
