import { useEffect, useState } from 'react';
import { Dumbbell, ChevronDown, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const DEFAULT_SETS = 3;
const DEFAULT_REST = 60;

const fmtTime = (secs) => {
  if (secs < 60) return `${secs}s`;
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const calcDaySeconds = (day) =>
  (day.exercises || []).reduce((sum, ex) => {
    const s = ex.sets ?? DEFAULT_SETS;
    const r = ex.rest_seconds ?? DEFAULT_REST;
    return sum + s * 45 + (s - 1) * r;
  }, 0);

export default function TrainerPrograms() {
  const { profile } = useAuth();
  const [programs,  setPrograms]  = useState([]);
  const [exercises, setExercises] = useState({});
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState(null);

  useEffect(() => { document.title = 'Trainer - Programs | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      const [{ data: progs }, { data: exRows }] = await Promise.all([
        supabase
          .from('gym_programs')
          .select('*')
          .eq('gym_id', profile.gym_id)
          .eq('is_published', true)
          .order('name'),
        supabase
          .from('exercises')
          .select('id, name'),
      ]);
      setPrograms(progs || []);
      const exMap = {};
      (exRows || []).forEach(e => { exMap[e.id] = e.name; });
      setExercises(exMap);
      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  const exName = (id) => exercises[id] ?? id;

  return (
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl pb-28 md:pb-12">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB] truncate">Programs</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">Published gym programs you can assign to clients</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : programs.length === 0 ? (
        <div className="text-center py-20">
          <Dumbbell size={32} className="text-[#4B5563] mx-auto mb-3" />
          <p className="text-[14px] text-[#6B7280]">No programs published yet</p>
          <p className="text-[12px] text-[#4B5563] mt-1">Ask your admin to create programs in the Admin dashboard</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {programs.map(p => {
            const weeks = p.weeks ?? {};
            const allDays  = Object.values(weeks).flat();
            const totalEx  = allDays.reduce((s, d) => s + (d.exercises || []).length, 0);
            const avgSecs  = allDays.length > 0
              ? Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / allDays.length)
              : 0;
            const isOpen = expanded === p.id;

            return (
              <div key={p.id} className="bg-[#0F172A] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/20 hover:bg-white/[0.03] transition-all">
                <button
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/2 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                >
                  <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                    <Dumbbell size={17} className="text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{p.name}</p>
                    <p className="text-[11px] text-[#6B7280]">
                      {p.duration_weeks}w · {allDays.length} days · {totalEx} exercises
                      {avgSecs > 0 && ` · ~${fmtTime(avgSecs)}/session`}
                    </p>
                  </div>
                  <ChevronDown size={16} className={`text-[#6B7280] transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="border-t border-white/4 px-4 pb-4">
                    {p.description && (
                      <p className="text-[12px] text-[#9CA3AF] mt-3 mb-3">{p.description}</p>
                    )}
                    <div className="space-y-3 mt-3">
                      {Object.entries(weeks).map(([wk, days]) => (
                        <div key={wk}>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-[#6B7280] mb-2">Week {wk}</p>
                          <div className="space-y-2">
                            {(days || []).map((day, di) => (
                              <div key={di} className="bg-[#111827] rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[13px] font-semibold text-[#E5E7EB]">{day.name || `Day ${di + 1}`}</p>
                                  {calcDaySeconds(day) > 0 && (
                                    <span className="flex items-center gap-1 text-[10px] text-[#4B5563]">
                                      <Clock size={9} /> {fmtTime(calcDaySeconds(day))}
                                    </span>
                                  )}
                                </div>
                                {(day.exercises || []).length === 0 ? (
                                  <p className="text-[11px] text-[#4B5563]">No exercises</p>
                                ) : (
                                  <div className="space-y-1">
                                    {(day.exercises || []).map((ex, ei) => (
                                      <div key={ei} className="flex items-center justify-between text-[12px]">
                                        <span className="text-[#9CA3AF] truncate flex-1 mr-2">{exName(ex.id)}</span>
                                        <span className="text-[#6B7280] flex-shrink-0 font-mono text-[11px]">
                                          {ex.sets ?? DEFAULT_SETS} × {ex.min_reps && ex.max_reps && ex.min_reps !== ex.max_reps ? `${ex.min_reps}-${ex.max_reps}` : (ex.reps ?? ex.min_reps ?? '?')}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
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
