import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, X, ChevronRight, Search, Filter, SortAsc, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { formatDistanceToNow, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';

// ── Client quick-preview modal ──────────────────────────────────────────────
const ClientPreview = ({ client, churnScore, onClose, onOpen }) => {
  const { t } = useTranslation('pages');

  const daysInactive = client.last_active_at
    ? Math.floor((Date.now() - new Date(client.last_active_at)) / 86400000)
    : null;
  const isActive = daysInactive !== null && daysInactive <= 7;
  const isAtRisk = churnScore
    ? churnScore.score >= 30
    : (daysInactive === null || daysInactive > 14);

  const statusLabel = isActive
    ? t('trainerClients.statusActive', 'Active')
    : isAtRisk
      ? t('trainerClients.statusAtRisk', 'At Risk')
      : t('trainerClients.statusInactive', 'Inactive');
  const statusColor = isActive
    ? 'text-emerald-400 bg-emerald-500/10'
    : isAtRisk
      ? 'text-amber-400 bg-amber-500/10'
      : 'text-[#6B7280] bg-white/5';

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-preview-title"
        className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <div className="flex justify-end p-3 pb-0">
          <button
            onClick={onClose}
            aria-label={t('trainerClients.close', 'Close')}
            className="text-[#6B7280] hover:text-[#E5E7EB] min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Avatar + Name */}
        <div className="flex flex-col items-center px-5 pb-4">
          <div className="w-16 h-16 rounded-full bg-[#1E293B] flex items-center justify-center mb-3 relative">
            <span className="text-[22px] font-bold text-[#9CA3AF]">{(client.full_name || 'U')[0]}</span>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0F172A] ${
              isActive ? 'bg-emerald-400' : isAtRisk ? 'bg-amber-400' : 'bg-[#374151]'
            }`} />
          </div>
          <p id="client-preview-title" className="text-[18px] font-bold text-[#E5E7EB] text-center">{client.full_name}</p>
          <span className={`mt-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-px bg-white/6 mx-5 rounded-xl overflow-hidden mb-5">
          {/* Last active */}
          <div className="bg-[#111827] px-3.5 py-3">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wide mb-0.5">{t('trainerClients.lastActive', 'Last Active')}</p>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">
              {client.last_active_at
                ? formatDistanceToNow(new Date(client.last_active_at), { addSuffix: true })
                : t('trainerClients.never', 'Never')}
            </p>
          </div>

          {/* Recent workouts */}
          <div className="bg-[#111827] px-3.5 py-3">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wide mb-0.5">{t('trainerClients.recentWorkouts', 'Workouts (14d)')}</p>
            <p className="text-[13px] font-semibold text-[#E5E7EB]">{client.recentWorkouts ?? 0}</p>
          </div>

          {/* Program */}
          <div className="bg-[#111827] px-3.5 py-3">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wide mb-0.5">{t('trainerClients.program', 'Program')}</p>
            <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
              {client.assigned_program_id
                ? t('trainerClients.assigned', 'Assigned')
                : t('trainerClients.none', 'None')}
            </p>
          </div>

          {/* Churn risk */}
          <div className="bg-[#111827] px-3.5 py-3">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wide mb-0.5">{t('trainerClients.churnRisk', 'Churn Risk')}</p>
            {churnScore && churnScore.score >= 30 ? (
              <p className={`text-[13px] font-semibold ${
                churnScore.score >= 80 ? 'text-red-400' : churnScore.score >= 55 ? 'text-orange-400' : 'text-yellow-400'
              }`}>
                {Math.round(churnScore.score)}%
              </p>
            ) : (
              <p className="text-[13px] font-semibold text-emerald-400">{t('trainerClients.low', 'Low')}</p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-5 pb-5 space-y-2.5">
          <button
            onClick={onOpen}
            className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#E5C94B] text-black font-bold rounded-xl py-3 text-[14px] transition-colors min-h-[44px]"
          >
            <ExternalLink size={16} />
            {t('trainerClients.openClient', 'Open Client')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Filter / sort constants ──────────────────────────────────────────────────
const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'active',     label: 'Active' },
  { key: 'at_risk',    label: 'At Risk' },
  { key: 'has_program',label: 'Has Program' },
  { key: 'no_program', label: 'No Program' },
];

const SORTS = [
  { key: 'last_active', label: 'Last Active' },
  { key: 'name',        label: 'Name' },
  { key: 'workouts',    label: 'Recent Workouts' },
];

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerClients() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [clients,  setClients]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [sortBy,   setSortBy]   = useState('last_active');
  const [showFilters, setShowFilters] = useState(false);
  const [churnScores, setChurnScores] = useState({});

  function getChurnLevel(score) {
    if (score >= 80) return { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
    if (score >= 55) return { label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' };
    return { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' };
  }

  useEffect(() => { document.title = 'Trainer - Clients | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.gym_id || !profile?.id) return;
    const load = async () => {
      setLoading(true);
      const fourteenDaysAgo = subDays(new Date(), 14).toISOString();

      // Fetch only assigned clients via trainer_clients join
      const { data: tcRows, error: tcError } = await supabase
        .from('trainer_clients')
        .select(`
          client_id,
          notes,
          profiles!trainer_clients_client_id_fkey (
            id, full_name, username, last_active_at, created_at, assigned_program_id
          )
        `)
        .eq('trainer_id', profile.id)
        .eq('is_active', true);
      if (tcError) logger.error('TrainerClients: failed to load clients:', tcError);

      const assignedClients = (tcRows || [])
        .map(tc => tc.profiles)
        .filter(Boolean);

      if (assignedClients.length === 0) {
        setClients([]);
        setLoading(false);
        return;
      }

      const clientIds = assignedClients.map(c => c.id);

      const { data: recentSessions, error: recSessError } = await supabase
        .from('workout_sessions')
        .select('profile_id')
        .in('profile_id', clientIds)
        .eq('status', 'completed')
        .gte('started_at', fourteenDaysAgo);
      if (recSessError) logger.error('TrainerClients: failed to load recent sessions:', recSessError);

      const recentCounts = {};
      (recentSessions || []).forEach(s => {
        recentCounts[s.profile_id] = (recentCounts[s.profile_id] || 0) + 1;
      });

      // Fetch churn risk scores
      const { data: churnRows, error: churnError } = await supabase
        .from('churn_risk_scores')
        .select('profile_id, score, key_signals, computed_at')
        .in('profile_id', clientIds);
      if (churnError) logger.error('TrainerClients: failed to load churn scores:', churnError);

      const churnMap = {};
      (churnRows || []).forEach(row => { churnMap[row.profile_id] = row; });
      setChurnScores(churnMap);

      setClients(assignedClients.map(m => ({ ...m, recentWorkouts: recentCounts[m.id] ?? 0 })));
      setLoading(false);
    };
    load();
  }, [profile?.gym_id, profile?.id]);

  // Client-side search, filter, sort
  const filtered = useMemo(() => {
    let list = [...clients];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.full_name?.toLowerCase().includes(q) ||
        c.username?.toLowerCase().includes(q)
      );
    }

    // Filter
    const now = Date.now();
    if (filter === 'active') {
      list = list.filter(c => c.last_active_at && (now - new Date(c.last_active_at)) / 86400000 <= 7);
    } else if (filter === 'at_risk') {
      list = list.filter(c => {
        const churn = churnScores[c.id];
        if (churn) return churn.score >= 30;
        return !c.last_active_at || (now - new Date(c.last_active_at)) / 86400000 > 14;
      });
    } else if (filter === 'has_program') {
      list = list.filter(c => c.assigned_program_id);
    } else if (filter === 'no_program') {
      list = list.filter(c => !c.assigned_program_id);
    }

    // Sort
    if (sortBy === 'name') {
      list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    } else if (sortBy === 'workouts') {
      list.sort((a, b) => b.recentWorkouts - a.recentWorkouts);
    } else {
      list.sort((a, b) => {
        const aT = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
        const bT = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
        return bT - aT;
      });
    }

    return list;
  }, [clients, search, filter, sortBy, churnScores]);

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">My Clients</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">{clients.length} assigned client{clients.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Search + Filter bar */}
      {!loading && clients.length > 0 && (
        <div className="mb-4 space-y-3 md:sticky md:top-0 md:z-10 md:bg-[#05070B] md:pb-2">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients…"
              aria-label="Search clients"
              className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          {/* Filter / Sort row */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                filter !== 'all'
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                  : 'bg-[#111827] text-[#9CA3AF] hover:text-[#E5E7EB]'
              }`}
            >
              <Filter size={12} />
              {FILTERS.find(f => f.key === filter)?.label || 'Filter'}
            </button>
            <button
              onClick={() => {
                const idx = SORTS.findIndex(s => s.key === sortBy);
                setSortBy(SORTS[(idx + 1) % SORTS.length].key);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#111827] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
            >
              <SortAsc size={12} />
              {SORTS.find(s => s.key === sortBy)?.label}
            </button>
          </div>

          {/* Filter pills */}
          {showFilters && (
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => { setFilter(f.key); setShowFilters(false); }}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    filter === f.key
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'bg-[#111827] text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-20">
          <Users size={32} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No clients assigned yet</p>
          <p className="text-[12px] text-[#6B7280] mt-1">Ask your admin to assign clients to you</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Search size={24} className="text-[#6B7280] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No clients match your filters</p>
          <button onClick={() => { setSearch(''); setFilter('all'); }}
            className="text-[12px] text-[#D4AF37] mt-2 hover:text-[#E5C94B] transition-colors">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

            {filtered.map(c => {
              const daysInactive = c.last_active_at
                ? Math.floor((Date.now() - new Date(c.last_active_at)) / 86400000)
                : null;
              const isActive = daysInactive !== null && daysInactive <= 7;
              const churn = churnScores[c.id];
              const isAtRisk = churn
                ? churn.score >= 30
                : (daysInactive === null || daysInactive > 14);
              const riskLevel = churn && churn.score >= 30 ? getChurnLevel(churn.score) : null;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-[#0F172A] border border-white/[0.06] rounded-2xl hover:border-white/20 hover:bg-white/[0.03] transition-all text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0 relative">
                    <span className="text-[13px] font-bold text-[#9CA3AF]">{(c.full_name || 'U')[0]}</span>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#05070B] ${
                      isActive ? 'bg-emerald-400' : isAtRisk ? 'bg-amber-400' : 'bg-[#374151]'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{c.full_name}</p>
                      {riskLevel && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${riskLevel.bg} ${riskLevel.color}`}>
                          {Math.round(churn.score)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {c.last_active_at
                        ? `Active ${formatDistanceToNow(new Date(c.last_active_at), { addSuffix: true })}`
                        : 'Never active'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-[12px] font-semibold text-[#9CA3AF]">{c.recentWorkouts}w / 14d</p>
                      {c.assigned_program_id && (
                        <p className="text-[10px] text-[#D4AF37]">Program assigned</p>
                      )}
                    </div>
                    <ChevronRight size={14} className="text-[#6B7280]" />
                  </div>
                </button>
              );
            })}

        </div>
      )}

      {selected && (
        <ClientPreview
          client={selected}
          churnScore={churnScores[selected.id]}
          onClose={() => setSelected(null)}
          onOpen={() => {
            setSelected(null);
            navigate(`/trainer/client/${selected.id}`);
          }}
        />
      )}
    </div>
  );
}
