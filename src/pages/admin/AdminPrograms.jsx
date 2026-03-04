import { useEffect, useState } from 'react';
import { Plus, Dumbbell, X, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

// ── Create / Edit program modal ───────────────────────────
const ProgramModal = ({ program, onClose, onSaved, gymId, adminId }) => {
  const isEdit = !!program;
  const [name, setName]           = useState(program?.name ?? '');
  const [description, setDesc]    = useState(program?.description ?? '');
  const [durationWeeks, setDuration] = useState(program?.duration_weeks ?? 8);
  const [weeks, setWeeks]         = useState(program?.weeks ?? {}); // { weekNum: [routineId, ...] }
  const [routines, setRoutines]   = useState([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    const fetchRoutines = async () => {
      const { data } = await supabase
        .from('routines')
        .select('id, name')
        .eq('gym_id', gymId)
        .eq('is_template', true)
        .order('name');
      setRoutines(data || []);
    };
    fetchRoutines();
  }, [gymId]);

  const addRoutineToWeek = (weekNum, routineId) => {
    if (!routineId) return;
    setWeeks(prev => ({
      ...prev,
      [weekNum]: [...(prev[weekNum] || []), routineId],
    }));
  };

  const removeRoutineFromWeek = (weekNum, idx) => {
    setWeeks(prev => ({
      ...prev,
      [weekNum]: prev[weekNum].filter((_, i) => i !== idx),
    }));
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Program name is required.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      gym_id: gymId,
      created_by: adminId,
      name: name.trim(),
      description: description.trim(),
      duration_weeks: durationWeeks,
      weeks,
      is_published: true,
    };
    const { error: err } = isEdit
      ? await supabase.from('gym_programs').update(payload).eq('id', program.id)
      : await supabase.from('gym_programs').insert(payload);
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <p className="text-[16px] font-bold text-[#E5E7EB]">{isEdit ? 'Edit Program' : 'New Program'}</p>
          <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Program Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. 8-Week Strength Builder"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} rows={2}
              placeholder="What will members achieve?"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none" />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Duration</label>
            <div className="flex gap-2">
              {[4, 6, 8, 10, 12].map(w => (
                <button key={w} onClick={() => setDuration(w)}
                  className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                    durationWeeks === w ? 'bg-[#D4AF37]/15 text-[#D4AF37]' : 'bg-[#111827] border border-white/6 text-[#9CA3AF]'
                  }`}>
                  {w}w
                </button>
              ))}
            </div>
          </div>

          {/* Week assignments */}
          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">Weekly Workouts</label>
            <div className="space-y-2">
              {Array.from({ length: durationWeeks }, (_, i) => i + 1).map(wk => (
                <div key={wk} className="bg-[#111827] border border-white/6 rounded-xl p-3">
                  <p className="text-[12px] font-semibold text-[#E5E7EB] mb-2">Week {wk}</p>
                  {(weeks[wk] || []).map((rid, idx) => {
                    const r = routines.find(r => r.id === rid);
                    return (
                      <div key={idx} className="flex items-center justify-between mb-1.5">
                        <span className="text-[12px] text-[#9CA3AF]">{r?.name ?? rid}</span>
                        <button onClick={() => removeRoutineFromWeek(wk, idx)} className="text-[#4B5563] hover:text-red-400 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                  <select
                    defaultValue=""
                    onChange={e => { addRoutineToWeek(wk, e.target.value); e.target.value = ''; }}
                    className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-1.5 text-[12px] text-[#9CA3AF] outline-none mt-1"
                  >
                    <option value="">+ Add workout</option>
                    {routines.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-[12px] text-red-400">{error}</p>}
        </div>

        <div className="p-5 border-t border-white/6 flex-shrink-0">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Program'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function AdminPrograms() {
  const { profile, user } = useAuth();
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]   = useState(null);

  const load = async () => {
    if (!profile?.gym_id) return;
    const { data } = await supabase
      .from('gym_programs')
      .select('*')
      .eq('gym_id', profile.gym_id)
      .order('created_at', { ascending: false });
    setPrograms(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile?.gym_id]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this program?')) return;
    await supabase.from('gym_programs').delete().eq('id', id);
    load();
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Programs</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Gym-branded workout programs for members</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors">
          <Plus size={15} /> New Program
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : programs.length === 0 ? (
        <div className="text-center py-20">
          <Dumbbell size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No programs yet</p>
          <p className="text-[12px] text-[#4B5563] mt-1">Create structured programs for your members to follow</p>
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map(p => (
            <div key={p.id} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                    <Dumbbell size={17} className="text-[#D4AF37]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{p.name}</p>
                    <p className="text-[11px] text-[#6B7280]">{p.duration_weeks} weeks</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${p.is_published ? 'text-emerald-400 bg-emerald-500/10' : 'text-[#6B7280] bg-white/6'}`}>
                    {p.is_published ? 'Published' : 'Draft'}
                  </span>
                  <button onClick={() => setEditing(p)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors p-1">
                    <ChevronRight size={16} />
                  </button>
                  <button onClick={() => handleDelete(p.id)} className="text-[#6B7280] hover:text-red-400 transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {p.description && (
                <p className="text-[12px] text-[#6B7280] mt-2 ml-12">{p.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <ProgramModal onClose={() => setShowCreate(false)} onSaved={load} gymId={profile.gym_id} adminId={user.id} />
      )}
      {editing && (
        <ProgramModal program={editing} onClose={() => setEditing(null)} onSaved={load} gymId={profile.gym_id} adminId={user.id} />
      )}
    </div>
  );
}
