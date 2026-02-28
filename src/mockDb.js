// Mock Database for B2C Gym App Experience

export const currentUser = {
    id: 'u1',
    username: 'iron_lifter_99',
    fullName: 'Alex Chen',
    avatarUrl: 'https://i.pravatar.cc/150?img=11',
    joinDate: '2023-11-15',
    homeGym: 'IronForge Barbell Club',
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
