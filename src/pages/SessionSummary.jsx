import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Trophy, Dumbbell, Clock, Zap, BarChart2, CheckCircle, Share2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createNotification } from '../lib/notifications';

const MILESTONES = [1, 10, 25, 50, 100, 200, 365];

const formatTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec > 0 ? `${sec}s` : ''}`.trim();
  return `${sec}s`;
};

const formatVolume = (lbs) => {
  if (lbs >= 1000) return `${(lbs / 1000).toFixed(1)}k`;
  return Math.round(lbs).toString();
};

const StatCard = ({ icon: Icon, label, value, accent }) => (
  <div className="bg-white/5 rounded-2xl p-4 flex flex-col items-center gap-2 text-center">
    <Icon size={18} style={{ color: accent || '#D4AF37' }} strokeWidth={2} />
    <p className="text-[26px] font-black text-white leading-none">{value}</p>
    <p className="text-[11px] text-[#6B7280] uppercase tracking-wider font-semibold">{label}</p>
  </div>
);

const SessionSummary = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, profile } = useAuth();
  const [visible, setVisible] = useState(false);

  // Data passed from ActiveSession via navigate state
  const {
    routineName    = 'Workout',
    elapsedTime    = 0,
    totalVolume    = 0,
    completedSets  = 0,
    totalExercises = 0,
    sessionPRs     = [],
    completedAt    = new Date().toISOString(),
  } = location.state ?? {};

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Milestone + PR notifications
  useEffect(() => {
    if (!user?.id || !profile?.gym_id) return;
    const fire = async () => {
      // Count total completed sessions
      const { count } = await supabase
        .from('workout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('status', 'completed');

      if (MILESTONES.includes(count)) {
        await createNotification({
          profileId: user.id,
          gymId:     profile.gym_id,
          type:      'milestone',
          title:     `${count} workout${count === 1 ? '' : 's'} completed!`,
          body:      count === 1
            ? 'Welcome to your fitness journey. Keep it up!'
            : `You've hit ${count} workouts. Consistency is everything.`,
        });
      }

      // PR notifications
      if (sessionPRs?.length > 0) {
        await createNotification({
          profileId: user.id,
          gymId:     profile.gym_id,
          type:      'pr',
          title:     `${sessionPRs.length} new PR${sessionPRs.length > 1 ? 's' : ''} this session!`,
          body:      sessionPRs.slice(0, 3).map(p => p.exerciseName ?? p.exercise_name ?? 'Exercise').join(', '),
        });
      }
    };
    fire();
  }, [user?.id, profile?.gym_id]); // eslint-disable-line

  const dateStr = new Date(completedAt).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="fixed inset-0 bg-[#05070B] z-[110] overflow-y-auto">

      {/* Subtle glow backdrop */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(212,175,55,0.12) 0%, transparent 70%)',
        }}
      />

      <div
        className="relative min-h-screen flex flex-col items-center px-5 py-12 transition-all duration-700"
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(20px)' }}
      >
        {/* ── Checkmark ──────────────────────────────────────────── */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-6 mt-4"
          style={{
            background: 'rgba(212,175,55,0.15)',
            border: '2px solid rgba(212,175,55,0.4)',
            boxShadow: '0 0 40px rgba(212,175,55,0.25)',
          }}
        >
          <CheckCircle size={40} strokeWidth={2} style={{ color: '#D4AF37' }} />
        </div>

        {/* ── Title ──────────────────────────────────────────────── */}
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#D4AF37] mb-2">
          Workout Complete
        </p>
        <h1
          className="text-[32px] font-black text-white text-center leading-tight mb-1"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {routineName}
        </h1>
        <p className="text-[13px] text-[#6B7280] mb-10">{dateStr}</p>

        {/* ── Stats grid ─────────────────────────────────────────── */}
        <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-6">
          <StatCard icon={Clock}    label="Duration"   value={formatTime(elapsedTime)}   accent="#60A5FA" />
          <StatCard icon={BarChart2} label="Volume"    value={`${formatVolume(totalVolume)} lbs`} accent="#D4AF37" />
          <StatCard icon={Zap}      label="Sets Done"  value={completedSets}              accent="#34D399" />
          <StatCard icon={Dumbbell} label="Exercises"  value={totalExercises}             accent="#A78BFA" />
        </div>

        {/* ── PRs ────────────────────────────────────────────────── */}
        {sessionPRs.length > 0 && (
          <div
            className="w-full max-w-sm rounded-2xl p-5 mb-6"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} className="text-amber-400" />
              <p className="text-amber-400 font-bold text-[14px]">
                {sessionPRs.length} New Personal Record{sessionPRs.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {sessionPRs.map((pr, i) => (
                <div key={i} className="flex items-center justify-between">
                  <p className="text-[13px] text-[#E5E7EB] font-medium truncate flex-1 mr-3">
                    {pr.exercise}
                  </p>
                  <p className="text-[13px] text-amber-400 font-bold flex-shrink-0">
                    {pr.weight} lbs × {pr.reps}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── No PRs encouragement ───────────────────────────────── */}
        {sessionPRs.length === 0 && completedSets > 0 && (
          <div
            className="w-full max-w-sm rounded-2xl px-5 py-4 mb-6 text-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p className="text-[13px] text-[#9CA3AF]">
              Consistency builds PRs — keep showing up. 💪
            </p>
          </div>
        )}

        {/* ── Actions ────────────────────────────────────────────── */}
        <div className="w-full max-w-sm flex flex-col gap-3 mt-auto pt-4">
          <button
            onClick={() => navigate('/')}
            className="w-full bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[17px] py-4 rounded-2xl transition-colors"
          >
            Done
          </button>
          <button
            onClick={() => navigate('/workouts')}
            className="w-full bg-white/5 hover:bg-white/10 text-[#CBD5E1] font-semibold text-[15px] py-3.5 rounded-2xl transition-colors border border-white/8"
          >
            Back to Workouts
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionSummary;
