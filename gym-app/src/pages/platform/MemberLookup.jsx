import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Search, ChevronDown, ChevronUp, ExternalLink, Shield, UserCog, Eye, X } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

const roleBadge = {
  super_admin: 'bg-[#D4AF37]/15 text-[#D4AF37]',
  admin:       'bg-indigo-500/15 text-indigo-400',
  trainer:     'bg-purple-500/15 text-purple-400',
  member:      'bg-white/5 text-[#9CA3AF]',
};

const statusBadge = {
  active:    'bg-emerald-500/15 text-emerald-400',
  frozen:    'bg-amber-500/15 text-amber-400',
  cancelled: 'bg-red-500/15 text-red-400',
  banned:    'bg-red-500/15 text-red-400',
};

function Badge({ label, variant }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${variant}`}>
      {label}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  );
}

function relativeDate(dateStr) {
  if (!dateStr) return 'Never';
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return 'Unknown';
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr), 'MMM d, yyyy');
  } catch {
    return '—';
  }
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function MemberLookup() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [detailData, setDetailData] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  const [loadingMembers, setLoadingMembers] = useState({});

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    const timeout = setTimeout(() => {
      performSearch(query.trim());
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  const performSearch = async (term) => {
    setSearching(true);
    setHasSearched(true);

    const pattern = `%${term}%`;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, gym_id, full_name, username, role, created_at, last_active_at, membership_status, is_onboarded, gyms(id, name, slug)')
      .or(`full_name.ilike.${pattern},username.ilike.${pattern}`)
      .limit(50)
      .order('full_name', { ascending: true });

    if (!error && data) {
      setResults(data);
    } else {
      setResults([]);
    }
    setSearching(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim().length >= 2) {
      performSearch(query.trim());
    }
  };

  const toggleExpand = useCallback(async (memberId) => {
    if (expandedId === memberId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(memberId);

    // If already fetched or currently being fetched, don't re-fetch
    if (detailData[memberId]) return;
    if (loadingMembers[memberId]) return;
    setLoadingMembers(prev => ({ ...prev, [memberId]: true }));

    setDetailLoading((prev) => ({ ...prev, [memberId]: true }));

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all detail data in parallel
    const [sessionsRes, recentSessionsRes, checkInsRes, streakRes, churnRes] = await Promise.all([
      // Total sessions + total volume
      supabase
        .from('workout_sessions')
        .select('id, started_at, duration_seconds, total_volume_lbs, status')
        .eq('profile_id', memberId)
        .eq('status', 'completed'),

      // Sessions last 30 days
      supabase
        .from('workout_sessions')
        .select('id, started_at, duration_seconds, total_volume_lbs')
        .eq('profile_id', memberId)
        .eq('status', 'completed')
        .gte('started_at', thirtyDaysAgo)
        .order('started_at', { ascending: false })
        .limit(5),

      // Check-ins last 30 days
      supabase
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', memberId)
        .gte('checked_in_at', thirtyDaysAgo),

      // Current streak
      supabase
        .from('streak_cache')
        .select('current_streak')
        .eq('profile_id', memberId)
        .single(),

      // Churn risk
      supabase
        .from('churn_risk_scores')
        .select('score, risk_tier, computed_at')
        .eq('profile_id', memberId)
        .order('computed_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const allSessions = sessionsRes.data || [];
    const totalVolume = allSessions.reduce((sum, s) => sum + (s.total_volume_lbs || 0), 0);
    const sessionsLast30 = recentSessionsRes.data || [];

    setDetailData((prev) => ({
      ...prev,
      [memberId]: {
        totalSessions: allSessions.length,
        sessionsLast30d: sessionsLast30.length,
        totalVolume,
        recentSessions: sessionsLast30,
        checkIns30d: checkInsRes.count || 0,
        currentStreak: streakRes.data?.current_streak || 0,
        churnScore: churnRes.data?.score ?? null,
        churnTier: churnRes.data?.risk_tier || null,
        churnComputedAt: churnRes.data?.computed_at || null,
      },
    }));

    setDetailLoading((prev) => ({ ...prev, [memberId]: false }));
    setLoadingMembers(prev => ({ ...prev, [memberId]: false }));
  }, [expandedId, detailData, loadingMembers]);

  const churnTierColor = (tier) => {
    if (!tier) return 'text-[#6B7280]';
    switch (tier.toLowerCase()) {
      case 'high': return 'text-red-400';
      case 'medium': return 'text-amber-400';
      case 'low': return 'text-emerald-400';
      default: return 'text-[#9CA3AF]';
    }
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[22px] md:text-[26px] font-bold text-[#E5E7EB]">Member Lookup</h1>
        <p className="text-[13px] text-[#6B7280] mt-1">Search any member across all gyms</p>
      </div>

      {/* Search Input */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4B5563]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search members by name or username..."
          className="bg-[#111827] border border-white/6 rounded-xl pl-12 pr-10 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 w-full transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4B5563] hover:text-[#9CA3AF] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* States */}
      {searching && <Spinner />}

      {!searching && !hasSearched && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Search className="w-12 h-12 text-[#1F2937] mb-4" />
          <p className="text-[15px] text-[#6B7280]">Search for any member across all gyms</p>
        </div>
      )}

      {!searching && hasSearched && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Search className="w-12 h-12 text-[#1F2937] mb-4" />
          <p className="text-[15px] text-[#6B7280]">
            No members found matching &lsquo;{query}&rsquo;
          </p>
        </div>
      )}

      {/* Results List */}
      {!searching && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] text-[#6B7280] mb-3">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </p>

          {results.map((member) => {
            const isExpanded = expandedId === member.id;
            const detail = detailData[member.id];
            const isLoadingDetail = detailLoading[member.id];
            const initial = (member.full_name || member.username || '?').charAt(0).toUpperCase();

            return (
              <div key={member.id} className="bg-[#0F172A] border border-white/6 rounded-xl overflow-hidden">
                {/* Row */}
                <button
                  onClick={() => toggleExpand(member.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-[14px] font-semibold text-[#D4AF37]">{initial}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-medium text-[#E5E7EB] truncate">
                        {member.full_name || 'No name'}
                      </span>
                      {member.username && (
                        <span className="text-[12px] text-[#6B7280] truncate">@{member.username}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[12px] text-[#9CA3AF] truncate">
                        {member.gyms?.name || 'No gym'}
                      </span>
                      <Badge label={member.role || 'member'} variant={roleBadge[member.role] || roleBadge.member} />
                      <Badge
                        label={member.membership_status || 'active'}
                        variant={statusBadge[member.membership_status] || statusBadge.active}
                      />
                    </div>
                  </div>

                  {/* Right side: dates + chevron */}
                  <div className="hidden sm:flex flex-col items-end flex-shrink-0 mr-2">
                    <span className="text-[11px] text-[#6B7280]">
                      Active {relativeDate(member.last_active_at)}
                    </span>
                    <span className="text-[11px] text-[#4B5563]">
                      Joined {formatDate(member.created_at)}
                    </span>
                  </div>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                  )}
                </button>

                {/* Expanded Detail Panel */}
                {isExpanded && (
                  <div className="border-t border-white/6 px-4 py-4">
                    {isLoadingDetail ? (
                      <Spinner />
                    ) : detail ? (
                      <div className="space-y-5">
                        {/* Profile Info (mobile dates) */}
                        <div className="sm:hidden space-y-1">
                          <p className="text-[12px] text-[#6B7280]">
                            Active {relativeDate(member.last_active_at)}
                          </p>
                          <p className="text-[12px] text-[#4B5563]">
                            Joined {formatDate(member.created_at)}
                          </p>
                        </div>

                        {/* Profile Details */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-[#111827] rounded-lg p-3">
                            <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Total Sessions</p>
                            <p className="text-[18px] font-bold text-[#E5E7EB]">{detail.totalSessions}</p>
                          </div>
                          <div className="bg-[#111827] rounded-lg p-3">
                            <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Last 30 Days</p>
                            <p className="text-[18px] font-bold text-[#E5E7EB]">{detail.sessionsLast30d}</p>
                          </div>
                          <div className="bg-[#111827] rounded-lg p-3">
                            <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Total Volume</p>
                            <p className="text-[18px] font-bold text-[#E5E7EB]">
                              {detail.totalVolume >= 1000
                                ? `${(detail.totalVolume / 1000).toFixed(1)}k`
                                : detail.totalVolume}{' '}
                              <span className="text-[12px] font-normal text-[#6B7280]">lbs</span>
                            </p>
                          </div>
                          <div className="bg-[#111827] rounded-lg p-3">
                            <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Check-ins (30d)</p>
                            <p className="text-[18px] font-bold text-[#E5E7EB]">{detail.checkIns30d}</p>
                          </div>
                        </div>

                        {/* Streak & Churn Row */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-[#111827] rounded-lg p-3">
                            <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Current Streak</p>
                            <p className="text-[18px] font-bold text-[#D4AF37]">
                              {detail.currentStreak} <span className="text-[12px] font-normal text-[#6B7280]">days</span>
                            </p>
                          </div>
                          <div className="bg-[#111827] rounded-lg p-3">
                            <p className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">Churn Risk</p>
                            {detail.churnScore !== null ? (
                              <div className="flex items-baseline gap-2">
                                <p className="text-[18px] font-bold text-[#E5E7EB]">
                                  {Math.round(detail.churnScore * 100)}%
                                </p>
                                <span className={`text-[12px] font-medium capitalize ${churnTierColor(detail.churnTier)}`}>
                                  {detail.churnTier}
                                </span>
                              </div>
                            ) : (
                              <p className="text-[14px] text-[#4B5563]">No data</p>
                            )}
                          </div>
                        </div>

                        {/* Recent Sessions */}
                        {detail.recentSessions.length > 0 && (
                          <div>
                            <p className="text-[12px] text-[#6B7280] uppercase tracking-wider mb-2">
                              Recent Sessions
                            </p>
                            <div className="space-y-1.5">
                              {detail.recentSessions.map((s) => (
                                <div
                                  key={s.id}
                                  className="flex items-center justify-between bg-[#111827] rounded-lg px-3 py-2"
                                >
                                  <span className="text-[13px] text-[#E5E7EB]">
                                    {formatDate(s.started_at)}
                                  </span>
                                  <div className="flex items-center gap-4">
                                    <span className="text-[12px] text-[#9CA3AF]">
                                      {formatDuration(s.duration_seconds)}
                                    </span>
                                    <span className="text-[12px] text-[#9CA3AF]">
                                      {s.total_volume_lbs
                                        ? `${s.total_volume_lbs.toLocaleString()} lbs`
                                        : '—'}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Quick Actions */}
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/6">
                          {member.gyms?.id && (
                            <button
                              onClick={() => navigate(`/platform/gym/${member.gyms.id}`)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              View Gym
                            </button>
                          )}
                          <button
                            onClick={() => {/* Future: change role modal */}}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            Change Role
                          </button>
                          <button
                            onClick={() => {/* Future: change status modal */}}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors"
                          >
                            <UserCog className="w-3.5 h-3.5" />
                            Change Status
                          </button>
                          {member.gyms?.id && (
                            <button
                              onClick={() => navigate(`/platform/gym/${member.gyms.id}?member=${member.id}`)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] border border-white/6 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-[#D4AF37]/30 transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View in Gym Admin
                            </button>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
