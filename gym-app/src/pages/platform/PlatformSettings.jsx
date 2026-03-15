import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Search,
  Plus,
  Trash2,
  X,
  Loader2,
  Shield,
  Dumbbell,
  Trophy,
  BookOpen,
  BarChart3,
  Pencil,
  Video,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Core', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Full Body', 'Cardio',
];

const EQUIPMENT = [
  'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight',
  'Kettlebell', 'Resistance Band', 'Smith Machine', 'EZ Bar', 'Other',
];

const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'];

/* ───────────────────────── tiny helpers ───────────────────────── */

function Badge({ count }) {
  return (
    <span className="ml-2 bg-[#D4AF37]/15 text-[#D4AF37] text-[11px] font-semibold px-2 py-0.5 rounded-full">
      {count}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="w-5 h-5 text-[#D4AF37] animate-spin" />
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-sm w-full mx-4">
        <p className="text-[13px] text-[#E5E7EB] mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">
            Cancel
          </button>
          <button onClick={onConfirm} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg px-4 py-2 text-[12px] font-semibold">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Modal wrapper ───────────────────────── */

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[14px] font-semibold text-[#E5E7EB]">{title}</p>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB]">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ───────────────────────── Input primitives ───────────────────────── */

const inputCls =
  'w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40';

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="text-[12px] text-[#9CA3AF] mb-1 block">{label}</span>
      {children}
    </label>
  );
}

/* ───────────────────────── Video preview helper ───────────────────────── */

function VideoPreview({ videoUrl }) {
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    if (!videoUrl) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.storage
        .from('exercise-videos')
        .createSignedUrl(videoUrl, 3600);
      if (!cancelled && data?.signedUrl) setSignedUrl(data.signedUrl);
    })();
    return () => { cancelled = true; };
  }, [videoUrl]);

  if (!videoUrl || !signedUrl) return null;
  return (
    <video
      src={signedUrl}
      controls
      className="w-full max-w-sm rounded-lg border border-white/6 mt-2"
      style={{ maxHeight: '200px' }}
    />
  );
}

/* ───────────────────────── Exercise Row (expandable) ───────────────────────── */

function ExerciseRow({ ex, onDelete, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newVideoFile, setNewVideoFile] = useState(null);
  const [removeVideo, setRemoveVideo] = useState(false);
  const [form, setForm] = useState({
    name: ex.name || '',
    muscle_group: ex.muscle_group || '',
    equipment: ex.equipment || '',
    default_sets: ex.default_sets ?? 3,
    default_reps: ex.default_reps ?? 10,
    instructions: ex.instructions || '',
  });

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.muscle_group) return;
    setSaving(true);

    let videoPath = ex.video_url || null;

    // Upload new video if selected
    if (newVideoFile) {
      const ext = newVideoFile.name.split('.').pop();
      const path = `global/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('exercise-videos')
        .upload(path, newVideoFile);
      if (!uploadError) {
        // Delete old video if replacing
        if (ex.video_url) {
          await supabase.storage.from('exercise-videos').remove([ex.video_url]);
        }
        videoPath = path;
      }
    } else if (removeVideo && ex.video_url) {
      await supabase.storage.from('exercise-videos').remove([ex.video_url]);
      videoPath = null;
    }

    const updates = {
      name: form.name.trim(),
      muscle_group: form.muscle_group,
      equipment: form.equipment || null,
      default_sets: Number(form.default_sets) || 3,
      default_reps: Number(form.default_reps) || 10,
      instructions: form.instructions.trim() || null,
      video_url: videoPath,
    };
    const { error } = await supabase.from('exercises').update(updates).eq('id', ex.id);
    setSaving(false);
    if (!error) {
      onUpdate({ ...ex, ...updates });
      setEditing(false);
      setNewVideoFile(null);
      setRemoveVideo(false);
    }
  };

  const handleCancel = () => {
    setForm({
      name: ex.name || '',
      muscle_group: ex.muscle_group || '',
      equipment: ex.equipment || '',
      default_sets: ex.default_sets ?? 3,
      default_reps: ex.default_reps ?? 10,
      instructions: ex.instructions || '',
    });
    setNewVideoFile(null);
    setRemoveVideo(false);
    setEditing(false);
  };

  const createdDate = ex.created_at
    ? new Date(ex.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="bg-[#111827] border border-white/6 rounded-lg">
      {/* Main row — click to expand */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start justify-between px-3 py-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-medium text-[#E5E7EB]">{ex.name}</p>
            {ex.muscle_group && (
              <span className="bg-indigo-500/15 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded-full">
                {ex.muscle_group}
              </span>
            )}
            {ex.equipment && (
              <span className="bg-blue-500/15 text-blue-400 text-[10px] px-1.5 py-0.5 rounded-full">
                {ex.equipment}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[11px] text-[#6B7280]">
              {ex.default_sets}x{ex.default_reps}
            </span>
            {ex.instructions && (
              <span className="text-[11px] text-[#4B5563] truncate max-w-[250px]">
                — {ex.instructions}
              </span>
            )}
            {ex.video_url && (
              <span className="text-[10px] text-[#D4AF37] flex items-center gap-0.5">
                <Video className="w-3 h-3" /> Video
              </span>
            )}
            {createdDate && (
              <span className="text-[10px] text-[#4B5563]">{createdDate}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3 mt-0.5">
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-[#6B7280]" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-[#6B7280]" />
          )}
        </div>
      </button>

      {/* Expanded detail + edit form */}
      {expanded && (
        <div className="px-3 pb-3">
          <div className="bg-[#111827]/60 rounded-lg p-3 mt-2 border border-white/4">
            {!editing ? (
              /* ── Detail view ── */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-[#9CA3AF]">Details</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                      className="flex items-center gap-1 text-[11px] text-[#D4AF37] hover:text-[#E6C766]"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      className="flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                  <div>
                    <span className="text-[#6B7280]">Muscle Group: </span>
                    <span className="text-[#E5E7EB]">{ex.muscle_group || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[#6B7280]">Equipment: </span>
                    <span className="text-[#E5E7EB]">{ex.equipment || 'None'}</span>
                  </div>
                  <div>
                    <span className="text-[#6B7280]">Default Sets: </span>
                    <span className="text-[#E5E7EB]">{ex.default_sets}</span>
                  </div>
                  <div>
                    <span className="text-[#6B7280]">Default Reps: </span>
                    <span className="text-[#E5E7EB]">{ex.default_reps}</span>
                  </div>
                  {createdDate && (
                    <div className="col-span-2">
                      <span className="text-[#6B7280]">Created: </span>
                      <span className="text-[#E5E7EB]">{createdDate}</span>
                    </div>
                  )}
                </div>

                {ex.instructions && (
                  <div>
                    <p className="text-[11px] text-[#6B7280] mb-0.5">Instructions</p>
                    <p className="text-[12px] text-[#9CA3AF] whitespace-pre-wrap">{ex.instructions}</p>
                  </div>
                )}

                <VideoPreview videoUrl={ex.video_url} />
              </div>
            ) : (
              /* ── Edit form ── */
              <div>
                <p className="text-[12px] font-semibold text-[#9CA3AF] mb-3">Edit Exercise</p>
                <Field label="Name *">
                  <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label="Muscle Group *">
                  <select className={inputCls} value={form.muscle_group} onChange={(e) => set('muscle_group', e.target.value)}>
                    <option value="">Select...</option>
                    {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Equipment">
                  <select className={inputCls} value={form.equipment} onChange={(e) => set('equipment', e.target.value)}>
                    <option value="">None</option>
                    {EQUIPMENT.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Default Sets">
                    <input className={inputCls} type="number" min={1} value={form.default_sets} onChange={(e) => set('default_sets', e.target.value)} />
                  </Field>
                  <Field label="Default Reps">
                    <input className={inputCls} type="number" min={1} value={form.default_reps} onChange={(e) => set('default_reps', e.target.value)} />
                  </Field>
                </div>
                <Field label="Instructions">
                  <textarea className={`${inputCls} min-h-[80px] resize-none`} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="Coaching cues..." />
                </Field>
                <Field label="Exercise Video (optional)">
                  {ex.video_url && !removeVideo && !newVideoFile && (
                    <div className="mb-2">
                      <VideoPreview videoUrl={ex.video_url} />
                      <button
                        type="button"
                        onClick={() => setRemoveVideo(true)}
                        className="text-[11px] text-red-400 hover:text-red-300 mt-1"
                      >
                        Remove Video
                      </button>
                    </div>
                  )}
                  {removeVideo && !newVideoFile && (
                    <p className="text-[11px] text-[#6B7280] mb-1">Video will be removed on save.{' '}
                      <button type="button" onClick={() => setRemoveVideo(false)} className="text-[#D4AF37] hover:text-[#E6C766]">Undo</button>
                    </p>
                  )}
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => { setNewVideoFile(e.target.files[0] || null); setRemoveVideo(false); }}
                    className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] file:mr-3 file:px-3 file:py-1 file:rounded-lg file:border-0 file:bg-[#D4AF37]/15 file:text-[#D4AF37] file:text-[12px] file:font-medium file:cursor-pointer outline-none"
                  />
                  {newVideoFile && <p className="text-[11px] text-[#6B7280] mt-1">{newVideoFile.name}</p>}
                </Field>
                <div className="flex justify-end gap-3 mt-2">
                  <button onClick={handleCancel} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !form.name.trim() || !form.muscle_group}
                    className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
                  >
                    {saving ? (newVideoFile ? 'Uploading...' : 'Saving...') : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function PlatformSettings() {
  const { profile } = useAuth();

  /* ── section open/close ── */
  const [accountOpen, setAccountOpen] = useState(true);
  const [exercisesOpen, setExercisesOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [programsOpen, setProgramsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  /* ── data ── */
  const [exercises, setExercises] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [platformStats, setPlatformStats] = useState({ gyms: 0, members: 0 });

  /* ── loading flags ── */
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [loadingAchievements, setLoadingAchievements] = useState(false);
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);

  /* ── search ── */
  const [exSearch, setExSearch] = useState('');
  const [exMuscleFilter, setExMuscleFilter] = useState('');

  /* ── modals ── */
  const [showExModal, setShowExModal] = useState(false);
  const [showAchModal, setShowAchModal] = useState(false);
  const [showProgModal, setShowProgModal] = useState(false);

  /* ── delete confirm ── */
  const [confirmDelete, setConfirmDelete] = useState(null); // { table, id, label }

  /* ────────────────── fetchers ────────────────── */

  const fetchExercises = async () => {
    setLoadingExercises(true);
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .is('gym_id', null)
      .order('name');
    setExercises(data || []);
    setLoadingExercises(false);
  };

  const fetchAchievements = async () => {
    setLoadingAchievements(true);
    const { data } = await supabase
      .from('achievement_definitions')
      .select('*')
      .is('gym_id', null)
      .order('name');
    setAchievements(data || []);
    setLoadingAchievements(false);
  };

  const fetchPrograms = async () => {
    setLoadingPrograms(true);
    const { data } = await supabase
      .from('program_templates')
      .select('*')
      .is('gym_id', null)
      .order('name');
    setPrograms(data || []);
    setLoadingPrograms(false);
  };

  const fetchStats = async () => {
    setLoadingStats(true);
    const [gymsRes, membersRes] = await Promise.all([
      supabase.from('gyms').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);
    setPlatformStats({
      gyms: gymsRes.count ?? 0,
      members: membersRes.count ?? 0,
    });
    setLoadingStats(false);
  };

  useEffect(() => {
    fetchExercises();
    fetchAchievements();
    fetchPrograms();
    fetchStats();
  }, []);

  /* ────────────────── delete handler ────────────────── */

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { table, id } = confirmDelete;
    await supabase.from(table).delete().eq('id', id);
    setConfirmDelete(null);
    if (table === 'exercises') fetchExercises();
    if (table === 'achievement_definitions') fetchAchievements();
    if (table === 'program_templates') fetchPrograms();
  };

  /* ────────────────── optimistic exercise update ────────────────── */

  const handleExerciseUpdate = (updated) => {
    setExercises((prev) => prev.map((ex) => (ex.id === updated.id ? updated : ex)));
  };

  /* ────────────────── filtered exercises ────────────────── */

  const filteredExercises = exercises.filter((ex) => {
    const matchesSearch = !exSearch || ex.name?.toLowerCase().includes(exSearch.toLowerCase());
    const matchesMuscle = !exMuscleFilter || ex.muscle_group === exMuscleFilter;
    return matchesSearch && matchesMuscle;
  });

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-[18px] font-bold text-[#E5E7EB] mb-2">Platform Settings</h1>
      <p className="text-[13px] text-[#6B7280] mb-6">
        Manage global platform configuration, exercises, achievements, and program templates.
      </p>

      {/* ──────── 1. Your Account ──────── */}
      <CollapsibleSection
        title="Your Account"
        icon={<Shield className="w-4 h-4 text-[#D4AF37]" />}
        open={accountOpen}
        toggle={() => setAccountOpen(!accountOpen)}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <InfoCard label="Name" value={profile?.full_name || profile?.username || '—'} />
          <InfoCard label="Email" value={profile?.email || '—'} />
          <InfoCard label="Role" value={profile?.role || '—'} />
        </div>
      </CollapsibleSection>

      {/* ──────── 2. Global Exercise Library ──────── */}
      <CollapsibleSection
        title="Global Exercise Library"
        icon={<Dumbbell className="w-4 h-4 text-[#D4AF37]" />}
        badge={exercises.length}
        open={exercisesOpen}
        toggle={() => setExercisesOpen(!exercisesOpen)}
      >
        {loadingExercises ? (
          <Spinner />
        ) : (
          <>
            {/* toolbar */}
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B7280]" />
                <input
                  className={`${inputCls} pl-8`}
                  placeholder="Search exercises..."
                  value={exSearch}
                  onChange={(e) => setExSearch(e.target.value)}
                />
              </div>
              <select
                className={`${inputCls} sm:w-44`}
                value={exMuscleFilter}
                onChange={(e) => setExMuscleFilter(e.target.value)}
              >
                <option value="">All Muscle Groups</option>
                {MUSCLE_GROUPS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button
                onClick={() => setShowExModal(true)}
                className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" /> Add Exercise
              </button>
            </div>

            <p className="text-[12px] text-[#6B7280] mb-3">
              {filteredExercises.length} global exercise{filteredExercises.length !== 1 ? 's' : ''}
            </p>

            {/* list */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {filteredExercises.map((ex) => (
                <ExerciseRow
                  key={ex.id}
                  ex={ex}
                  onDelete={() => setConfirmDelete({ table: 'exercises', id: ex.id, label: ex.name })}
                  onUpdate={handleExerciseUpdate}
                />
              ))}
              {filteredExercises.length === 0 && (
                <p className="text-[12px] text-[#4B5563] text-center py-6">No exercises found.</p>
              )}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* ──────── 3. Global Achievement Definitions ──────── */}
      <CollapsibleSection
        title="Global Achievements"
        icon={<Trophy className="w-4 h-4 text-[#D4AF37]" />}
        badge={achievements.length}
        open={achievementsOpen}
        toggle={() => setAchievementsOpen(!achievementsOpen)}
      >
        {loadingAchievements ? (
          <Spinner />
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[12px] text-[#6B7280]">
                {achievements.length} global achievement{achievements.length !== 1 ? 's' : ''}
              </p>
              <button
                onClick={() => setShowAchModal(true)}
                className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Achievement
              </button>
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {achievements.map((ach) => (
                <div
                  key={ach.id}
                  className="flex items-center justify-between bg-[#111827] border border-white/6 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#E5E7EB] truncate">{ach.name}</p>
                    <p className="text-[11px] text-[#6B7280]">
                      {ach.type} &middot; Req: {ach.requirement_value} &middot; {ach.description || '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => setConfirmDelete({ table: 'achievement_definitions', id: ach.id, label: ach.name })}
                    className="ml-3 text-[#6B7280] hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {achievements.length === 0 && (
                <p className="text-[12px] text-[#4B5563] text-center py-6">No achievements defined.</p>
              )}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* ──────── 4. Global Program Templates ──────── */}
      <CollapsibleSection
        title="Global Program Templates"
        icon={<BookOpen className="w-4 h-4 text-[#D4AF37]" />}
        badge={programs.length}
        open={programsOpen}
        toggle={() => setProgramsOpen(!programsOpen)}
      >
        {loadingPrograms ? (
          <Spinner />
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[12px] text-[#6B7280]">
                {programs.length} global template{programs.length !== 1 ? 's' : ''}
              </p>
              <button
                onClick={() => setShowProgModal(true)}
                className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Template
              </button>
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {programs.map((prog) => (
                <div
                  key={prog.id}
                  className="flex items-center justify-between bg-[#111827] border border-white/6 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#E5E7EB] truncate">{prog.name}</p>
                    <p className="text-[11px] text-[#6B7280]">
                      {prog.difficulty_level} &middot; {prog.duration_weeks} weeks &middot; {prog.description || '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => setConfirmDelete({ table: 'program_templates', id: prog.id, label: prog.name })}
                    className="ml-3 text-[#6B7280] hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {programs.length === 0 && (
                <p className="text-[12px] text-[#4B5563] text-center py-6">No program templates.</p>
              )}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* ──────── 5. Platform Info ──────── */}
      <CollapsibleSection
        title="Platform Info"
        icon={<BarChart3 className="w-4 h-4 text-[#D4AF37]" />}
        open={infoOpen}
        toggle={() => setInfoOpen(!infoOpen)}
      >
        {loadingStats ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoCard label="Total Gyms" value={platformStats.gyms} />
            <InfoCard label="Total Members" value={platformStats.members} />
          </div>
        )}
      </CollapsibleSection>

      {/* ══════════ MODALS ══════════ */}

      {showExModal && (
        <ExerciseModal
          onClose={() => setShowExModal(false)}
          onSaved={() => { setShowExModal(false); fetchExercises(); }}
        />
      )}

      {showAchModal && (
        <AchievementModal
          onClose={() => setShowAchModal(false)}
          onSaved={() => { setShowAchModal(false); fetchAchievements(); }}
        />
      )}

      {showProgModal && (
        <ProgramModal
          onClose={() => setShowProgModal(false)}
          onSaved={() => { setShowProgModal(false); fetchPrograms(); }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.label}"? This action cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */

function CollapsibleSection({ title, icon, badge, open, toggle, children }) {
  return (
    <div className="bg-[#0F172A] border border-white/6 rounded-xl">
      <button onClick={toggle} className="w-full flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-[13px] font-semibold text-[#E5E7EB]">{title}</p>
          {badge !== undefined && <Badge count={badge} />}
        </div>
        <ChevronDown className={`w-4 h-4 text-[#6B7280] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 border-t border-white/6">{children}</div>}
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="bg-[#111827] border border-white/6 rounded-lg px-3 py-2">
      <p className="text-[11px] text-[#6B7280] mb-0.5">{label}</p>
      <p className="text-[13px] text-[#E5E7EB] font-medium">{value}</p>
    </div>
  );
}

/* ───────────────── Exercise Modal ───────────────── */

function ExerciseModal({ onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [form, setForm] = useState({
    name: '',
    muscle_group: '',
    equipment: '',
    default_sets: 3,
    default_reps: 10,
    instructions: '',
  });

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.muscle_group) return;
    setSaving(true);

    let videoPath = null;
    if (videoFile) {
      const ext = videoFile.name.split('.').pop();
      const path = `global/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('exercise-videos')
        .upload(path, videoFile);
      if (!uploadError) videoPath = path;
    }

    await supabase.from('exercises').insert({
      gym_id: null,
      name: form.name.trim(),
      muscle_group: form.muscle_group,
      equipment: form.equipment || null,
      default_sets: Number(form.default_sets) || 3,
      default_reps: Number(form.default_reps) || 10,
      instructions: form.instructions.trim() || null,
      video_url: videoPath,
    });
    setSaving(false);
    onSaved();
  };

  return (
    <Modal title="Add Global Exercise" onClose={onClose}>
      <Field label="Name *">
        <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Barbell Bench Press" />
      </Field>
      <Field label="Muscle Group *">
        <select className={inputCls} value={form.muscle_group} onChange={(e) => set('muscle_group', e.target.value)}>
          <option value="">Select...</option>
          {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Equipment">
        <select className={inputCls} value={form.equipment} onChange={(e) => set('equipment', e.target.value)}>
          <option value="">None</option>
          {EQUIPMENT.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Default Sets">
          <input className={inputCls} type="number" min={1} value={form.default_sets} onChange={(e) => set('default_sets', e.target.value)} />
        </Field>
        <Field label="Default Reps">
          <input className={inputCls} type="number" min={1} value={form.default_reps} onChange={(e) => set('default_reps', e.target.value)} />
        </Field>
      </div>
      <Field label="Instructions">
        <textarea className={`${inputCls} min-h-[80px] resize-none`} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="Optional coaching cues..." />
      </Field>
      <Field label="Exercise Video (optional)">
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setVideoFile(e.target.files[0] || null)}
          className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] file:mr-3 file:px-3 file:py-1 file:rounded-lg file:border-0 file:bg-[#D4AF37]/15 file:text-[#D4AF37] file:text-[12px] file:font-medium file:cursor-pointer outline-none"
        />
        {videoFile && <p className="text-[11px] text-[#6B7280] mt-1">{videoFile.name}</p>}
      </Field>
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim() || !form.muscle_group}
          className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
        >
          {saving ? (videoFile ? 'Uploading...' : 'Saving...') : 'Save Exercise'}
        </button>
      </div>
    </Modal>
  );
}

/* ───────────────── Achievement Modal ───────────────── */

function AchievementModal({ onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: '',
    requirement_value: 1,
  });

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.type.trim()) return;
    setSaving(true);
    await supabase.from('achievement_definitions').insert({
      gym_id: null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      type: form.type.trim(),
      requirement_value: Number(form.requirement_value) || 1,
    });
    setSaving(false);
    onSaved();
  };

  return (
    <Modal title="Add Global Achievement" onClose={onClose}>
      <Field label="Name *">
        <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. First Workout" />
      </Field>
      <Field label="Type *">
        <input className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value)} placeholder="e.g. streak, volume, pr" />
      </Field>
      <Field label="Requirement Value">
        <input className={inputCls} type="number" min={1} value={form.requirement_value} onChange={(e) => set('requirement_value', e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea className={`${inputCls} min-h-[60px] resize-none`} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional description..." />
      </Field>
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim() || !form.type.trim()}
          className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save Achievement'}
        </button>
      </div>
    </Modal>
  );
}

/* ───────────────── Program Template Modal ───────────────── */

function ProgramModal({ onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    difficulty_level: 'beginner',
    duration_weeks: 8,
  });

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    await supabase.from('program_templates').insert({
      gym_id: null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      difficulty_level: form.difficulty_level,
      duration_weeks: Number(form.duration_weeks) || 8,
    });
    setSaving(false);
    onSaved();
  };

  return (
    <Modal title="Add Global Program Template" onClose={onClose}>
      <Field label="Name *">
        <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. PPL Hypertrophy 12-Week" />
      </Field>
      <Field label="Difficulty Level">
        <select className={inputCls} value={form.difficulty_level} onChange={(e) => set('difficulty_level', e.target.value)}>
          {DIFFICULTY_LEVELS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
        </select>
      </Field>
      <Field label="Duration (weeks)">
        <input className={inputCls} type="number" min={1} max={52} value={form.duration_weeks} onChange={(e) => set('duration_weeks', e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea className={`${inputCls} min-h-[60px] resize-none`} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional program description..." />
      </Field>
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim()}
          className="bg-[#D4AF37] text-black hover:bg-[#E6C766] rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save Template'}
        </button>
      </div>
    </Modal>
  );
}
