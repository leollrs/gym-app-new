import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { subDays, format, startOfWeek, endOfWeek } from 'date-fns';
import { Users, Dumbbell, TrendingUp, AlertTriangle, Activity, ChevronRight } from 'lucide-react';

export default function TrainerDashboard() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [weekSessions, setWeekSessions] = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);

  useEffect(() => {
    if (!profile?.gym_id) return;
    fetchDashboardData();
  }, [profile?.gym_id]);

  async function fetchDashboardData() {
    setLoading(true);
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();

      const [membersRes, weekSessionsRes, recentSessionsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, last_active_at, created_at')
          .eq('gym_id', profile.gym_id)
          .eq('role', 'member'),
        supabase
          .from('workout_sessions')
          .select('id, profile_id, name, started_at, total_volume_lbs, duration_seconds')
          .eq('gym_id', profile.gym_id)
          .eq('status', 'completed')
          .gte('started_at', weekStart)
          .order('started_at', { ascending: false }),
        supabase
          .from('workout_sessions')
          .select('id, profile_id, name, started_at, total_volume_lbs')
          .eq('gym_id', profile.gym_id)
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(8),
      ]);

      setMembers(membersRes.data || []);
      setWeekSessions(weekSessionsRes.data || []);
      setRecentSessions(recentSessionsRes.data || []);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Computed stats
  const totalClients = members.length;

  const activeProfileIds = new Set(weekSessions.map((s) => s.profile_id));
  const activeThisWeek = activeProfileIds.size;

  const fourteenDaysAgo = subDays(new Date(), 14);
  const atRiskMembers = members
    .filter((m) => {
      const lastActive = m.last_active_at ? new Date(m.last_active_at) : null;
      return !lastActive || lastActive < fourteenDaysAgo;
    })
    .sort((a, b) => {
      const aDate = a.last_active_at ? new Date(a.last_active_at) : new Date(0);
      const bDate = b.last_active_at ? new Date(b.last_active_at) : new Date(0);
      return aDate - bDate;
    });

  const workoutsThisWeek = weekSessions.length;

  // Map member id -> name for activity feed
  const memberMap = {};
  members.forEach((m) => {
    memberMap[m.id] = m.full_name || m.username || 'Unknown';
  });

  function getInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  function getDaysInactive(lastActiveAt) {
    if (!lastActiveAt) return '30+';
    const days = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24));
    return days;
  }

  function formatVolume(lbs) {
    if (!lbs) return '—';
    if (lbs >= 1000) return `${(lbs / 1000).toFixed(1)}k lbs`;
    return `${Math.round(lbs)} lbs`;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  const statCards = [
    {
      label: 'Total Clients',
      value: totalClients,
      icon: Users,
      color: '#3B82F6',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Active This Week',
      value: activeThisWeek,
      icon: Activity,
      color: '#10B981',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'At Risk',
      value: atRiskMembers.length,
      icon: AlertTriangle,
      color: '#F59E0B',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Workouts This Week',
      value: workoutsThisWeek,
      icon: Dumbbell,
      color: '#D4AF37',
      bg: 'bg-[#D4AF37]/10',
    },
  ];

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6">
        {/* Header */}
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6">Dashboard</h1>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="bg-[#0F172A] rounded-[14px] border border-white/[0.06] p-4"
              >
                <div
                  className={`w-9 h-9 ${card.bg} rounded-full flex items-center justify-center mb-3`}
                >
                  <Icon size={18} style={{ color: card.color }} />
                </div>
                <div className="text-[22px] font-bold text-[#E5E7EB]">{card.value}</div>
                <div className="text-[12px] text-[#6B7280] mt-0.5">{card.label}</div>
              </div>
            );
          })}
        </div>

        {/* At-Risk Clients */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              At-Risk Clients
            </h2>
            {atRiskMembers.length > 5 && (
              <span className="text-[12px] text-[#D4AF37] flex items-center gap-0.5">
                View all <ChevronRight size={14} />
              </span>
            )}
          </div>

          {atRiskMembers.length === 0 ? (
            <div className="bg-[#0F172A] rounded-[14px] border border-white/[0.06] p-6 text-center">
              <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <TrendingUp size={20} className="text-[#10B981]" />
              </div>
              <p className="text-[14px] text-[#10B981] font-medium">All clients are active</p>
              <p className="text-[12px] text-[#6B7280] mt-1">
                Every member has worked out in the last 14 days
              </p>
            </div>
          ) : (
            <div className="bg-[#0F172A] rounded-[14px] border border-white/[0.06] divide-y divide-white/[0.06]">
              {atRiskMembers.slice(0, 5).map((member) => {
                const name = member.full_name || member.username || 'Unknown';
                const daysInactive = getDaysInactive(member.last_active_at);
                return (
                  <div key={member.id} className="flex items-center gap-3 p-4">
                    <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                      <span className="text-[13px] font-semibold text-amber-500">
                        {getInitial(name)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[#E5E7EB] font-medium truncate">{name}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {member.last_active_at
                          ? `Last active ${format(new Date(member.last_active_at), 'MMM d')}`
                          : 'No activity recorded'}
                      </p>
                    </div>
                    <div className="shrink-0 px-2.5 py-1 rounded-full bg-amber-500/10">
                      <span className="text-[11px] font-medium text-amber-500">
                        Inactive {daysInactive} days
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2 mb-3">
            <Activity size={16} className="text-[#D4AF37]" />
            Recent Activity
          </h2>

          {recentSessions.length === 0 ? (
            <div className="bg-[#0F172A] rounded-[14px] border border-white/[0.06] p-6 text-center">
              <p className="text-[13px] text-[#6B7280]">No recent workouts</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] rounded-[14px] border border-white/[0.06] divide-y divide-white/[0.06]">
              {recentSessions.map((session) => {
                const memberName = memberMap[session.profile_id] || 'Member';
                return (
                  <div key={session.id} className="flex items-center gap-3 p-4">
                    <div className="w-9 h-9 rounded-full bg-[#D4AF37]/10 flex items-center justify-center shrink-0">
                      <Dumbbell size={16} className="text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[#E5E7EB] font-medium truncate">
                        {memberName}
                      </p>
                      <p className="text-[11px] text-[#6B7280] truncate">
                        {session.name || 'Workout'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] text-[#9CA3AF]">
                        {formatVolume(session.total_volume_lbs)}
                      </p>
                      <p className="text-[11px] text-[#6B7280]">
                        {format(new Date(session.started_at), 'MMM d')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
