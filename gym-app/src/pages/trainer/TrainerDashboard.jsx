import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import { subDays, format, startOfWeek } from 'date-fns';
import { Users, Dumbbell, TrendingUp, AlertTriangle, Activity, ChevronRight, CalendarDays } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TrainerDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [weekSessions, setWeekSessions] = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);

  useEffect(() => { document.title = 'Trainer - Dashboard | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    fetchDashboardData();
  }, [profile?.gym_id, profile?.id]);

  async function fetchDashboardData() {
    setLoading(true);
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
      const now = new Date().toISOString();

      // 1. Get assigned client IDs
      const { data: tcRows, error: tcError } = await supabase
        .from('trainer_clients')
        .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name, username, last_active_at, created_at)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true);
      if (tcError) logger.error('TrainerDashboard: failed to load clients:', tcError);

      const assignedClients = (tcRows || []).map(tc => tc.profiles).filter(Boolean);
      const clientIds = assignedClients.map(c => c.id);

      setClients(assignedClients);

      if (clientIds.length === 0) {
        setWeekSessions([]);
        setRecentSessions([]);
        setUpcomingSessions([]);
        setLoading(false);
        return;
      }

      // 2. Fetch week sessions, recent sessions, and upcoming scheduled sessions
      const [weekRes, recentRes, upcomingRes] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('id, profile_id, name, started_at, total_volume_lbs, duration_seconds')
          .in('profile_id', clientIds)
          .eq('status', 'completed')
          .gte('started_at', weekStart)
          .order('started_at', { ascending: false }),
        supabase
          .from('workout_sessions')
          .select('id, profile_id, name, started_at, total_volume_lbs')
          .in('profile_id', clientIds)
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(8),
        supabase
          .from('trainer_sessions')
          .select('id, client_id, title, scheduled_at, duration_mins, status, profiles!trainer_sessions_client_id_fkey(full_name)')
          .eq('trainer_id', profile.id)
          .gte('scheduled_at', now)
          .in('status', ['scheduled', 'confirmed'])
          .order('scheduled_at', { ascending: true })
          .limit(5),
      ]);

      if (weekRes.error) logger.error('TrainerDashboard: failed to load week sessions:', weekRes.error);
      if (recentRes.error) logger.error('TrainerDashboard: failed to load recent sessions:', recentRes.error);
      if (upcomingRes.error) logger.error('TrainerDashboard: failed to load upcoming sessions:', upcomingRes.error);
      setWeekSessions(weekRes.data || []);
      setRecentSessions(recentRes.data || []);
      setUpcomingSessions(upcomingRes.data || []);
    } catch (err) {
      logger.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Computed stats
  const totalClients = clients.length;

  const activeProfileIds = new Set(weekSessions.map((s) => s.profile_id));
  const activeThisWeek = activeProfileIds.size;

  const fourteenDaysAgo = subDays(new Date(), 14);
  const atRiskClients = clients
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

  // Map client id -> name
  const clientMap = {};
  clients.forEach((m) => {
    clientMap[m.id] = m.full_name || m.username || 'Unknown';
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
      label: 'My Clients',
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
      value: atRiskClients.length,
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
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">
        {/* Header */}
        <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-6">Dashboard</h1>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-4"
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

        {/* Upcoming Sessions + At-Risk Clients — side by side on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

        {/* Upcoming Sessions */}
        {upcomingSessions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
                <CalendarDays size={16} className="text-[#3B82F6]" />
                Upcoming Sessions
              </h2>
              <button
                onClick={() => navigate('/trainer/schedule')}
                className="text-[12px] text-[#D4AF37] flex items-center gap-0.5 hover:text-[#E5C94B] transition-colors"
              >
                View all <ChevronRight size={14} />
              </button>
            </div>
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06]">
              {upcomingSessions.map((session) => (
                <div key={session.id} className="flex items-center gap-3 p-4 hover:border-white/20 hover:bg-white/[0.03] transition-all">
                  <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                    <CalendarDays size={16} className="text-[#3B82F6]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[#E5E7EB] font-medium truncate">
                      {session.profiles?.full_name || 'Client'}
                    </p>
                    <p className="text-[11px] text-[#6B7280]">{session.title}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] text-[#9CA3AF]">
                      {format(new Date(session.scheduled_at), 'EEE, MMM d')}
                    </p>
                    <p className="text-[11px] text-[#6B7280]">
                      {format(new Date(session.scheduled_at), 'h:mm a')} · {session.duration_mins}m
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* At-Risk Clients */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              At-Risk Clients
            </h2>
            {atRiskClients.length > 5 && (
              <span className="text-[12px] text-[#D4AF37] flex items-center gap-0.5">
                View all <ChevronRight size={14} />
              </span>
            )}
          </div>

          {atRiskClients.length === 0 ? (
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-6 text-center">
              <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <TrendingUp size={20} className="text-[#10B981]" />
              </div>
              <p className="text-[14px] text-[#10B981] font-medium">All clients are active</p>
              <p className="text-[12px] text-[#6B7280] mt-1">
                Every client has worked out in the last 14 days
              </p>
            </div>
          ) : (
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06]">
              {atRiskClients.slice(0, 5).map((member) => {
                const name = member.full_name || member.username || 'Unknown';
                const daysInactive = getDaysInactive(member.last_active_at);
                return (
                  <div key={member.id} className="flex items-center gap-3 p-4 hover:bg-white/[0.03] transition-all">
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

        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-[14px] font-semibold text-[#E5E7EB] flex items-center gap-2 mb-3">
            <Activity size={16} className="text-[#D4AF37]" />
            Recent Activity
          </h2>

          {recentSessions.length === 0 ? (
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-6 text-center">
              <p className="text-[13px] text-[#6B7280]">No recent workouts from your clients</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06]">
              {recentSessions.map((session) => {
                const memberName = clientMap[session.profile_id] || 'Client';
                return (
                  <div key={session.id} className="flex items-center gap-3 p-4 hover:bg-white/[0.03] transition-all">
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
