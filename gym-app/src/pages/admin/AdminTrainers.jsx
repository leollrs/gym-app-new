import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, UserPlus, X, Search, Plus, Download, Trash2, BarChart3,
  ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Minus, ChevronRight, MoreHorizontal, MessageSquare,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { exportCSV } from '../../lib/csvExport';
import { useTranslation } from 'react-i18next';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { PageHeader, AdminCard, StatCard, Avatar, ErrorCard, AdminModal } from '../../components/admin';
import AdminTable from '../../components/admin/AdminTable';
import AddTrainerModal from './components/AddTrainerModal';
import ConfirmDemoteModal from './components/ConfirmDemoteModal';
import ContactPanel from './components/ContactPanel';
import CheckinPhotoEditor from '../../components/CheckinPhotoEditor';
import { signCheckinPhotos } from '../../lib/checkinPhoto';

const MS_PER_DAY = 86400000;
const EMPTY_WEEKS = [0, 0, 0, 0, 0, 0, 0, 0];

// ── Fetch function ────────────────────────────────────────────────────────

const fetchTrainerData = async (gymId) => {
  const now = new Date();
  const nowMs = now.getTime();
  const thirtyDaysAgo = subDays(now, 30).toISOString();
  const fiftySixDaysAgo = subDays(now, 56).toISOString();

  const results = await Promise.allSettled([
    supabase.from('profiles').select('id, full_name, username, created_at, checkin_photo_path, phone_number').eq('gym_id', gymId).eq('role', 'trainer'),
    supabase.from('trainer_clients').select('trainer_id, client_id, is_active, notes, assigned_at').eq('gym_id', gymId),
    // 8-week (56d) completed-session history — drives the activity sparkbars/sparkline.
    supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', fiftySixDaysAgo),
    supabase.from('profiles').select('id, full_name, username').eq('gym_id', gymId).eq('role', 'member'),
    supabase.from('churn_risk_scores').select('profile_id, score, risk_tier').eq('gym_id', gymId),
  ]);

  const extract = (r) => (r.status === 'fulfilled' ? r.value?.data ?? [] : []);
  const trainerRows = extract(results[0]);
  const tcRows = extract(results[1]);
  const sessions56 = extract(results[2]);
  const memberRows = extract(results[3]);
  const churnRows = extract(results[4]);

  const members = memberRows || [];
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });
  const churnMap = {};
  (churnRows || []).forEach(r => { churnMap[r.profile_id] = r; });

  // 30-day activity + recency, from the 56-day pull.
  const activeMembers = new Set();
  const sessionCountMap = {};
  const lastSessionMap = {};
  (sessions56 || []).forEach(s => {
    if (!s.started_at) return;
    if (s.started_at >= thirtyDaysAgo) {
      activeMembers.add(s.profile_id);
      sessionCountMap[s.profile_id] = (sessionCountMap[s.profile_id] || 0) + 1;
    }
    if (!lastSessionMap[s.profile_id] || s.started_at > lastSessionMap[s.profile_id]) {
      lastSessionMap[s.profile_id] = s.started_at;
    }
  });

  const relationships = tcRows || [];
  // client_id → trainer_id (active relationships only), for weekly bucketing.
  const clientToTrainer = {};
  relationships.forEach(tc => { if (tc.is_active) clientToTrainer[tc.client_id] = tc.trainer_id; });

  // Per-trainer weekly session buckets (index 0 = oldest of 8 weeks, 7 = this week).
  const trainerWeeks = {};
  const trainerLastSession = {};
  (sessions56 || []).forEach(s => {
    const trId = clientToTrainer[s.profile_id];
    if (!trId || !s.started_at) return;
    if (!trainerWeeks[trId]) trainerWeeks[trId] = [0, 0, 0, 0, 0, 0, 0, 0];
    const daysAgo = (nowMs - new Date(s.started_at).getTime()) / MS_PER_DAY;
    const weekIdx = Math.min(7, Math.max(0, Math.floor(daysAgo / 7)));
    trainerWeeks[trId][7 - weekIdx] += 1;
    if (!trainerLastSession[trId] || s.started_at > trainerLastSession[trId]) {
      trainerLastSession[trId] = s.started_at;
    }
  });

  const clientMap = {};
  const trainers = (trainerRows || []).map(t => {
    const clients = relationships.filter(tc => tc.trainer_id === t.id);
    const activeClients = clients.filter(tc => tc.is_active);
    const clientCount = activeClients.length;

    clientMap[t.id] = activeClients.map(tc => {
      const member = memberMap[tc.client_id];
      const churn = churnMap[tc.client_id];
      return {
        id: tc.client_id,
        name: member?.full_name || 'Unknown',
        username: member?.username || '',
        sessions30d: sessionCountMap[tc.client_id] || 0,
        isActive: activeMembers.has(tc.client_id),
        churnScore: churn?.score ?? null,
        churnTier: churn?.risk_tier ?? null,
        assignedAt: tc.assigned_at,
        lastSessionAt: lastSessionMap[tc.client_id] || null,
        notes: tc.notes,
      };
    });

    const clientsWithWorkout = activeClients.filter(tc => activeMembers.has(tc.client_id)).length;
    const retention = clientCount > 0 ? Math.round((clientsWithWorkout / clientCount) * 100) : 0;
    const totalClientSessions = activeClients.reduce((sum, tc) => sum + (sessionCountMap[tc.client_id] || 0), 0);
    const avgWorkouts = clientCount > 0 ? (totalClientSessions / clientCount / 4.33).toFixed(1) : '0.0';

    return {
      id: t.id,
      name: t.full_name || 'Unnamed',
      username: t.username || '',
      phone_number: t.phone_number || null,
      createdAt: t.created_at,
      checkinPhotoPath: t.checkin_photo_path || null,
      clientCount,
      retention,
      avgWorkouts,
      totalSessions: totalClientSessions,
      weeks: trainerWeeks[t.id] || [0, 0, 0, 0, 0, 0, 0, 0],
      lastSessionAt: trainerLastSession[t.id] || null,
    };
  });

  // Sign trainer-staff check-in reference photos in one batched call.
  try {
    const photoMap = await signCheckinPhotos(trainers.map(tr => tr.checkinPhotoPath));
    trainers.forEach(tr => { tr.checkinPhotoUrl = tr.checkinPhotoPath ? (photoMap.get(tr.checkinPhotoPath) || null) : null; });
  } catch { /* fall back to initials */ }

  trainers.sort((a, b) => b.clientCount - a.clientCount);

  // Roster-level stats for the KPI cards.
  const withClients = trainers.filter(tr => tr.clientCount > 0);
  const avgRetention = withClients.length
    ? Math.round(withClients.reduce((s, tr) => s + tr.retention, 0) / withClients.length)
    : 0;
  const atRiskClients = Object.values(clientMap).reduce(
    (s, list) => s + list.filter(c => c.churnTier === 'critical' || c.churnTier === 'high').length, 0);
  const totalClients = trainers.reduce((s, tr) => s + tr.clientCount, 0);

  return { trainers, clientMap, allMembers: members, stats: { avgRetention, atRiskClients, totalClients } };
};

// ── Visual helpers ──────────────────────────────────────────────────────────

const retColor = (v) => (v >= 85 ? 'var(--color-success)' : v >= 70 ? 'var(--color-warning)' : 'var(--color-danger)');

/** Derive a client status from the real churn + activity data. */
function clientStatus(c) {
  if (c.churnTier === 'critical' || c.churnTier === 'high') return 'riesgo';
  if (c.assignedAt && (Date.now() - new Date(c.assignedAt).getTime()) / MS_PER_DAY < 14 && c.sessions30d < 3) return 'nuevo';
  if (!c.isActive) return 'enfriando';
  return 'activo';
}
const STATUS_TONE = { activo: 'success', riesgo: 'hot', enfriando: 'warn', nuevo: 'info' };
const STATUS_COLOR = { activo: 'var(--color-success)', riesgo: 'var(--color-danger)', enfriando: 'var(--color-warning)', nuevo: 'var(--color-info)' };

function StatusDot({ status }) {
  return <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[status] || 'var(--color-admin-text-muted)' }} />;
}

function RetentionBar({ value, width = 84 }) {
  const c = retColor(value);
  return (
    <div className="flex items-center gap-2">
      <div className="h-[7px] rounded-full overflow-hidden flex-shrink-0" style={{ width, background: 'var(--color-bg-subtle)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: c }} />
      </div>
      <span className="admin-mono text-[12px] font-bold tabular-nums" style={{ color: c }}>{value}%</span>
    </div>
  );
}

function SparkBars({ data, width = 104, height = 26, color = 'var(--color-accent)' }) {
  const arr = (Array.isArray(data) && data.length) ? data : EMPTY_WEEKS;
  const max = Math.max(...arr, 1);
  const n = arr.length, gap = 2;
  const bw = (width - gap * (n - 1)) / n;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {arr.map((v, i) => {
        const h = v === 0 ? 2 : Math.max(3, (v / max) * height);
        return <rect key={i} x={i * (bw + gap)} y={height - h} width={bw} height={h} rx={1.5}
          fill={v === 0 ? 'var(--color-bg-subtle)' : color} opacity={v === 0 ? 1 : (0.45 + 0.55 * (v / max))} />;
      })}
    </svg>
  );
}

function SparkLine({ data, width = 240, height = 56, color = 'var(--color-accent)' }) {
  const arr = (Array.isArray(data) && data.length) ? data : EMPTY_WEEKS;
  const max = Math.max(...arr, 1), min = Math.min(...arr, 0);
  const span = max - min || 1;
  const pts = arr.map((v, i) => [(i / (arr.length - 1 || 1)) * width, height - ((v - min) / span) * (height - 4) - 2]);
  const dLine = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const dArea = `${dLine} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block', maxWidth: '100%' }}>
      <path d={dArea} fill={color} opacity={0.1} />
      <path d={dLine} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.6} fill={color} />
    </svg>
  );
}

function AvatarStack({ clients, max = 4 }) {
  const shown = clients.slice(0, max);
  const extra = clients.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((c, i) => (
        <div key={c.id || i} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: i }}>
          <Avatar name={c.name} size="xs" tone={STATUS_TONE[clientStatus(c)]} ring="var(--color-bg-card)" />
        </div>
      ))}
      {extra > 0 && (
        <div style={{ marginLeft: -8, zIndex: max, boxShadow: '0 0 0 2px var(--color-bg-card)' }}
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold admin-mono flex-shrink-0"
          aria-hidden="true">
          +{extra}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const fg = { brand: 'var(--color-accent)', good: 'var(--color-success)', risk: 'var(--color-danger)', neutral: 'var(--color-admin-text)' }[tone] || 'var(--color-admin-text)';
  return (
    <div className="flex-1 rounded-xl px-3.5 py-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
      <div className="admin-kpi text-[24px] leading-none tabular-nums" style={{ color: fg }}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>{label}</div>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────

export default function AdminTrainers() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsOpts = isEs ? { locale: esLocale } : undefined;
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const adminId = profile?.id;
  const { showToast } = useToast();

  useEffect(() => { document.title = t('admin.trainers.pageTitle', `Admin - Trainers | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

  const [view, setView] = useState('table');      // 'table' | 'detail'
  const [selectedId, setSelectedId] = useState(null);
  const [trainerSearch, setTrainerSearch] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [search, setSearch] = useState('');        // assign-member dropdown search
  const [assigning, setAssigning] = useState(false);
  const [showAddTrainer, setShowAddTrainer] = useState(false);
  const [confirmDemote, setConfirmDemote] = useState(null);
  const [confirmUnassign, setConfirmUnassign] = useState(null);
  const [unassigning, setUnassigning] = useState(false);
  const [demoting, setDemoting] = useState(false);
  const [detailMenuOpen, setDetailMenuOpen] = useState(false);
  const [contactTrainer, setContactTrainer] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: adminKeys.trainers(gymId),
    queryFn: () => fetchTrainerData(gymId),
    enabled: !!gymId,
  });

  const trainers = data?.trainers ?? [];
  const clientMap = data?.clientMap ?? {};
  const allMembers = data?.allMembers ?? [];
  const stats = data?.stats ?? { avgRetention: 0, atRiskClients: 0, totalClients: 0 };

  const filteredTrainers = useMemo(() => {
    const q = trainerSearch.trim().toLowerCase();
    if (!q) return trainers;
    return trainers.filter(tr => tr.name.toLowerCase().includes(q) || tr.username.toLowerCase().includes(q));
  }, [trainers, trainerSearch]);

  const selected = trainers.find(tr => tr.id === selectedId) || null;

  // ── Actions (unchanged) ──
  const assignClient = async (trainerId, memberId) => {
    setAssigning(true);
    try {
      const { error } = await supabase.from('trainer_clients').upsert({
        trainer_id: trainerId, client_id: memberId, gym_id: gymId, is_active: true,
      }, { onConflict: 'trainer_id,client_id' });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.assignError', 'Failed to assign client'), 'error');
    } finally {
      setAssigning(false);
    }
  };

  const unassignClient = async (trainerId, clientId) => {
    if (!gymId) { showToast(t('admin.trainers.unassignError', 'Failed to unassign client'), 'error'); return; }
    try {
      const { error } = await supabase.from('trainer_clients').update({ is_active: false })
        .eq('trainer_id', trainerId).eq('client_id', clientId).eq('gym_id', gymId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.unassignError', 'Failed to unassign client'), 'error');
    }
  };

  const promoteToTrainer = async (memberId) => {
    try {
      const { error: rpcErr } = await supabase.rpc('promote_member_to_trainer', { p_member_id: memberId });
      if (rpcErr) {
        const rpcMissing = (rpcErr.code === '42883' || rpcErr.code === 'PGRST202' || /does not exist/i.test(rpcErr.message || ''));
        if (!rpcMissing) throw rpcErr;
        const { error } = await supabase.from('profiles').update({ role: 'trainer' }).eq('id', memberId).eq('gym_id', gymId);
        if (error) throw error;
      }
      logAdminAction('add_trainer', 'trainer', memberId);
      setShowAddTrainer(false);
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.promoteError', 'Failed to promote member'), 'error');
    }
  };

  const demoteToMember = async (trainerId) => {
    if (demoting || !gymId) return;
    setDemoting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('demote_trainer_atomically', { p_trainer_id: trainerId });
      if (rpcErr) {
        const rpcMissing = (rpcErr.code === '42883' || rpcErr.code === 'PGRST202' || /does not exist/i.test(rpcErr.message || ''));
        if (!rpcMissing) throw rpcErr;
        let deactivatedTrainerClients = false;
        try {
          const { error: deactivateErr } = await supabase.from('trainer_clients').update({ is_active: false }).eq('trainer_id', trainerId).eq('gym_id', gymId);
          if (deactivateErr) throw deactivateErr;
          deactivatedTrainerClients = true;
          const { error: demoteErr } = await supabase.from('profiles').update({ role: 'member' }).eq('id', trainerId).eq('gym_id', gymId);
          if (demoteErr) throw demoteErr;
        } catch (innerErr) {
          if (deactivatedTrainerClients) {
            await supabase.from('trainer_clients').update({ is_active: true }).eq('trainer_id', trainerId).eq('gym_id', gymId).catch(() => {});
          }
          throw innerErr;
        }
      }
      logAdminAction('demote_trainer', 'trainer', trainerId);
      setConfirmDemote(null);
      setView('table');
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) });
    } catch (err) {
      showToast(err.message || t('admin.trainers.demoteError', 'Failed to demote trainer'), 'error');
    } finally {
      setDemoting(false);
    }
  };

  const unassignedMembers = (trainerId) => {
    const assigned = new Set((clientMap[trainerId] || []).map(c => c.id));
    return allMembers.filter(m =>
      !assigned.has(m.id) &&
      (m.full_name?.toLowerCase().includes(search.toLowerCase()) || m.username?.toLowerCase().includes(search.toLowerCase())));
  };

  const handleExport = () => {
    const rows = [];
    trainers.forEach(tr => {
      (clientMap[tr.id] || []).forEach(c => {
        rows.push({ trainer: tr.name, client: c.name, username: c.username, sessions30d: c.sessions30d, churnScore: c.churnScore ?? '', churnTier: c.churnTier ?? '' });
      });
    });
    exportCSV({
      filename: 'trainers',
      columns: [
        { key: 'trainer', label: t('admin.trainers.csvTrainer') },
        { key: 'client', label: t('admin.trainers.csvClient') },
        { key: 'username', label: t('admin.trainers.csvUsername', 'Username') },
        { key: 'sessions30d', label: t('admin.trainers.csvSessions30d') },
        { key: 'churnScore', label: t('admin.trainers.csvChurnScore') },
        { key: 'churnTier', label: t('admin.trainers.csvChurnTier') },
      ],
      data: rows,
    });
  };

  // Contact-log handlers for the Message panel (same admin_contact_log the churn
  // page uses, scoped to the trainer). Keeps a "contacted" history on staff too.
  const logTrainerContact = async (id, method, note) => {
    try {
      const { error } = await supabase.from('admin_contact_log').insert({ admin_id: adminId, member_id: id, gym_id: gymId, method, note });
      if (error) throw error;
    } catch (err) {
      showToast(err.message || t('admin.trainers.contactLogError', 'Could not log contact'), 'error');
    }
  };
  const unlogTrainerContact = async (id) => {
    try { await supabase.from('admin_contact_log').delete().eq('member_id', id).eq('gym_id', gymId); } catch { /* best-effort */ }
  };

  const openDetail = (id) => { setSelectedId(id); setView('detail'); setShowAssign(false); setDetailMenuOpen(false); window.scrollTo(0, 0); };

  const demoteTrainer = confirmDemote ? trainers.find(tr => tr.id === confirmDemote) : null;
  const demoteClientCount = confirmDemote ? (clientMap[confirmDemote] || []).length : 0;

  const headerActions = (
    <>
      <button onClick={handleExport}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors whitespace-nowrap"
        style={{ border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)', background: 'var(--color-bg-card)' }}>
        <Download size={13} /> {t('admin.trainers.export')}
      </button>
      <button onClick={() => setShowAddTrainer(true)}
        className="flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
        style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}>
        <Plus size={16} strokeWidth={2.6} /> {t('admin.trainers.addTrainer')}
      </button>
    </>
  );

  // ── Roster table columns (Direction A) ──
  const columns = [
    {
      key: 'name', label: t('admin.trainers.colTrainer', 'Trainer'), sortable: true,
      sortValue: (tr) => tr.name?.toLowerCase() || '',
      render: (tr) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={tr.name} size="md" variant="accent" src={tr.checkinPhotoUrl} />
          <div className="min-w-0">
            <div className="text-[14px] font-bold truncate" style={{ color: 'var(--color-admin-text)' }}>{tr.name}</div>
            {tr.username && <div className="text-[11.5px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>@{tr.username}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'clientCount', label: t('admin.trainers.clients', 'Clients'), sortable: true, width: '170px',
      sortValue: (tr) => tr.clientCount,
      render: (tr) => (
        <div className="flex items-center gap-2.5">
          <span className="admin-mono text-[15px] font-bold tabular-nums" style={{ color: 'var(--color-admin-text)', minWidth: 18 }}>{tr.clientCount}</span>
          <AvatarStack clients={clientMap[tr.id] || []} max={4} />
        </div>
      ),
    },
    {
      key: 'retention', label: t('admin.trainers.retention', 'Retention'), sortable: true, width: '140px',
      sortValue: (tr) => tr.retention,
      render: (tr) => (tr.clientCount === 0
        ? <span className="text-[12px]" style={{ color: 'var(--color-admin-text-faint)' }}>—</span>
        : <RetentionBar value={tr.retention} />),
    },
    {
      key: 'activity', label: t('admin.trainers.activity8w', 'Activity · 8 wk'), width: '150px',
      render: (tr) => (
        <div className="flex flex-col gap-1">
          <SparkBars data={tr.weeks} />
          <span className="text-[10.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
            {tr.lastSessionAt
              ? t('admin.trainers.activeAgo', { ago: formatDistanceToNow(new Date(tr.lastSessionAt), { addSuffix: true, ...dateFnsOpts }), defaultValue: 'active {{ago}}' })
              : t('admin.trainers.noActivity', 'no activity')}
          </span>
        </div>
      ),
    },
    {
      key: 'atRisk', label: t('admin.trainers.atRisk', 'At Risk'), width: '120px', align: 'center',
      render: (tr) => {
        const risk = (clientMap[tr.id] || []).filter(c => c.churnTier === 'critical' || c.churnTier === 'high').length;
        return risk > 0
          ? <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}>{t('admin.trainers.nAtRisk', { count: risk, defaultValue: '{{count}} at risk' })}</span>
          : <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold whitespace-nowrap" style={{ color: 'var(--color-success)' }}><StatusDot status="activo" /> {t('admin.trainers.allGood', 'On track')}</span>;
      },
    },
    {
      key: 'chevron', label: '', width: '44px', align: 'center',
      render: () => <ChevronRight size={16} style={{ color: 'var(--color-admin-text-faint)' }} />,
    },
  ];

  // ── Assign-client dropdown (inline render fn, NOT a nested component, so the
  // search input keeps focus across re-renders) ──
  const renderAssignDropdown = (trainerId) => (
    <div className="mb-3 rounded-xl p-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Search size={13} style={{ color: 'var(--color-admin-text-muted)' }} />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.trainers.searchMembers')} aria-label={t('admin.trainers.searchMembers')}
          className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: 'var(--color-admin-text)' }} autoFocus />
        <button onClick={() => setShowAssign(false)} aria-label={t('admin.trainers.closeMemberSearch')}
          className="flex items-center justify-center w-7 h-7" style={{ color: 'var(--color-admin-text-muted)' }}><X size={14} /></button>
      </div>
      <div className="max-h-44 overflow-y-auto space-y-0.5">
        {unassignedMembers(trainerId).slice(0, 20).map(m => (
          <button key={m.id} disabled={assigning} onClick={() => assignClient(trainerId, m.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors disabled:opacity-50"
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Avatar name={m.full_name} size="sm" variant="neutral" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] truncate" style={{ color: 'var(--color-admin-text)' }}>{m.full_name}</p>
              {m.username && <p className="text-[10px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>@{m.username}</p>}
            </div>
            <UserPlus size={12} className="flex-shrink-0" style={{ color: 'var(--color-admin-text-muted)' }} />
          </button>
        ))}
        {unassignedMembers(trainerId).length === 0 && (
          <p className="text-[11px] text-center py-2" style={{ color: 'var(--color-admin-text-muted)' }}>
            {search ? t('admin.trainers.noMatchingMembers') : t('admin.trainers.allMembersAssigned')}
          </p>
        )}
      </div>
    </div>
  );

  // ── Trainer detail panel (Direction B, right pane) — inline render fn ──
  const renderTrainerDetail = (m) => {
    const clients = clientMap[m.id] || [];
    const risk = clients.filter(c => c.churnTier === 'critical' || c.churnTier === 'high').length;
    const wk = (Array.isArray(m.weeks) && m.weeks.length) ? m.weeks : EMPTY_WEEKS;
    const recent = wk.slice(4).reduce((a, b) => a + b, 0);
    const older = wk.slice(0, 4).reduce((a, b) => a + b, 0);
    const trend = recent > older * 1.1 ? { Icon: TrendingUp, c: 'var(--color-success)', t: t('admin.trainers.trendUp', 'rising') }
      : recent < older * 0.9 ? { Icon: TrendingDown, c: 'var(--color-danger)', t: t('admin.trainers.trendDown', 'declining') }
        : { Icon: Minus, c: 'var(--color-admin-text-muted)', t: t('admin.trainers.trendStable', 'steady') };
    return (
      <div className="flex flex-col gap-4 min-w-0">
        {/* Header card */}
        <AdminCard padding="p-0" className="overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-4" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 10%, transparent), transparent)' }}>
            <Avatar name={m.name} size="lg" variant="accent" src={m.checkinPhotoUrl} />
            <div className="flex-1 min-w-0">
              <div className="admin-page-title text-[20px] truncate" style={{ letterSpacing: '-0.02em' }}>{m.name}</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--color-admin-text-muted)' }}>
                {m.username ? `@${m.username}` : ''}{m.createdAt ? ` · ${t('admin.trainers.since', 'since')} ${format(new Date(m.createdAt), 'MMM yyyy', dateFnsOpts)}` : ''}
              </div>
            </div>
            <div className="relative flex-shrink-0">
              <button onClick={() => setDetailMenuOpen(o => !o)} aria-label={t('admin.trainers.moreActions', 'More actions')}
                className="flex items-center justify-center w-9 h-9 rounded-xl" style={{ border: '1px solid var(--color-admin-border)', background: 'var(--color-bg-card)', color: 'var(--color-admin-text-sub)' }}>
                <MoreHorizontal size={16} />
              </button>
              {detailMenuOpen && (
                <div className="absolute right-0 mt-1 z-20 rounded-xl py-1 shadow-lg" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', minWidth: 190 }}>
                  <button onClick={() => { setDetailMenuOpen(false); setContactTrainer(m); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] font-semibold text-left transition-colors"
                    style={{ color: 'var(--color-admin-text)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <MessageSquare size={14} /> {t('admin.trainers.message', 'Message')}
                  </button>
                  <button onClick={() => { setDetailMenuOpen(false); setConfirmDemote(m.id); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] font-semibold text-left transition-colors"
                    style={{ color: 'var(--color-danger)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-danger-soft)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <X size={14} /> {t('admin.trainers.removeTrainer')}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2.5 px-5 pb-5 pt-4">
            <MiniStat label={t('admin.trainers.clients', 'Clients')} value={m.clientCount} tone="brand" />
            <MiniStat label={t('admin.trainers.retention', 'Retention')} value={m.clientCount ? `${m.retention}%` : '—'} tone="good" />
            <MiniStat label={t('admin.trainers.sessionsMonth', 'Sessions · mo')} value={m.totalSessions} tone="neutral" />
            <MiniStat label={t('admin.trainers.atRisk', 'At Risk')} value={risk} tone={risk ? 'risk' : 'neutral'} />
          </div>
        </AdminCard>

        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 items-start">
          {/* Assigned clients */}
          <AdminCard padding="p-0" className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
              <div className="admin-page-title text-[14.5px]">
                {t('admin.trainers.assignedClients', 'Assigned clients')} <span style={{ color: 'var(--color-admin-text-muted)' }}>({clients.length})</span>
              </div>
              <button onClick={() => { setShowAssign(s => !s); setSearch(''); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold transition-colors whitespace-nowrap"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}>
                <UserPlus size={12} /> {t('admin.trainers.assignClient')}
              </button>
            </div>
            <div className="p-3">
              {showAssign && renderAssignDropdown(m.id)}
              {clients.length === 0 ? (
                <p className="text-[12px] text-center py-6" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.noClientsAssigned')}</p>
              ) : (
                <div className="space-y-0.5">
                  {clients.map(c => {
                    const st = clientStatus(c);
                    return (
                      <div key={c.id} className="flex items-center gap-2.5 py-2 px-2 rounded-lg group transition-colors"
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <Avatar name={c.name} size="sm" tone={STATUS_TONE[st]} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{c.name}</p>
                          <p className="text-[10.5px] truncate mt-0.5 inline-flex items-center gap-1.5" style={{ color: STATUS_COLOR[st] }}>
                            <StatusDot status={st} /> {t(`admin.trainers.status.${st}`, st)}
                          </p>
                        </div>
                        {c.churnScore !== null && (c.churnTier === 'critical' || c.churnTier === 'high' || c.churnTier === 'medium') && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full admin-mono"
                            style={{ color: c.churnTier === 'medium' ? 'var(--color-warning)' : 'var(--color-danger)', background: c.churnTier === 'medium' ? 'var(--color-warning-soft)' : 'var(--color-danger-soft)' }}>
                            {Math.round(c.churnScore)}%
                          </span>
                        )}
                        <span className="admin-mono text-[12px] font-bold tabular-nums text-right" style={{ color: 'var(--color-admin-text-sub)', minWidth: 52 }}>
                          {c.sessions30d} {t('admin.trainers.sesAbbr', 'ses.')}
                        </span>
                        <button onClick={() => setConfirmUnassign({ trainerId: m.id, clientId: c.id, clientName: c.name })}
                          className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors flex-shrink-0"
                          style={{ backgroundColor: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
                          title={t('admin.trainers.unassignClient', 'Unassign client')} aria-label={t('admin.trainers.unassignClient', 'Unassign client')}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </AdminCard>

          {/* Right column: sessions sparkline + check-in photo */}
          <div className="flex flex-col gap-4">
            <AdminCard padding="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.06em]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.sessions8w', 'Sessions · 8 weeks')}</div>
                <span className="inline-flex items-center gap-1 text-[11.5px] font-bold" style={{ color: trend.c }}><trend.Icon size={13} /> {trend.t}</span>
              </div>
              <SparkLine data={m.weeks} />
            </AdminCard>
            <AdminCard padding="p-4">
              <CheckinPhotoEditor
                subjectId={m.id}
                path={m.checkinPhotoPath}
                size={72}
                theme={{ accent: 'var(--color-accent)', surface: 'var(--color-admin-panel)', border: 'var(--color-admin-border)', text: 'var(--color-admin-text)', textSub: 'var(--color-admin-text-muted)', danger: 'var(--color-danger)', badgeBorder: 'var(--color-bg-card)' }}
                labels={{ photo: t('checkinPhoto.title', 'Check-in photo'), hint: t('checkinPhoto.hint', 'Staff only — used to verify identity at check-in.'), add: t('checkinPhoto.add', 'Add photo'), replace: t('checkinPhoto.replace', 'Replace'), remove: t('checkinPhoto.remove', 'Remove') }}
                onChange={() => queryClient.invalidateQueries({ queryKey: adminKeys.trainers(gymId) })}
              />
            </AdminCard>
          </div>
        </div>
      </div>
    );
  };

  // ── Render ──
  const showEmpty = !isLoading && !error && trainers.length === 0;

  return (
    <div className="admin-shell px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1320px] mx-auto overflow-x-hidden">
      {view === 'detail' && selected ? (
        // ───── Direction B: master-detail ─────
        <>
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="min-w-0">
              <button onClick={() => { setView('table'); setDetailMenuOpen(false); }}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-bold mb-2 transition-colors"
                style={{ color: 'var(--color-admin-text-sub)' }}>
                <ArrowLeft size={15} /> {t('admin.trainers.title')}
              </button>
              <h1 className="admin-page-title text-[26px] truncate" style={{ letterSpacing: '-0.03em' }}>{selected.name}</h1>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">{headerActions}</div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
            {/* Master list */}
            <AdminCard padding="p-0" className="overflow-hidden lg:sticky lg:top-4">
              <div className="p-2.5" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
                <div className="flex items-center gap-2 px-2.5 h-9 rounded-lg" style={{ background: 'var(--color-bg-subtle)' }}>
                  <Search size={14} style={{ color: 'var(--color-admin-text-muted)' }} />
                  <input value={trainerSearch} onChange={e => setTrainerSearch(e.target.value)}
                    placeholder={t('admin.trainers.searchTrainers', 'Search…')} aria-label={t('admin.trainers.searchTrainers', 'Search trainers')}
                    className="flex-1 bg-transparent text-[12.5px] outline-none" style={{ color: 'var(--color-admin-text)' }} />
                </div>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
                {filteredTrainers.map(tr => {
                  const on = tr.id === selectedId;
                  const risk = (clientMap[tr.id] || []).filter(c => c.churnTier === 'critical' || c.churnTier === 'high').length;
                  return (
                    <button key={tr.id} onClick={() => openDetail(tr.id)}
                      className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors"
                      style={{ borderBottom: '1px solid var(--color-admin-border)', background: on ? 'color-mix(in srgb, var(--color-accent) 9%, transparent)' : 'transparent', boxShadow: on ? 'inset 3px 0 0 var(--color-accent)' : 'none' }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                      onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                      <Avatar name={tr.name} size="md" variant="accent" src={tr.checkinPhotoUrl} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-bold truncate" style={{ color: 'var(--color-admin-text)' }}>{tr.name}</div>
                        <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                          {t('admin.trainers.nClients', { count: tr.clientCount, defaultValue: '{{count}} clients' })}{tr.username ? ` · @${tr.username}` : ''}
                        </div>
                      </div>
                      {risk > 0
                        ? <span className="admin-mono text-[11px] font-bold inline-flex items-center gap-1" style={{ color: 'var(--color-danger)' }}><StatusDot status="riesgo" />{risk}</span>
                        : tr.clientCount > 0 && <span className="admin-mono text-[11.5px] font-bold" style={{ color: retColor(tr.retention) }}>{tr.retention}%</span>}
                    </button>
                  );
                })}
                {filteredTrainers.length === 0 && (
                  <p className="text-[12px] text-center py-6" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.noMatchingTrainers', 'No trainers found')}</p>
                )}
              </div>
            </AdminCard>

            {renderTrainerDetail(selected)}
          </div>
        </>
      ) : (
        // ───── Direction A: roster table ─────
        <>
          <PageHeader title={t('admin.trainers.title')} subtitle={t('admin.trainers.subtitle')} className="mb-5" actions={headerActions} />

          {!isLoading && !error && trainers.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3 mb-5">
              <StatCard label={t('admin.trainers.totalTrainers', 'Trainers')} value={trainers.length} sub={t('admin.trainers.activeTrainersSub', { active: trainers.filter(tr => tr.clientCount > 0).length, defaultValue: '{{active}} with clients' })} borderColor="var(--color-accent)" icon={Users} delay={0} />
              <StatCard label={t('admin.trainers.totalClients', 'Assigned clients')} value={stats.totalClients} sub={t('admin.trainers.perTrainerSub', { n: trainers.length ? (stats.totalClients / trainers.length).toFixed(1) : '0', defaultValue: '{{n}} per trainer (avg)' })} borderColor="var(--color-info)" icon={UserPlus} delay={0.05} />
              <StatCard label={t('admin.trainers.avgRetention', 'Avg retention')} value={`${stats.avgRetention}%`} sub={t('admin.trainers.avgRetentionSub', 'among active trainers')} borderColor="var(--color-success)" icon={BarChart3} delay={0.1} />
              <StatCard label={t('admin.trainers.atRiskClients', 'Clients at risk')} value={stats.atRiskClients} sub={t('admin.trainers.atRiskSub', 'need follow-up')} borderColor="var(--color-danger)" icon={AlertTriangle} delay={0.15} />
            </div>
          )}

          {!isLoading && !error && trainers.length > 0 && (
            <div className="flex items-center gap-2 mb-3.5">
              <div className="relative w-full sm:w-72">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-admin-text-muted)' }} />
                <input value={trainerSearch} onChange={e => setTrainerSearch(e.target.value)}
                  placeholder={t('admin.trainers.searchTrainersPlaceholder', 'Search trainer…')} aria-label={t('admin.trainers.searchTrainers', 'Search trainers')}
                  className="w-full h-[38px] rounded-xl pl-9 pr-3 text-[13px] outline-none"
                  style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-24">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
            </div>
          ) : error ? (
            <ErrorCard message={t('admin.trainers.loadError')} onRetry={refetch} />
          ) : showEmpty ? (
            <AdminCard className="p-12 text-center">
              <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'var(--color-admin-panel)' }}>
                <Users size={24} style={{ color: 'var(--color-admin-text-muted)' }} />
              </div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{t('admin.trainers.emptyTitle')}</p>
              <p className="text-[12.5px] mt-1" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.emptyDesc')}</p>
              <button onClick={() => setShowAddTrainer(true)}
                className="mt-4 inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
                style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}>
                <Plus size={16} strokeWidth={2.6} /> {t('admin.trainers.addTrainer')}
              </button>
            </AdminCard>
          ) : (
            <AdminTable
              columns={columns}
              data={filteredTrainers}
              keyField="id"
              onRowClick={(tr) => openDetail(tr.id)}
              emptyState={<p className="text-[13px] text-center py-8" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.trainers.noMatchingTrainers', 'No trainers found')}</p>}
            />
          )}
        </>
      )}

      {/* Modals */}
      <AddTrainerModal isOpen={showAddTrainer} onClose={() => setShowAddTrainer(false)} allMembers={allMembers} onPromote={promoteToTrainer} />

      {confirmUnassign && (
        <AdminModal isOpen onClose={() => setConfirmUnassign(null)} title={t('admin.trainers.unassignClientTitle', 'Unassign Client')} size="sm"
          footer={
            <>
              <button onClick={() => setConfirmUnassign(null)} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
                style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
                {t('admin.trainers.cancel', 'Cancel')}
              </button>
              <button onClick={async () => { if (unassigning) return; setUnassigning(true); try { await unassignClient(confirmUnassign.trainerId, confirmUnassign.clientId); } finally { setUnassigning(false); setConfirmUnassign(null); } }}
                disabled={unassigning}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-danger)', color: '#fff' }}>
                <Trash2 size={14} /> {unassigning ? t('admin.trainers.unassigning', 'Unassigning…') : t('admin.trainers.unassignConfirm', 'Unassign Client')}
              </button>
            </>
          }>
          <p className="text-[13px] text-center" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.trainers.unassignDesc', 'Unassign')} <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{confirmUnassign.clientName}</span>{t('admin.trainers.unassignDescEnd', ' from this trainer?')}
          </p>
        </AdminModal>
      )}

      <ConfirmDemoteModal isOpen={!!confirmDemote} onClose={() => setConfirmDemote(null)} trainer={demoteTrainer} clientCount={demoteClientCount} onConfirm={demoteToMember} />

      {/* Message a trainer — in-app message + push (email/SMS if on file). Reuses the
          admin ContactPanel; its churn-risk header auto-hides for staff. */}
      {contactTrainer && (
        <ContactPanel
          member={{ ...contactTrainer, full_name: contactTrainer.name }}
          gymId={gymId}
          adminId={adminId}
          onMarkContacted={logTrainerContact}
          onUnmarkContacted={unlogTrainerContact}
          onClose={() => setContactTrainer(null)}
          defaultChannel="message"
        />
      )}
    </div>
  );
}
