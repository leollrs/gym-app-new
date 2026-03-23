import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Dumbbell, ArrowRight, ClipboardList, Scale, Users, Trophy, Sparkles, ChevronRight, Flame, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── Goal-based personalized messages ────────────────────────
const GOAL_MESSAGES = {
  muscle_gain:     { headline: 'Your muscle-building journey starts now', icon: 'Dumbbell' },
  fat_loss:        { headline: 'Your fat-loss transformation begins today', icon: 'Flame' },
  strength:        { headline: 'Time to start lifting heavier', icon: 'Trophy' },
  endurance:       { headline: 'Your endurance journey starts here', icon: 'Activity' },
  general_fitness: { headline: 'Your path to better fitness starts now', icon: 'Sparkles' },
};

const GOAL_ICON_MAP = { Dumbbell, Flame, Trophy, Activity, Sparkles };

// ── Quick tips data ─────────────────────────────────────────
const QUICK_TIPS = [
  {
    icon: ClipboardList,
    title: 'Log every set',
    desc: 'The app tracks your progress and tells you when to increase weight.',
  },
  {
    icon: Scale,
    title: 'Track your weight weekly',
    desc: 'Consistent weigh-ins help you spot trends and stay on track.',
  },
  {
    icon: Users,
    title: 'Add a gym buddy',
    desc: 'Members who train with friends are 2x more likely to stay consistent.',
  },
];

// ── Confetti particle component (CSS-animated gold sparkles) ─
const ConfettiParticles = () => {
  const particles = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: Math.random() * 2.5,
    duration: 2.5 + Math.random() * 2,
    size: 4 + Math.random() * 6,
    drift: (Math.random() - 0.5) * 120,
    opacity: 0.4 + Math.random() * 0.6,
  }));

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: p.left,
            top: '-10px',
            width: p.size,
            height: p.size,
            background: `radial-gradient(circle, #D4AF37 0%, #F5D76E 60%, transparent 100%)`,
            opacity: 0,
            animation: `confetti-fall ${p.duration}s ${p.delay}s ease-in infinite`,
            '--drift': `${p.drift}px`,
            '--particle-opacity': p.opacity,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) translateX(0) rotate(0deg) scale(0);
            opacity: 0;
          }
          10% {
            opacity: var(--particle-opacity, 0.7);
            transform: translateY(8vh) translateX(calc(var(--drift) * 0.2)) rotate(90deg) scale(1);
          }
          80% {
            opacity: var(--particle-opacity, 0.7);
          }
          100% {
            transform: translateY(105vh) translateX(var(--drift)) rotate(720deg) scale(0.3);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
};

// ── Stagger animation variants ──────────────────────────────
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: [0.175, 0.885, 0.32, 1.1] } },
};

// ── Main component ──────────────────────────────────────────
const FirstWorkoutWelcome = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [onboardingData, setOnboardingData] = useState(null);
  const [firstRoutineId, setFirstRoutineId] = useState(null);
  const [hasRoutines, setHasRoutines] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      // Fetch onboarding data for personalization
      const [onboardingRes, routinesRes] = await Promise.all([
        supabase
          .from('member_onboarding')
          .select('primary_goal, fitness_level')
          .eq('profile_id', user.id)
          .maybeSingle(),
        supabase
          .from('routines')
          .select('id, name, created_at')
          .eq('created_by', user.id)
          .eq('is_template', false)
          .order('created_at', { ascending: true })
          .limit(1),
      ]);

      if (onboardingRes.data) {
        setOnboardingData(onboardingRes.data);
      }

      if (routinesRes.data && routinesRes.data.length > 0) {
        setFirstRoutineId(routinesRes.data[0].id);
        setHasRoutines(true);
      }

      setLoading(false);
    };

    fetchData();
  }, [user]);

  const goalInfo = GOAL_MESSAGES[onboardingData?.primary_goal] || GOAL_MESSAGES.general_fitness;

  const handleStartWorkout = () => {
    if (firstRoutineId) {
      navigate(`/session/${firstRoutineId}`);
    } else {
      navigate('/workouts');
    }
  };

  const handleExplore = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          <p className="text-[13px] text-[#4B5563]">Preparing your plan...</p>
        </div>
      </div>
    );
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="min-h-screen bg-[#05070B] relative overflow-hidden">
      {!prefersReducedMotion && <ConfettiParticles />}

      <div className="relative z-10 px-5 py-10 flex flex-col items-center">
        <motion.div
          className="w-full max-w-[460px]"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* ── Celebration header ── */}
          <motion.div className="text-center mb-8" variants={scaleIn}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 mb-5">
              <Sparkles size={28} className="text-[#D4AF37]" strokeWidth={2} />
            </div>
            <h1 className="text-[28px] font-bold text-[#E5E7EB] mb-2">
              You're all set! {'\u{1F389}'}
            </h1>
            <p className="text-[15px] text-[#9CA3AF]">
              {(() => { const GIcon = GOAL_ICON_MAP[goalInfo.icon]; return GIcon ? <GIcon size={16} className="inline mr-1 text-[#D4AF37]" /> : null; })()}{goalInfo.headline}
            </p>
          </motion.div>

          {/* ── Primary CTA — Start First Workout ── */}
          <motion.div className="mb-4" variants={itemVariants}>
            <button
              onClick={handleStartWorkout}
              className="w-full flex items-center justify-center gap-3 bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[16px] py-4 px-6 rounded-[14px] transition-all shadow-[0_0_30px_rgba(212,175,55,0.15)]"
            >
              <Dumbbell size={20} strokeWidth={2.5} />
              {hasRoutines ? 'Start Your First Workout' : 'Browse Your Workouts'}
              <ArrowRight size={18} strokeWidth={2.5} />
            </button>
            {!hasRoutines && (
              <p className="text-[12px] text-[#6B7280] text-center mt-2">
                Your auto-generated program is waiting for you
              </p>
            )}
          </motion.div>

          {/* ── Secondary link — Explore ── */}
          <motion.div className="mb-8" variants={itemVariants}>
            <button
              onClick={handleExplore}
              className="w-full text-center text-[14px] text-[#9CA3AF] hover:text-[#E5E7EB] py-2 transition-colors"
            >
              Explore the app first
            </button>
          </motion.div>

          {/* ── First Week Challenge card ── */}
          <motion.div className="mb-6" variants={itemVariants}>
            <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-5">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-[#D4AF37]/12 border border-[#D4AF37]/25 flex items-center justify-center">
                  <Trophy size={20} className="text-[#D4AF37]" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-[#E5E7EB] mb-1">First Week Challenge</p>
                  <p className="text-[13px] text-[#9CA3AF] leading-relaxed">
                    Complete 3 workouts this week to unlock the{' '}
                    <span className="text-[#D4AF37] font-semibold">Early Bird</span> badge
                  </p>
                </div>
              </div>

              {/* Progress dots */}
              <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/6">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="flex items-center gap-2 flex-1">
                    <div className="w-7 h-7 rounded-full border-2 border-white/10 flex items-center justify-center">
                      <span className="text-[11px] font-bold text-[#4B5563]">{n}</span>
                    </div>
                    <span className="text-[11px] text-[#4B5563]">
                      {n === 1 ? 'Today' : n === 2 ? 'Mid-week' : 'End of week'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* ── Quick tips ── */}
          <motion.div variants={itemVariants}>
            <p className="text-[11px] font-semibold text-[#4B5563] uppercase tracking-wider mb-3">
              Quick tips to get started
            </p>
            <div className="flex flex-col gap-2.5">
              {QUICK_TIPS.map((tip) => {
                const Icon = tip.icon;
                return (
                  <motion.div
                    key={tip.title}
                    className="bg-[#0F172A] rounded-[14px] border border-white/8 px-4 py-3.5 flex items-start gap-3.5"
                    variants={itemVariants}
                  >
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center mt-0.5">
                      <Icon size={17} className="text-[#9CA3AF]" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#E5E7EB] mb-0.5">{tip.title}</p>
                      <p className="text-[12px] text-[#6B7280] leading-relaxed">{tip.desc}</p>
                    </div>
                    <ChevronRight size={14} className="text-[#4B5563] flex-shrink-0 mt-1" />
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* Bottom spacer for mobile */}
          <div className="h-10" />
        </motion.div>
      </div>
    </div>
  );
};

export default FirstWorkoutWelcome;
