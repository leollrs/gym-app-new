import { useEffect, useState, useMemo } from 'react';
import { Plus, X, ChevronLeft, ChevronRight, CalendarDays, Clock, Check, XCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  format, addWeeks, subWeeks, startOfWeek, endOfWeek, addDays,
  isSameDay, isToday, isBefore, setHours, setMinutes,
} from 'date-fns';

const STATUS_COLORS = {
  scheduled: { bg: 'bg-blue-500/12', text: 'text-blue-400', label: 'Scheduled' },
  confirmed: { bg: 'bg-[#D4AF37]/12', text: 'text-[#D4AF37]', label: 'Confirmed' },
  completed: { bg: 'bg-emerald-500/12', text: 'text-emerald-400', label: 'Completed' },
  cancelled: { bg: 'bg-red-500/12', text: 'text-red-400', label: 'Cancelled' },
  no_show:   { bg: 'bg-amber-500/12', text: 'text-amber-400', label: 'No Show' },
};

const DURATIONS = [30, 45, 60, 90, 120];

// ── Session Modal ─────────────────────────────────────────────────────────
const SessionModal = ({ session, clients, date, onClose, onSaved, trainerId, gymId }) => {
  const { showToast } = useToast();
  const isEdit = !!session;
  const [clientId, setClientId] = useState(session?.client_id || '');
  const [title, setTitle]       = useState(session?.title || 'Training Session');
  const [notes, setNotes]       = useState(session?.notes || '');
  const [dateVal, setDateVal]   = useState(
    session ? format(new Date(session.scheduled_at), 'yyyy-MM-dd') : format(date || new Date(), 'yyyy-MM-dd')
  );
  const [timeVal, setTimeVal]   = useState(
    session ? format(new Date(session.scheduled_at), 'HH:mm') : '09:00'
  );
  const [duration, setDuration] = useState(session?.duration_mins || 60);
  const [status, setStatus]     = useState(session?.status || 'scheduled');
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError]       = useState('');

  const handleSave = async () => {
    if (!clientId) { setError('Please select a client'); showToast('Please select a client', 'error'); return; }
    setSaving(true);
    setError('');

    const scheduledAt = new Date(`${dateVal}T${timeVal}`).toISOString();
    const payload = {
      gym_id: gymId,
      trainer_id: trainerId,
      client_id: clientId,
      title: title.trim() || 'Training Session',
      notes: notes.trim() || null,
      scheduled_at: scheduledAt,
      duration_mins: duration,
      status,
      updated_at: new Date().toISOString(),
    };

    const { error: err } = isEdit
      ? await supabase.from('trainer_sessions').update(payload).eq('id', session.id)
      : await supabase.from('trainer_sessions').insert(payload);

    if (err) { setError(err.message); setSaving(false); showToast(err.message, 'error'); return; }
    showToast(isEdit ? 'Session updated' : 'Session scheduled', 'success');
    onSaved();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await supabase.from('trainer_sessions').delete().eq('id', session.id);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="session-modal-title" className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-md md:max-w-xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <p id="session-modal-title" className="text-[16px] font-bold text-[#E5E7EB]">{isEdit ? 'Edit Session' : 'New Session'}</p>
          <button onClick={onClose} aria-label="Close dialog"><X size={20} className="text-[#6B7280]" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Client */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40">
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Training Session"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Date</label>
              <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Time</label>
              <input type="time" value={timeVal} onChange={e => setTimeVal(e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Duration</label>
            <div className="flex gap-2">
              {DURATIONS.map(d => (
                <button key={d} onClick={() => setDuration(d)}
                  className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                    duration === d ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#111827] border border-white/6 text-[#9CA3AF]'
                  }`}>
                  {d}m
                </button>
              ))}
            </div>
          </div>

          {/* Status (edit only) */}
          {isEdit && (
            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Status</label>
              <div className="flex gap-1.5 flex-wrap">
                {Object.entries(STATUS_COLORS).map(([key, val]) => (
                  <button key={key} onClick={() => setStatus(key)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                      status === key ? `${val.bg} ${val.text}` : 'bg-[#111827] text-[#6B7280]'
                    }`}>
                    {val.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Session notes…"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>

          {error && <p className="text-[12px] text-red-400">{error}</p>}
        </div>

        <div className="flex items-center gap-3 p-5 border-t border-white/6 flex-shrink-0">
          {isEdit && (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-[#9CA3AF]">Delete session?</span>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
                  {deleting ? 'Deleting...' : 'Confirm'}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white/5 text-[#9CA3AF] hover:bg-white/10 transition-colors">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 size={14} /> Delete
              </button>
            )
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] hover:bg-[#C4A030] text-black transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerSchedule() {
  const { profile } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { session?, date? }

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => { document.title = 'Trainer - Schedule | IronForge'; }, []);

  useEffect(() => {
    if (!profile?.id) return;
    loadClients();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    loadSessions();
  }, [profile?.id, weekOffset]);

  const loadClients = async () => {
    const { data } = await supabase
      .from('trainer_clients')
      .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name)')
      .eq('trainer_id', profile.id)
      .eq('is_active', true);
    setClients((data || []).map(tc => tc.profiles).filter(Boolean));
  };

  const loadSessions = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('trainer_sessions')
      .select('*, profiles!trainer_sessions_client_id_fkey(full_name)')
      .eq('trainer_id', profile.id)
      .gte('scheduled_at', weekStart.toISOString())
      .lte('scheduled_at', weekEnd.toISOString())
      .order('scheduled_at', { ascending: true });
    setSessions(data || []);
    setLoading(false);
  };

  const handleSaved = () => {
    setModal(null);
    loadSessions();
  };

  // Group sessions by day
  const sessionsByDay = useMemo(() => {
    const map = {};
    days.forEach(d => { map[format(d, 'yyyy-MM-dd')] = []; });
    sessions.forEach(s => {
      const key = format(new Date(s.scheduled_at), 'yyyy-MM-dd');
      if (map[key]) map[key].push(s);
    });
    return map;
  }, [sessions, weekStart]);

  // Today's remaining sessions
  const todaySessions = useMemo(() => {
    const now = new Date();
    return sessions
      .filter(s => isSameDay(new Date(s.scheduled_at), now) && !['cancelled'].includes(s.status))
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  }, [sessions]);

  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Schedule</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">{weekLabel}</p>
        </div>
        <button
          onClick={() => setModal({ date: new Date() })}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] hover:bg-[#C4A030] text-black transition-colors"
        >
          <Plus size={16} /> New Session
        </button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-2 mb-6">
        <button onClick={() => setWeekOffset(w => w - 1)}
          className="p-2 rounded-lg hover:bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors">
          <ChevronLeft size={18} />
        </button>
        <button onClick={() => setWeekOffset(0)}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
            weekOffset === 0 ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'text-[#9CA3AF] hover:text-[#E5E7EB] hover:bg-white/5'
          }`}>
          Today
        </button>
        <button onClick={() => setWeekOffset(w => w + 1)}
          className="p-2 rounded-lg hover:bg-white/5 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Today's Agenda (if on current week) */}
      {weekOffset === 0 && todaySessions.length > 0 && (
        <div className="mb-6 bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-3 flex items-center gap-2">
            <Clock size={14} className="text-[#D4AF37]" />
            Today's Sessions
          </p>
          <div className="space-y-2">
            {todaySessions.map(s => {
              const sc = STATUS_COLORS[s.status] || STATUS_COLORS.scheduled;
              return (
                <button key={s.id} onClick={() => setModal({ session: s })}
                  className="w-full flex items-center gap-3 p-3 bg-[#111827] rounded-xl hover:bg-[#111827]/80 transition-colors text-left">
                  <div className={`w-8 h-8 rounded-lg ${sc.bg} flex items-center justify-center flex-shrink-0`}>
                    <CalendarDays size={14} className={sc.text} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{s.profiles?.full_name || 'Client'}</p>
                    <p className="text-[11px] text-[#6B7280]">{s.title}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[12px] text-[#9CA3AF]">{format(new Date(s.scheduled_at), 'h:mm a')}</p>
                    <p className="text-[10px] text-[#4B5563]">{s.duration_mins}m</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Week grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-4 md:grid-cols-7 gap-2">
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd');
            const daySessions = sessionsByDay[key] || [];
            const today = isToday(day);
            const past = isBefore(day, new Date()) && !today;

            return (
              <div key={key} className={`bg-[#0F172A] border rounded-xl overflow-hidden min-h-[140px] hover:border-white/20 hover:bg-white/[0.03] transition-all ${
                today ? 'border-[#D4AF37]/30' : 'border-white/6'
              }`}>
                {/* Day header */}
                <div className={`px-3 py-2 border-b flex items-center justify-between ${
                  today ? 'border-[#D4AF37]/20 bg-[#D4AF37]/5' : 'border-white/4'
                }`}>
                  <div>
                    <p className={`text-[11px] font-medium ${today ? 'text-[#D4AF37]' : 'text-[#6B7280]'}`}>
                      {format(day, 'EEE')}
                    </p>
                    <p className={`text-[15px] font-bold ${today ? 'text-[#D4AF37]' : past ? 'text-[#4B5563]' : 'text-[#E5E7EB]'}`}>
                      {format(day, 'd')}
                    </p>
                  </div>
                  <button
                    onClick={() => setModal({ date: day })}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[#4B5563] hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {/* Sessions */}
                <div className="p-1.5 space-y-1">
                  {daySessions.length === 0 ? (
                    <p className="text-[10px] text-[#374151] text-center py-3">No sessions</p>
                  ) : (
                    daySessions.map(s => {
                      const sc = STATUS_COLORS[s.status] || STATUS_COLORS.scheduled;
                      return (
                        <button key={s.id} onClick={() => setModal({ session: s })}
                          className={`w-full text-left px-2.5 py-2 rounded-lg ${sc.bg} hover:opacity-80 transition-opacity`}>
                          <p className={`text-[11px] font-semibold ${sc.text} truncate`}>
                            {s.profiles?.full_name || 'Client'}
                          </p>
                          <p className="text-[10px] text-[#6B7280]">
                            {format(new Date(s.scheduled_at), 'h:mm a')} · {s.duration_mins}m
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <SessionModal
          session={modal.session}
          date={modal.date}
          clients={clients}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          trainerId={profile.id}
          gymId={profile.gym_id}
        />
      )}
    </div>
  );
}
