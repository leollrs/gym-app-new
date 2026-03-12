import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Search, X, Send, Trophy, Phone, Filter,
  Users, Clock, RotateCcw, CheckCircle, MessageSquare, ChevronRight,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMembersWithChurnScores, getRiskTier } from '../../lib/churnScore';

// ── Skeleton loader ────────────────────────────────────────
const SkeletonRow = () => (
  <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/4 last:border-0 animate-pulse">
    <div className="w-9 h-9 rounded-full bg-white/6 flex-shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3 bg-white/6 rounded-full w-32" />
      <div className="h-2.5 bg-white/4 rounded-full w-48" />
    </div>
    <div className="h-5 w-20 bg-white/6 rounded-full" />
  </div>
);

// ── Risk badge ─────────────────────────────────────────────
const RiskBadge = ({ score }) => {
  const tier = getRiskTier(score);
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
      style={{ color: tier.color, background: tier.bg, borderColor: `${tier.color}33` }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tier.color }} />
      {tier.label}
    </span>
  );
};

// ── Score bar ──────────────────────────────────────────────
const ScoreBar = ({ score }) => {
  const tier = getRiskTier(score);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/6 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, background: tier.color }}
        />
      </div>
      <span className="text-[11px] font-bold text-[#9CA3AF] w-6 text-right">{score}</span>
    </div>
  );
};

// ── Avatar ────────────────────────────────────────────────
const Avatar = ({ name }) => (
  <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
    <span className="text-[13px] font-bold text-[#9CA3AF]">{name?.[0]?.toUpperCase() ?? '?'}</span>
  </div>
);

// ── Send Message Modal ────────────────────────────────────
const SendMessageModal = ({ member, gymId, adminId, onClose, onSent }) => {
  const defaultMsg = `Hey ${member.full_name.split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together. 💪`;
  const [msg, setMsg] = useState(defaultMsg);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      // Insert notification
      await supabase.from('notifications').insert({
        profile_id: member.id,
        gym_id: gymId,
        type: 'admin_message',
        title: 'Message from your gym',
        body: msg,
        data: { source: 'churn_intel' },
      });

      // Log the win-back attempt gracefully (table may not exist)
      try {
        await supabase.from('win_back_attempts').insert({
          user_id: member.id,
          gym_id: gymId,
          admin_id: adminId,
          message: msg,
          offer: null,
          outcome: 'pending',
          created_at: new Date().toISOString(),
        });
      } catch (_) {
        // Table doesn't exist — continue silently
      }

      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      console.error('Failed to send message', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/12 flex items-center justify-center">
              <MessageSquare size={15} className="text-[#D4AF37]" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-[#E5E7EB]">Send Message</p>
              <p className="text-[11px] text-[#6B7280]">to {member.full_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider block mb-2">Message</label>
            <textarea
              value={msg}
              onChange={e => setMsg(e.target.value)}
              rows={4}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-3 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors"
              placeholder="Write your message…"
            />
            <p className="text-[11px] text-[#4B5563] mt-1.5">Member will receive this as an in-app notification.</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !msg.trim() || sent}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
              style={{ background: sent ? 'rgba(16,185,129,0.15)' : 'rgba(212,175,55,0.12)', color: sent ? '#10B981' : '#D4AF37', border: `1px solid ${sent ? 'rgba(16,185,129,0.25)' : 'rgba(212,175,55,0.25)'}` }}
            >
              {sent ? <><CheckCircle size={14} /> Sent!</> : sending ? 'Sending…' : <><Send size={13} /> Send Message</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Win-Back Modal ────────────────────────────────────────
const WinBackModal = ({ member, gymId, adminId, onClose, onSent }) => {
  const defaultMsg = `Hey ${member.full_name.split(' ')[0]}! We miss you at the gym. We'd love to have you back — come in this week and let's pick up where you left off. Your spot is waiting! 🏋️`;
  const [msg, setMsg] = useState(defaultMsg);
  const [offer, setOffer] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const OFFERS = [
    { value: '', label: 'No offer' },
    { value: 'Free PT session', label: 'Free PT session' },
    { value: '1 month discount', label: '1 month discount' },
    { value: 'Free class pass', label: 'Free class pass' },
    { value: 'Custom…', label: 'Custom…' },
  ];
  const [customOffer, setCustomOffer] = useState('');
  const finalOffer = offer === 'Custom…' ? customOffer : offer;

  const handleSend = async () => {
    setSending(true);
    try {
      const fullMsg = finalOffer ? `${msg}\n\nSpecial offer for you: ${finalOffer}` : msg;

      await supabase.from('notifications').insert({
        profile_id: member.id,
        gym_id: gymId,
        type: 'win_back',
        title: 'We want you back!',
        body: fullMsg,
        data: { source: 'churn_win_back', offer: finalOffer || null },
      });

      // Log win-back attempt gracefully
      try {
        await supabase.from('win_back_attempts').insert({
          user_id: member.id,
          gym_id: gymId,
          admin_id: adminId,
          message: fullMsg,
          offer: finalOffer || null,
          outcome: 'no_response',
          created_at: new Date().toISOString(),
        });
      } catch (_) {
        // Table doesn't exist — continue silently
      }

      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      console.error('Failed to send win-back', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#EF4444]/12 flex items-center justify-center">
              <RotateCcw size={15} className="text-[#EF4444]" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-[#E5E7EB]">Win-Back Campaign</p>
              <p className="text-[11px] text-[#6B7280]">Re-engage {member.full_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider block mb-2">Message</label>
            <textarea
              value={msg}
              onChange={e => setMsg(e.target.value)}
              rows={4}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-3 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider block mb-2">Offer (optional)</label>
            <div className="flex flex-wrap gap-2">
              {OFFERS.map(o => (
                <button
                  key={o.value}
                  onClick={() => setOffer(o.value)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                    offer === o.value
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30'
                      : 'bg-white/4 text-[#9CA3AF] border-white/6 hover:text-[#E5E7EB]'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {offer === 'Custom…' && (
              <input
                type="text"
                value={customOffer}
                onChange={e => setCustomOffer(e.target.value)}
                placeholder="Describe your offer…"
                className="mt-2 w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
            )}
          </div>

          {finalOffer && (
            <div className="bg-[#D4AF37]/8 border border-[#D4AF37]/15 rounded-xl px-3.5 py-2.5">
              <p className="text-[11px] text-[#D4AF37] font-semibold mb-0.5">Offer included in message</p>
              <p className="text-[12px] text-[#9CA3AF]">{finalOffer}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 p-5 border-t border-white/6 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: sent ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)', color: sent ? '#10B981' : '#EF4444', border: `1px solid ${sent ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}` }}
          >
            {sent ? <><CheckCircle size={14} /> Sent!</> : sending ? 'Sending…' : <><RotateCcw size={13} /> Send Win-Back</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────
export default function AdminChurn() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [members, setMembers] = useState([]);
  const [winBackAttempts, setWinBackAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState([]);

  // Tab
  const [tab, setTab] = useState('at-risk'); // 'at-risk' | 'churned' | 'win-back'

  // At Risk tab filters
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('all'); // 'all' | 'high' | 'medium'
  const [contactedIds, setContactedIds] = useState(new Set());

  // Modals
  const [msgModal, setMsgModal] = useState(null);    // member object
  const [winBackModal, setWinBackModal] = useState(null); // member object

  // Win-back outcome saving
  const [savingOutcome, setSavingOutcome] = useState(null);

  const gymId = profile?.gym_id;
  const adminId = profile?.id;

  useEffect(() => {
    if (!gymId) return;
    const load = async () => {
      setLoading(true);
      try {
        const [scored, challengeRes, winBackRes] = await Promise.all([
          fetchMembersWithChurnScores(gymId, supabase),
          supabase
            .from('challenges')
            .select('id, title')
            .eq('gym_id', gymId)
            .in('status', ['active', 'upcoming'])
            .order('title'),
          // win_back_attempts — handle gracefully if table missing
          supabase
            .from('win_back_attempts')
            .select('id, user_id, message, offer, outcome, created_at')
            .eq('gym_id', gymId)
            .order('created_at', { ascending: false }),
        ]);

        setMembers(scored);
        setChallenges(challengeRes.data || []);
        if (!winBackRes.error) {
          setWinBackAttempts(winBackRes.data || []);
        }
      } catch (err) {
        console.error('AdminChurn load error', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [gymId]);

  // ── Derived lists ────────────────────────────────────────

  // At-risk: churnScore >= 40
  const atRiskMembers = useMemo(() => {
    let list = members.filter(m => m.churnScore >= 40);
    if (riskFilter === 'high') list = list.filter(m => m.churnScore >= 70);
    if (riskFilter === 'medium') list = list.filter(m => m.churnScore >= 40 && m.churnScore < 70);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m => m.full_name.toLowerCase().includes(q));
    }
    return list;
  }, [members, riskFilter, search]);

  // Churned: no check-in AND no workout session in 30+ days
  const churnedMembers = useMemo(() => {
    return members.filter(m =>
      (m.daysSinceLastCheckIn === null || m.daysSinceLastCheckIn >= 30)
    );
  }, [members]);

  // Win-back members — build lookup by user_id
  const winBackMemberMap = useMemo(() => {
    const map = {};
    winBackAttempts.forEach(a => {
      if (!map[a.user_id]) map[a.user_id] = a;
    });
    return map;
  }, [winBackAttempts]);

  const highRiskCount = members.filter(m => m.churnScore >= 70).length;
  const medRiskCount = members.filter(m => m.churnScore >= 40 && m.churnScore < 70).length;

  // ── Actions ──────────────────────────────────────────────

  const handleMarkContacted = (memberId) => {
    setContactedIds(prev => new Set([...prev, memberId]));
  };

  const handleAddToChallenge = async (member, challengeId) => {
    if (!challengeId) return;
    await supabase.from('challenge_participants').upsert(
      { user_id: member.id, challenge_id: challengeId },
      { onConflict: 'user_id,challenge_id', ignoreDuplicates: true }
    );
  };

  const handleMarkOutcome = async (attemptId, outcome) => {
    setSavingOutcome(attemptId);
    try {
      await supabase
        .from('win_back_attempts')
        .update({ outcome })
        .eq('id', attemptId);
      setWinBackAttempts(prev => prev.map(a => a.id === attemptId ? { ...a, outcome } : a));
    } catch (_) {
      // Table may not exist
    } finally {
      setSavingOutcome(null);
    }
  };

  // ── Tab content ───────────────────────────────────────────

  const TABS = [
    { key: 'at-risk', label: 'At Risk', count: atRiskMembers.length },
    { key: 'churned', label: 'Churned', count: churnedMembers.length },
    { key: 'win-back', label: 'Win-Back', count: winBackAttempts.length },
  ];

  const outcomeConfig = {
    returned:    { label: 'Returned',     color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
    no_response: { label: 'No Response',  color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)' },
    still_inactive: { label: 'Still Inactive', color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
    pending:     { label: 'Pending',      color: '#6B7280', bg: 'rgba(107,114,128,0.08)' },
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
      {/* ── Page header ──────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-xl bg-[#EF4444]/12 flex items-center justify-center">
            <AlertTriangle size={16} className="text-[#EF4444]" />
          </div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Churn Intelligence</h1>
        </div>
        <p className="text-[13px] text-[#6B7280] pl-1">
          {loading
            ? 'Analyzing member activity…'
            : `${highRiskCount} high risk · ${medRiskCount} medium risk · ${churnedMembers.length} churned`}
        </p>
      </div>

      {/* ── Summary cards ────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          {
            label: 'High Risk',
            value: loading ? '—' : highRiskCount,
            color: '#EF4444',
            bg: 'rgba(239,68,68,0.08)',
            sub: 'score ≥ 70',
          },
          {
            label: 'Medium Risk',
            value: loading ? '—' : medRiskCount,
            color: '#F59E0B',
            bg: 'rgba(245,158,11,0.08)',
            sub: 'score 40–69',
          },
          {
            label: 'Churned',
            value: loading ? '—' : churnedMembers.length,
            color: '#9CA3AF',
            bg: 'rgba(156,163,175,0.06)',
            sub: '30+ days gone',
          },
        ].map(card => (
          <div
            key={card.label}
            className="bg-[#0F172A] border border-white/8 rounded-[14px] p-4"
            style={{ borderColor: `${card.color}20` }}
          >
            <p className="text-[26px] font-bold leading-none" style={{ color: card.color }}>
              {card.value}
            </p>
            <p className="text-[12px] font-semibold text-[#E5E7EB] mt-1.5">{card.label}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Sticky tab bar ───────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[#05070B]/95 backdrop-blur-xl -mx-4 md:-mx-8 px-4 md:px-8 py-3 mb-4 border-b border-white/6">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
                tab === t.key
                  ? 'bg-[#D4AF37]/12 text-[#D4AF37]'
                  : 'text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/4'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  tab === t.key ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'bg-white/8 text-[#6B7280]'
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB: AT RISK
         ══════════════════════════════════════════════════════ */}
      {tab === 'at-risk' && (
        <div>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
              <input
                type="text"
                placeholder="Search members…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { key: 'all', label: 'All' },
                { key: 'high', label: 'High' },
                { key: 'medium', label: 'Medium' },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setRiskFilter(f.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors ${
                    riskFilter === f.key
                      ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                      : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB]'
                  }`}
                >
                  <Filter size={11} />
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Member list */}
          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : atRiskMembers.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={22} className="text-[#10B981]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">No at-risk members</p>
              <p className="text-[13px] text-[#6B7280]">Your member retention is looking healthy right now.</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              <div className="divide-y divide-white/4">
                {atRiskMembers.map(m => {
                  const isContacted = contactedIds.has(m.id);
                  return (
                    <div key={m.id} className="px-4 py-4 hover:bg-white/2 transition-colors">
                      {/* Row top: avatar + name + badge + score bar */}
                      <div className="flex items-start gap-3">
                        <Avatar name={m.full_name} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-[14px] font-semibold text-[#E5E7EB]">{m.full_name}</p>
                            <RiskBadge score={m.churnScore} />
                            {isContacted && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20">
                                Contacted
                              </span>
                            )}
                          </div>
                          {/* Score bar */}
                          <div className="mb-2">
                            <ScoreBar score={m.churnScore} />
                          </div>
                          {/* Key signal */}
                          <p className="text-[12px] text-[#9CA3AF] mb-1">
                            <span className="text-[#6B7280]">Signal: </span>
                            {m.keySignal}
                          </p>
                          {/* Days since visit */}
                          <p className="text-[11px] text-[#6B7280]">
                            {m.daysSinceLastCheckIn === null
                              ? 'Never checked in'
                              : m.daysSinceLastCheckIn < 1
                              ? 'Checked in today'
                              : `Last visit ${Math.round(m.daysSinceLastCheckIn)}d ago`}
                            {' · '}
                            {Math.round(m.tenureMonths)}mo tenure
                          </p>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mt-3 pl-12 flex-wrap">
                        <button
                          onClick={() => setMsgModal(m)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors"
                        >
                          <MessageSquare size={12} />
                          Message
                        </button>

                        {challenges.length > 0 && (
                          <select
                            defaultValue=""
                            onChange={e => handleAddToChallenge(m, e.target.value)}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#1E293B] text-[#9CA3AF] border border-white/8 outline-none focus:border-[#D4AF37]/40 cursor-pointer hover:border-white/12 transition-colors"
                          >
                            <option value="" disabled>+ Add to Challenge</option>
                            {challenges.map(c => (
                              <option key={c.id} value={c.id}>{c.title}</option>
                            ))}
                          </select>
                        )}

                        <button
                          onClick={() => handleMarkContacted(m.id)}
                          disabled={isContacted}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors disabled:opacity-50 ${
                            isContacted
                              ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20'
                              : 'bg-white/4 text-[#9CA3AF] border-white/8 hover:text-[#E5E7EB] hover:border-white/14'
                          }`}
                        >
                          <Phone size={12} />
                          {isContacted ? 'Contacted' : 'Mark Contacted'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: CHURNED
         ══════════════════════════════════════════════════════ */}
      {tab === 'churned' && (
        <div>
          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : churnedMembers.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
                <Users size={22} className="text-[#10B981]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">No churned members</p>
              <p className="text-[13px] text-[#6B7280]">All members have been active in the last 30 days.</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/6">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Member</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">Last Seen</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">Tenure</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Action</p>
              </div>
              <div className="divide-y divide-white/4">
                {churnedMembers.map(m => {
                  const lastSeen = m.lastCheckInAt
                    ? formatDistanceToNow(new Date(m.lastCheckInAt), { addSuffix: true })
                    : 'Never checked in';
                  const tenureLabel = m.tenureMonths < 1
                    ? 'Less than 1 month'
                    : `${Math.round(m.tenureMonths)} months`;

                  return (
                    <div key={m.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3.5 hover:bg-white/2 transition-colors">
                      {/* Member */}
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={m.full_name} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</p>
                          <p className="text-[11px] text-[#6B7280] sm:hidden">{lastSeen}</p>
                        </div>
                      </div>
                      {/* Last seen */}
                      <div className="hidden sm:block text-right">
                        <p className="text-[12px] text-[#9CA3AF]">{lastSeen}</p>
                      </div>
                      {/* Tenure */}
                      <div className="hidden sm:block text-right">
                        <p className="text-[12px] text-[#9CA3AF]">{tenureLabel}</p>
                      </div>
                      {/* Win-back button */}
                      <button
                        onClick={() => setWinBackModal(m)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors flex-shrink-0"
                      >
                        <RotateCcw size={12} />
                        Win Back
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: WIN-BACK HISTORY
         ══════════════════════════════════════════════════════ */}
      {tab === 'win-back' && (
        <div>
          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : winBackAttempts.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-4">
                <RotateCcw size={22} className="text-[#D4AF37]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">No win-back attempts yet</p>
              <p className="text-[13px] text-[#6B7280]">
                Use the Churned tab to send win-back messages to inactive members.
              </p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/6">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Member / Message</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Date</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">Outcome</p>
              </div>
              <div className="divide-y divide-white/4">
                {winBackAttempts.map(attempt => {
                  // Find member name from our members list
                  const m = members.find(mem => mem.id === attempt.user_id);
                  const memberName = m?.full_name ?? 'Unknown Member';
                  const outcome = attempt.outcome ?? 'pending';
                  const outcomeCfg = outcomeConfig[outcome] ?? outcomeConfig.pending;
                  const isSaving = savingOutcome === attempt.id;

                  return (
                    <div key={attempt.id} className="px-4 py-3.5 hover:bg-white/2 transition-colors">
                      <div className="grid grid-cols-[1fr_auto_auto] items-start gap-4">
                        {/* Member + message */}
                        <div>
                          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-0.5">{memberName}</p>
                          <p className="text-[11px] text-[#6B7280] line-clamp-2">{attempt.message}</p>
                          {attempt.offer && (
                            <p className="text-[11px] text-[#D4AF37] mt-0.5">Offer: {attempt.offer}</p>
                          )}
                        </div>
                        {/* Date */}
                        <div className="text-right flex-shrink-0">
                          <p className="text-[12px] text-[#9CA3AF]">
                            {format(new Date(attempt.created_at), 'MMM d')}
                          </p>
                          <p className="text-[10px] text-[#4B5563]">
                            {format(new Date(attempt.created_at), 'yyyy')}
                          </p>
                        </div>
                        {/* Outcome */}
                        <div className="flex-shrink-0">
                          <span
                            className="text-[11px] font-semibold px-2 py-1 rounded-full border"
                            style={{ color: outcomeCfg.color, background: outcomeCfg.bg, borderColor: `${outcomeCfg.color}33` }}
                          >
                            {outcomeCfg.label}
                          </span>
                        </div>
                      </div>

                      {/* Outcome actions — only if not already returned */}
                      {outcome !== 'returned' && (
                        <div className="flex gap-2 mt-2.5 pl-0">
                          <button
                            onClick={() => handleMarkOutcome(attempt.id, 'returned')}
                            disabled={isSaving}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 hover:bg-[#10B981]/18 transition-colors disabled:opacity-40"
                          >
                            <CheckCircle size={11} />
                            Mark Returned
                          </button>
                          {outcome !== 'no_response' && (
                            <button
                              onClick={() => handleMarkOutcome(attempt.id, 'no_response')}
                              disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors disabled:opacity-40"
                            >
                              No Response
                            </button>
                          )}
                          {outcome !== 'still_inactive' && (
                            <button
                              onClick={() => handleMarkOutcome(attempt.id, 'still_inactive')}
                              disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F59E0B]/8 text-[#F59E0B] border border-[#F59E0B]/15 hover:bg-[#F59E0B]/15 transition-colors disabled:opacity-40"
                            >
                              Still Inactive
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────── */}
      {msgModal && (
        <SendMessageModal
          member={msgModal}
          gymId={gymId}
          adminId={adminId}
          onClose={() => setMsgModal(null)}
          onSent={() => setMsgModal(null)}
        />
      )}

      {winBackModal && (
        <WinBackModal
          member={winBackModal}
          gymId={gymId}
          adminId={adminId}
          onClose={() => setWinBackModal(null)}
          onSent={() => {
            setWinBackModal(null);
            // Refresh win-back attempts
            supabase
              .from('win_back_attempts')
              .select('id, user_id, message, offer, outcome, created_at')
              .eq('gym_id', gymId)
              .order('created_at', { ascending: false })
              .then(({ data, error }) => {
                if (!error) setWinBackAttempts(data || []);
              });
          }}
        />
      )}
    </div>
  );
}
