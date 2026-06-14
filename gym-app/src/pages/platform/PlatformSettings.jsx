import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  Mail,
  Settings2,
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Database,
  HardDrive,
  Users,
  Save,
  Smartphone,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import PlatformSpinner from '../../components/platform/PlatformSpinner';

// The REAL muscle_group enum: 0001 (Chest…Full Body) + 0044 (Forearms,
// Traps) + 0247 (Warm-Up). The old list offered Quads/Hamstrings/Cardio —
// values that don't exist (insert/update failed) — and omitted
// Legs/Traps/Warm-Up (Legs exercises unfilterable, blank select on edit).
const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Traps',
  'Legs', 'Glutes', 'Core', 'Calves', 'Full Body', 'Warm-Up',
];

// The REAL equipment_type enum: 0001 + 0044 (EZ Bar). 'Other' was not an
// enum value (save failed); the column is NOT NULL so there is no "None".
const EQUIPMENT = [
  'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight',
  'Kettlebell', 'Resistance Band', 'Smith Machine', 'EZ Bar',
];

// fitness_level enum (0001) — program_templates.level
const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'];

// achievement_category enum (0001) — achievement_definitions.category
const ACHIEVEMENT_CATEGORIES = ['milestone', 'challenge', 'strength_standard', 'streak', 'social'];

/* ───────────────────────── tiny helpers ───────────────────────── */

function Badge({ count }) {
  return (
    <span className="ml-2 bg-[#D4AF37]/15 text-[#D4AF37] text-[11px] font-semibold px-2 py-0.5 rounded-full">
      {count}
    </span>
  );
}

function Spinner() {
  return <PlatformSpinner />;
}

function ConfirmDialog({ message, onConfirm, onCancel, cancelLabel = 'Cancel', deleteLabel = 'Delete' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[#0F172A] border border-white/8 rounded-2xl p-6 max-w-sm w-full mx-4">
        <p className="text-[13px] text-[#E5E7EB] mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg px-4 py-2 text-[12px] font-semibold">
            {deleteLabel}
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
  if (!videoUrl) return null;
  let src = videoUrl;
  if (!src.startsWith('/') && !src.startsWith('http')) {
    const { data } = supabase.storage.from('exercise-videos').getPublicUrl(src);
    src = data?.publicUrl || null;
  }
  if (!src) return null;
  return (
    <video
      src={src}
      controls
      playsInline
      className="w-full max-w-sm rounded-lg border border-white/6 mt-2"
      style={{ maxHeight: '200px' }}
    />
  );
}

/* ───────────────────────── Exercise Row (expandable) ───────────────────────── */

function ExerciseRow({ ex, onDelete, onUpdate }) {
  const { t } = useTranslation('pages');
  const tp = (key) => t(`platformSettings.${key}`);
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
    if (!form.name.trim() || !form.muscle_group || !form.equipment) return;
    setSaving(true);

    let videoPath = ex.video_url || null;

    // Upload new video if selected
    if (newVideoFile) {
      const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
      const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
      if (newVideoFile.size > MAX_VIDEO_SIZE) {
        alert('Video must be under 100MB');
        setSaving(false);
        return;
      }
      if (!ALLOWED_VIDEO_TYPES.includes(newVideoFile.type)) {
        alert('Only MP4, WebM, and MOV videos are allowed');
        setSaving(false);
        return;
      }
      const extMap = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
      const ext = extMap[newVideoFile.type] || 'mp4';
      const path = `global/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('exercise-videos')
        .upload(path, newVideoFile, { contentType: newVideoFile.type });
      if (uploadError) {
        // Don't save the exercise silently without the video the admin just
        // picked — abort so they can retry or remove the file.
        alert(t('platformSettings.videoUploadFailed', 'Video upload failed: {{msg}}. The exercise was NOT saved — retry or remove the video.', { msg: uploadError.message }));
        setSaving(false);
        return;
      }
      // Delete old video if replacing (best effort — orphan is harmless)
      if (ex.video_url) {
        await supabase.storage.from('exercise-videos').remove([ex.video_url]);
      }
      videoPath = path;
    } else if (removeVideo && ex.video_url) {
      await supabase.storage.from('exercise-videos').remove([ex.video_url]);
      videoPath = null;
    }

    const updates = {
      name: form.name.trim(),
      muscle_group: form.muscle_group,
      equipment: form.equipment, // NOT NULL enum — required by the form
      default_sets: Number(form.default_sets) || 3,
      default_reps: Number(form.default_reps) || 10,
      instructions: form.instructions.trim() || null,
      video_url: videoPath,
    };
    const { error } = await supabase.from('exercises').update(updates).eq('id', ex.id);
    setSaving(false);
    if (error) {
      alert(`Save failed: ${error.message}`);
      return;
    }
    onUpdate({ ...ex, ...updates });
    setEditing(false);
    setNewVideoFile(null);
    setRemoveVideo(false);
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

  const { i18n } = useTranslation('pages');
  const dateLocale = i18n.language?.startsWith('es') ? 'es-ES' : 'en-US';
  const createdDate = ex.created_at
    ? new Date(ex.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' })
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
                <Video className="w-3 h-3" /> {tp('video')}
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
                  <p className="text-[12px] font-semibold text-[#9CA3AF]">{tp('details')}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                      className="flex items-center gap-1 text-[11px] text-[#D4AF37] hover:text-[#E6C766]"
                    >
                      <Pencil className="w-3 h-3" /> {tp('edit')}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      className="flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" /> {tp('delete')}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                  <div>
                    <span className="text-[#6B7280]">{tp('muscleGroup')}: </span>
                    <span className="text-[#E5E7EB]">{ex.muscle_group || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[#6B7280]">{tp('equipment')}: </span>
                    <span className="text-[#E5E7EB]">{ex.equipment || tp('none')}</span>
                  </div>
                  <div>
                    <span className="text-[#6B7280]">{tp('defaultSets')}: </span>
                    <span className="text-[#E5E7EB]">{ex.default_sets}</span>
                  </div>
                  <div>
                    <span className="text-[#6B7280]">{tp('defaultReps')}: </span>
                    <span className="text-[#E5E7EB]">{ex.default_reps}</span>
                  </div>
                  {createdDate && (
                    <div className="col-span-2">
                      <span className="text-[#6B7280]">{tp('created')}: </span>
                      <span className="text-[#E5E7EB]">{createdDate}</span>
                    </div>
                  )}
                </div>

                {ex.instructions && (
                  <div>
                    <p className="text-[11px] text-[#6B7280] mb-0.5">{tp('instructions')}</p>
                    <p className="text-[12px] text-[#9CA3AF] whitespace-pre-wrap">{ex.instructions}</p>
                  </div>
                )}

                <VideoPreview videoUrl={ex.video_url} />
              </div>
            ) : (
              /* ── Edit form ── */
              <div>
                <p className="text-[12px] font-semibold text-[#9CA3AF] mb-3">{tp('editExercise')}</p>
                <Field label={`${tp('nameLabel')} *`}>
                  <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label={`${tp('muscleGroup')} *`}>
                  <select className={inputCls} value={form.muscle_group} onChange={(e) => set('muscle_group', e.target.value)}>
                    <option value="">{tp('select')}</option>
                    {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label={`${tp('equipment')} *`}>
                  {/* equipment is a NOT NULL enum — no "None" option */}
                  <select className={inputCls} value={form.equipment} onChange={(e) => set('equipment', e.target.value)}>
                    {!EQUIPMENT.includes(form.equipment) && <option value="">{tp('select')}</option>}
                    {EQUIPMENT.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={tp('defaultSets')}>
                    <input className={inputCls} type="number" min={1} value={form.default_sets} onChange={(e) => set('default_sets', e.target.value)} />
                  </Field>
                  <Field label={tp('defaultReps')}>
                    <input className={inputCls} type="number" min={1} value={form.default_reps} onChange={(e) => set('default_reps', e.target.value)} />
                  </Field>
                </div>
                <Field label={tp('instructions')}>
                  <textarea className={`${inputCls} min-h-[80px] resize-none`} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder={tp('coachingCues')} />
                </Field>
                <Field label={tp('exerciseVideo')}>
                  {ex.video_url && !removeVideo && !newVideoFile && (
                    <div className="mb-2">
                      <VideoPreview videoUrl={ex.video_url} />
                      <button
                        type="button"
                        onClick={() => setRemoveVideo(true)}
                        className="text-[11px] text-red-400 hover:text-red-300 mt-1"
                      >
                        {tp('removeVideo')}
                      </button>
                    </div>
                  )}
                  {removeVideo && !newVideoFile && (
                    <p className="text-[11px] text-[#6B7280] mb-1">{tp('videoWillBeRemoved')}{' '}
                      <button type="button" onClick={() => setRemoveVideo(false)} className="text-[#D4AF37] hover:text-[#E6C766]">{tp('undo')}</button>
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
                    {tp('cancel')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !form.name.trim() || !form.muscle_group || !form.equipment}
                    className="text-black rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
                    style={{ background: '#D4AF37' }}
                  >
                    {saving ? (newVideoFile ? tp('uploading') : tp('saving')) : tp('saveChanges')}
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

const DEFAULT_GYM_CONFIG = {
  dailyCalories: 2200,
  trainingDays: 4,
  defaultLanguage: 'en',
  defaultTheme: 'dark',
};

export default function PlatformSettings() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const tp = (key) => t(`platformSettings.${key}`);

  useEffect(() => {
    document.title = `${tp('title')} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [tp]);

  /* ── section open/close ── */
  const [settingsTab, setSettingsTab] = useState('content');
  const [accountOpen, setAccountOpen] = useState(true);
  const [exercisesOpen, setExercisesOpen] = useState(true);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [programsOpen, setProgramsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(true);
  const [versionOpen, setVersionOpen] = useState(true);
  const [defaultsOpen, setDefaultsOpen] = useState(true);
  const [healthOpen, setHealthOpen] = useState(true);

  /* ── data ── */
  const [exercises, setExercises] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [platformStats, setPlatformStats] = useState({ gyms: 0, members: 0 });

  /* ── default gym config (persisted to platform_config; read by
        platform_create_gym, migration 0542) ── */
  const [gymDefaults, setGymDefaults] = useState({ ...DEFAULT_GYM_CONFIG });
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [defaultsError, setDefaultsError] = useState(null);

  /* ── system health (real probes only) ── */
  const [health, setHealth] = useState({
    supabase: null,      // true/false/null
    activeUsers: null,
    storageOk: null,     // true/false/null
    bucketCount: null,
    loadingHealth: false,
  });
  const [accountEmail, setAccountEmail] = useState(null);

  /* ── app version gate (persisted to app_config) ── */
  const [appVersion, setAppVersion] = useState({
    min_required_version: '',
    latest_version:       '',
    ios_store_url:        '',
    android_store_url:    '',
  });
  const [appVersionLoaded, setAppVersionLoaded] = useState(false);
  const [appVersionSaving, setAppVersionSaving] = useState(false);
  const [appVersionSaved, setAppVersionSaved] = useState(false);
  const [appVersionError, setAppVersionError] = useState(null);

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
    // Members = real members only: staff and imported_archived history
    // ghosts (0421) inflated this count before.
    const [gymsRes, membersRes] = await Promise.all([
      supabase.from('gyms').select('id', { count: 'exact', head: true }),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'member')
        .eq('imported_archived', false),
    ]);
    setPlatformStats({
      gyms: gymsRes.count ?? 0,
      members: membersRes.count ?? 0,
    });
    setLoadingStats(false);
  };

  /* ────────────────── system health check (real probes) ────────────────── */

  const fetchHealth = useCallback(async () => {
    setHealth(h => ({ ...h, loadingHealth: true }));
    let sbOk = false;
    let activeCount = null;
    let storageOk = null;
    let bucketCount = null;

    try {
      // Test supabase connectivity with a simple query
      const { error } = await supabase.from('gyms').select('id', { count: 'exact', head: true });
      sbOk = !error;
    } catch { sbOk = false; }

    try {
      // Active users in last 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('last_active_at', since);
      activeCount = count ?? 0;
    } catch { activeCount = null; }

    try {
      // Storage reachability — a real listBuckets round-trip, not the old
      // hardcoded bucket-name chips.
      const { data: buckets, error } = await supabase.storage.listBuckets();
      storageOk = !error;
      bucketCount = error ? null : (buckets?.length ?? 0);
    } catch { storageOk = false; bucketCount = null; }

    setHealth({ supabase: sbOk, activeUsers: activeCount, storageOk, bucketCount, loadingHealth: false });
  }, []);

  /* ────────────────── account email (real auth value) ────────────────── */
  // profiles has no email column (0466) — profile?.email was always "—".
  const fetchAccountEmail = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      setAccountEmail(error ? null : (data?.user?.email || null));
    } catch { setAccountEmail(null); }
  }, []);

  /* ────────────────── platform_config persistence ────────────────── */
  // Only gym_defaults lives here now. The duplicate feature-flag panel and
  // the email toggles were removed (P0-3): they wrote platform_config keys
  // nothing reads — the REAL kill switches live on Operations and are read
  // by get_platform_flags (0547).

  const fetchPlatformConfig = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('platform_config')
        .select('key, value')
        .eq('key', 'gym_defaults')
        .maybeSingle();

      if (!error && data?.value != null) {
        try {
          // Tolerate both storage shapes: jsonb object (current) and the
          // legacy JSON-encoded string (0542's reader handles both too).
          const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
          if (parsed && typeof parsed === 'object') {
            setGymDefaults(prev => ({ ...prev, ...parsed }));
          }
        } catch { /* keep defaults */ }
      }
    } catch { /* silent — use defaults */ }
  }, []);

  /* ────────────────── save gym defaults ────────────────── */
  // Read by platform_create_gym (0542) when a new gym is created. Stored as
  // a jsonb OBJECT so the SQL side can value->>'…' directly.

  const saveGymDefaults = async () => {
    setDefaultsError(null);
    const { error } = await supabase.from('platform_config').upsert({
      key: 'gym_defaults',
      value: gymDefaults,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    if (error) {
      setDefaultsError(t('platformSettings.defaultsSaveFailed', "Couldn't save the defaults: {{msg}}", { msg: error.message }));
      return;
    }
    logAdminAction('save_gym_defaults', 'platform_config', null, { defaults: gymDefaults });
    setDefaultsSaved(true);
    setTimeout(() => setDefaultsSaved(false), 2000);
  };

  /* ────────────────── app version gate persistence ────────────────── */

  // Fetch via the same RPC the client uses so what the admin sees is what
  // every user is currently being gated against — no risk of staring at a
  // stale local copy.
  const fetchAppVersion = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_app_version');
      if (!error && data) {
        setAppVersion({
          min_required_version: data.min_required_version || '',
          latest_version:       data.latest_version || '',
          ios_store_url:        data.ios_store_url || '',
          android_store_url:    data.android_store_url || '',
        });
      }
    } catch { /* silent — defaults stay blank */ }
    setAppVersionLoaded(true);
  }, []);

  const saveAppVersion = async () => {
    setAppVersionSaving(true);
    setAppVersionError(null);
    try {
      const payload = {
        min_required_version: appVersion.min_required_version.trim(),
        latest_version:       appVersion.latest_version.trim(),
        ios_store_url:        appVersion.ios_store_url.trim() || null,
        android_store_url:    appVersion.android_store_url.trim() || null,
      };
      if (!payload.min_required_version || !payload.latest_version) {
        throw new Error('Both version fields are required.');
      }
      const { error } = await supabase
        .from('app_config')
        .update(payload)
        .eq('id', 1);
      if (error) throw error;
      // Audit row is appended server-side by the app_config_audit trigger
      // (see migration 0393). No client-side logAdminAction call needed.
      setAppVersionSaved(true);
      setTimeout(() => setAppVersionSaved(false), 2000);
    } catch (err) {
      setAppVersionError(err?.message || 'Save failed');
    } finally {
      setAppVersionSaving(false);
    }
  };

  useEffect(() => {
    fetchExercises();
    fetchAchievements();
    fetchPrograms();
    fetchStats();
    fetchHealth();
    fetchAccountEmail();
    fetchPlatformConfig();
    fetchAppVersion();
  }, []);

  /* ────────────────── delete handler ────────────────── */
  // .select('id') returns the deleted rows: a clean response with ZERO rows
  // means RLS filtered the delete (this exact failure hid the missing
  // program_templates super_admin policy until 0545) — warn, don't pretend.

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { table, id, label } = confirmDelete;
    const { data: deletedRows, error } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .select('id');
    setConfirmDelete(null);

    if (error) {
      alert(t('platformSettings.deleteFailed', 'Delete failed: {{msg}}', { msg: error.message }));
      return;
    }
    if (!deletedRows || deletedRows.length === 0) {
      alert(t('platformSettings.deleteNoRows', 'Nothing was deleted — "{{name}}" may be protected by permissions or already gone.', { name: label }));
      return;
    }
    logAdminAction('delete_global_content', table, id, { label });
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
    <div className="px-4 py-6 max-w-[480px] mx-auto md:max-w-4xl space-y-4 pb-28 md:pb-12">
      <h1 className="text-[22px] font-bold text-[#E5E7EB] mb-0.5 truncate">{tp('title')}</h1>
      <p className="text-[12px] text-[#6B7280] mb-4">
        {tp('sharedConfigSubtitle')}
      </p>

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-white/6 mb-5 overflow-x-auto scrollbar-hide">
        {[
          { key: 'content', label: tp('tabContent') },
          { key: 'comms', label: tp('tabComms') },
          { key: 'defaults', label: tp('tabDefaults') },
          { key: 'system', label: tp('tabSystem') },
          { key: 'health', label: tp('tabHealth') },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setSettingsTab(t.key)}
            className={`px-4 py-2.5 text-[12px] font-medium transition-colors whitespace-nowrap ${
              settingsTab === t.key
                ? 'text-[#D4AF37] border-b-2 border-[#D4AF37] bg-white/[0.02]'
                : 'text-[#6B7280] hover:text-[#9CA3AF]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Shared Content tab ── */}
      {settingsTab === 'content' && (<>

      {/* ──────── 1. Your Account ──────── */}
      <CollapsibleSection
        title={tp('yourAccount')}
        icon={<Shield className="w-4 h-4 text-[#D4AF37]" />}
        open={accountOpen}
        toggle={() => setAccountOpen(!accountOpen)}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <InfoCard label={tp('name')} value={profile?.full_name || profile?.username || '—'} />
          {/* profiles has no email column — the real value lives on auth.users */}
          <InfoCard label={tp('email')} value={accountEmail || '—'} />
          <InfoCard label={tp('role')} value={profile?.role || '—'} />
        </div>
      </CollapsibleSection>

      {/* ──────── 2. Global Exercise Library ──────── */}
      <CollapsibleSection
        title={tp('exerciseLibrary')}
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
                  placeholder={tp('searchExercises')}
                  value={exSearch}
                  onChange={(e) => setExSearch(e.target.value)}
                />
              </div>
              <select
                className={`${inputCls} sm:w-44`}
                value={exMuscleFilter}
                onChange={(e) => setExMuscleFilter(e.target.value)}
              >
                <option value="">{tp('allMuscleGroups')}</option>
                {MUSCLE_GROUPS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button
                onClick={() => setShowExModal(true)}
                className="text-black rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap"
                style={{ background: '#D4AF37' }}
              >
                <Plus className="w-3.5 h-3.5" /> {tp('addExercise')}
              </button>
            </div>

            <p className="text-[12px] text-[#6B7280] mb-3">
              {filteredExercises.length} {tp('globalExerciseCount')}
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
                <p className="text-[12px] text-[#4B5563] text-center py-6">{tp('noExercisesFound')}</p>
              )}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* ──────── 3. Global Achievement Definitions ──────── */}
      <CollapsibleSection
        title={tp('achievements')}
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
                {achievements.length} {tp('globalAchievementCount')}
              </p>
              <button
                onClick={() => setShowAchModal(true)}
                className="text-black rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5"
                style={{ background: '#D4AF37' }}
              >
                <Plus className="w-3.5 h-3.5" /> {tp('addAchievement')}
              </button>
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {achievements.map((ach) => (
                <div
                  key={ach.id}
                  className="flex items-center justify-between bg-[#111827] border border-white/6 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0 flex items-center gap-2.5">
                    <span className="text-[18px] shrink-0 w-7 text-center">{ach.icon || '🏆'}</span>
                    <div className="min-w-0">
                      <p className="text-[13px] text-[#E5E7EB] truncate">{ach.name}</p>
                      <p className="text-[11px] text-[#6B7280] truncate">
                        <span className="bg-indigo-500/15 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded-full mr-1.5">
                          {ach.category || '—'}
                        </span>
                        {ach.description || '—'}
                      </p>
                    </div>
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
                <p className="text-[12px] text-[#4B5563] text-center py-6">{tp('noAchievementsDefined')}</p>
              )}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* ──────── 4. Global Program Templates ──────── */}
      <CollapsibleSection
        title={tp('programTemplates')}
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
                {programs.length} {tp('globalTemplateCount')}
              </p>
              <button
                onClick={() => setShowProgModal(true)}
                className="text-black rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5"
                style={{ background: '#D4AF37' }}
              >
                <Plus className="w-3.5 h-3.5" /> {tp('addTemplate')}
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
                    <p className="text-[11px] text-[#6B7280] truncate">
                      {prog.level || '—'} &middot; {t('platformSettings.daysPerWeekShort', '{{n}} days/wk', { n: prog.days_per_week })} &middot; {prog.duration_weeks} {tp('weeks')} &middot; {prog.description || '—'}
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
                <p className="text-[12px] text-[#4B5563] text-center py-6">{tp('noProgramTemplates')}</p>
              )}
            </div>
          </>
        )}
      </CollapsibleSection>

      </>)}

      {/* ── Communications tab ── */}
      {settingsTab === 'comms' && (<>

      {/* ──────── 5. Platform Info ──────── */}
      <CollapsibleSection
        title={tp('platformInfo')}
        icon={<BarChart3 className="w-4 h-4 text-[#D4AF37]" />}
        open={infoOpen}
        toggle={() => setInfoOpen(!infoOpen)}
      >
        {loadingStats ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoCard label={tp('totalGyms')} value={platformStats.gyms} />
            <InfoCard label={tp('totalMembers')} value={platformStats.members} />
          </div>
        )}
      </CollapsibleSection>

      {/* ──────── 6. Email Configuration (informational) ────────
          The 3 template toggles were removed (P0-3): they wrote
          platform_config keys nothing reads. No fake "Active" badge —
          we don't probe the mail pipeline from here, so we only state
          the configured provider. */}
      <CollapsibleSection
        title={tp('emailConfig')}
        icon={<Mail className="w-4 h-4 text-[#D4AF37]" />}
        open={emailOpen}
        toggle={() => setEmailOpen(!emailOpen)}
      >
        <div className="bg-[#111827] border border-white/6 rounded-lg p-3 mb-3">
          <p className="text-[13px] font-medium text-[#E5E7EB] mb-0.5">{tp('emailService')}</p>
          <p className="text-[11px] text-[#6B7280]">{tp('emailServiceDesc')}</p>
        </div>
        <div className="bg-[#111827] border border-white/6 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-[#6B7280]">{tp('smtpProvider')}</p>
            <p className="text-[12px] text-[#E5E7EB] font-medium">{tp('supabaseBuiltIn')}</p>
          </div>
        </div>
      </CollapsibleSection>

      </>)}

      {/* ── System tab ── */}
      {settingsTab === 'system' && (<>

      {/* ──────── App Version Gate ──────── */}
      <CollapsibleSection
        title={tp('appVersionTitle')}
        icon={<Smartphone className="w-4 h-4 text-[#D4AF37]" />}
        open={versionOpen}
        toggle={() => setVersionOpen(!versionOpen)}
      >
        <div className="flex items-start gap-2 text-[11px] text-amber-300 mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
          <span>{tp('appVersionWarning')}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <Field label={tp('appVersionMinRequired')}>
            <input
              className={inputCls}
              type="text"
              placeholder="1.0.0"
              value={appVersion.min_required_version}
              onChange={(e) => setAppVersion(prev => ({ ...prev, min_required_version: e.target.value }))}
              disabled={!appVersionLoaded}
            />
          </Field>
          <Field label={tp('appVersionLatest')}>
            <input
              className={inputCls}
              type="text"
              placeholder="1.0.0"
              value={appVersion.latest_version}
              onChange={(e) => setAppVersion(prev => ({ ...prev, latest_version: e.target.value }))}
              disabled={!appVersionLoaded}
            />
          </Field>
          <Field label={tp('appVersionIosUrl')}>
            <input
              className={inputCls}
              type="url"
              placeholder="https://apps.apple.com/app/id…"
              value={appVersion.ios_store_url}
              onChange={(e) => setAppVersion(prev => ({ ...prev, ios_store_url: e.target.value }))}
              disabled={!appVersionLoaded}
            />
          </Field>
          <Field label={tp('appVersionAndroidUrl')}>
            <input
              className={inputCls}
              type="url"
              placeholder="https://play.google.com/store/apps/details?id=…"
              value={appVersion.android_store_url}
              onChange={(e) => setAppVersion(prev => ({ ...prev, android_store_url: e.target.value }))}
              disabled={!appVersionLoaded}
            />
          </Field>
        </div>

        {appVersionError && (
          <p className="text-[11px] text-red-400 mb-2">{appVersionError}</p>
        )}

        <div className="flex items-center justify-end gap-3">
          {appVersionSaved && (
            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {tp('saved')}
            </span>
          )}
          <button
            onClick={saveAppVersion}
            disabled={appVersionSaving || !appVersionLoaded}
            className="text-black disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5"
            style={{ background: '#D4AF37' }}
          >
            {appVersionSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {tp('appVersionSave')}
          </button>
        </div>
      </CollapsibleSection>

      {/* The duplicate feature-flag panel was removed (P0-3): it wrote
          feature_aiFoodScanner-style platform_config keys that NOTHING
          reads, while Operations' kill switches (feature_referrals…) are
          the real ones consumed by get_platform_flags (0547). One config
          surface, one truth. */}

      </>)}

      {/* ── Defaults tab ── */}
      {settingsTab === 'defaults' && (<>

      {/* ──────── 8. Default Gym Configuration ──────── */}
      <CollapsibleSection
        title={tp('defaultConfig')}
        icon={<Settings2 className="w-4 h-4 text-[#D4AF37]" />}
        open={defaultsOpen}
        toggle={() => setDefaultsOpen(!defaultsOpen)}
      >
        <p className="text-[11px] text-[#6B7280] mb-4">{tp('defaultConfigDesc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Field label={tp('dailyCalories')}>
            <input
              className={inputCls}
              type="number"
              min={1000}
              max={5000}
              value={gymDefaults.dailyCalories}
              onChange={(e) => setGymDefaults(prev => ({ ...prev, dailyCalories: Number(e.target.value) || 2200 }))}
            />
          </Field>
          <Field label={tp('trainingDays')}>
            <input
              className={inputCls}
              type="number"
              min={1}
              max={7}
              value={gymDefaults.trainingDays}
              onChange={(e) => setGymDefaults(prev => ({ ...prev, trainingDays: Number(e.target.value) || 4 }))}
            />
          </Field>
          <Field label={tp('defaultLanguage')}>
            <select
              className={inputCls}
              value={gymDefaults.defaultLanguage}
              onChange={(e) => setGymDefaults(prev => ({ ...prev, defaultLanguage: e.target.value }))}
            >
              <option value="en">English (EN)</option>
              <option value="es">Espanol (ES)</option>
            </select>
          </Field>
          <Field label={tp('defaultTheme')}>
            <select
              className={inputCls}
              value={gymDefaults.defaultTheme}
              onChange={(e) => setGymDefaults(prev => ({ ...prev, defaultTheme: e.target.value }))}
            >
              <option value="dark">{tp('dark')}</option>
              <option value="light">{tp('light')}</option>
            </select>
          </Field>
        </div>
        {defaultsError && (
          <p className="text-[11px] text-red-400 mb-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{defaultsError}</p>
        )}
        <div className="flex items-center justify-end gap-3">
          {defaultsSaved && (
            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {tp('saved')}
            </span>
          )}
          <button
            onClick={saveGymDefaults}
            className="text-black rounded-lg px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5"
            style={{ background: '#D4AF37' }}
          >
            <Save className="w-3.5 h-3.5" /> {tp('saveDefaults')}
          </button>
        </div>
      </CollapsibleSection>

      </>)}

      {/* ── Health tab ── */}
      {settingsTab === 'health' && (<>

      {/* ──────── 9. System Health ──────── */}
      <CollapsibleSection
        title={tp('systemHealth')}
        icon={<Activity className="w-4 h-4 text-[#D4AF37]" />}
        open={healthOpen}
        toggle={() => setHealthOpen(!healthOpen)}
      >
        {health.loadingHealth ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {/* Supabase connection */}
              <div className={`bg-[#111827] border rounded-lg px-3 py-3 ${health.supabase === true ? 'border-emerald-500/20' : health.supabase === false ? 'border-red-500/20' : 'border-white/6'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Database className="w-4 h-4 text-[#9CA3AF]" />
                  <p className="text-[12px] text-[#9CA3AF]">{tp('supabaseConnection')}</p>
                </div>
                <div className="flex items-center gap-1.5 ml-6">
                  {health.supabase === null ? (
                    <span className="text-[13px] text-[#6B7280]">{tp('checking')}</span>
                  ) : health.supabase ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[13px] text-emerald-400 font-medium">{tp('connected')}</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-[13px] text-red-400 font-medium">{tp('disconnected')}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Active users */}
              <div className="bg-[#111827] border border-white/6 rounded-lg px-3 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-[#9CA3AF]" />
                  <p className="text-[12px] text-[#9CA3AF]">{tp('activeUsers24h')}</p>
                </div>
                <p className="text-[13px] text-[#E5E7EB] font-medium ml-6">
                  {health.activeUsers !== null ? `${health.activeUsers} ${tp('users')}` : tp('checking')}
                </p>
              </div>
            </div>

            {/* Storage reachability — a real listBuckets probe. The old
                section here was a stale hardcoded edge-function list (15 of
                29, never probed) + invented bucket-name chips (one name was
                even wrong) — removed; Operations has the full probe set. */}
            <div className={`bg-[#111827] border rounded-lg px-3 py-3 mb-4 ${health.storageOk === true ? 'border-emerald-500/20' : health.storageOk === false ? 'border-red-500/20' : 'border-white/6'}`}>
              <div className="flex items-center gap-2 mb-1">
                <HardDrive className="w-4 h-4 text-[#9CA3AF]" />
                <p className="text-[12px] text-[#9CA3AF]">{t('platformSettings.storageProbe', 'Storage buckets')}</p>
              </div>
              <div className="flex items-center gap-1.5 ml-6">
                {health.storageOk === null ? (
                  <span className="text-[13px] text-[#6B7280]">{tp('checking')}</span>
                ) : health.storageOk ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-[13px] text-emerald-400 font-medium">
                      {t('platformSettings.storageReachable', '{{count}} buckets reachable', { count: health.bucketCount ?? 0 })}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[13px] text-red-400 font-medium">{tp('disconnected')}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={fetchHealth}
                className="text-[12px] text-[#D4AF37] hover:text-[#E6C766] flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> {tp('refreshHealth')}
              </button>
            </div>
          </>
        )}
      </CollapsibleSection>

      </>)}

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
          message={t('platformSettings.confirmDeleteMsg', { name: confirmDelete.label, defaultValue: `Delete "${confirmDelete.label}"? This action cannot be undone.` })}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
          cancelLabel={tp('cancel')}
          deleteLabel={tp('delete')}
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

const EXERCISE_CATEGORIES = ['Strength', 'Hypertrophy', 'Power', 'Endurance', 'Mobility'];

function ExerciseModal({ onClose, onSaved }) {
  const { t } = useTranslation('pages');
  const tp = (key) => t(`platformSettings.${key}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [form, setForm] = useState({
    name: '',
    muscle_group: '',
    equipment: 'Bodyweight',
    category: 'Strength',
    default_sets: 3,
    default_reps: '10',
    instructions: '',
  });

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.muscle_group || !form.equipment || !form.category) return;
    setSaving(true);
    setError('');

    let videoPath = null;
    if (videoFile) {
      const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
      const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
      if (videoFile.size > MAX_VIDEO_SIZE) {
        setError('Video must be under 100MB');
        setSaving(false);
        return;
      }
      if (!ALLOWED_VIDEO_TYPES.includes(videoFile.type)) {
        setError('Only MP4, WebM, and MOV videos are allowed');
        setSaving(false);
        return;
      }
      const extMap = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
      const ext = extMap[videoFile.type] || 'mp4';
      const path = `global/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('exercise-videos')
        .upload(path, videoFile, { contentType: videoFile.type });
      if (uploadError) {
        // Don't insert the exercise silently without the video the admin
        // attached — abort so they can retry or drop the file.
        setError(t('platformSettings.videoUploadFailed', 'Video upload failed: {{msg}}. The exercise was NOT saved — retry or remove the video.', { msg: uploadError.message }));
        setSaving(false);
        return;
      }
      videoPath = path;
    }

    const id = `global_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const { error: insertError } = await supabase.from('exercises').insert({
      id,
      gym_id: null,
      name: form.name.trim(),
      muscle_group: form.muscle_group,
      equipment: form.equipment,
      category: form.category,
      default_sets: Number(form.default_sets) || 3,
      default_reps: String(form.default_reps) || '10',
      instructions: form.instructions.trim() || null,
      video_url: videoPath,
      is_active: true,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
    } else {
      onSaved();
    }
  };

  return (
    <Modal title={tp('addGlobalExercise')} onClose={onClose}>
      <Field label={`${tp('nameLabel')} *`}>
        <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={tp('exerciseNamePlaceholder')} />
      </Field>
      <Field label={`${tp('muscleGroup')} *`}>
        <select className={inputCls} value={form.muscle_group} onChange={(e) => set('muscle_group', e.target.value)}>
          <option value="">{tp('select')}</option>
          {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${tp('equipment')} *`}>
          <select className={inputCls} value={form.equipment} onChange={(e) => set('equipment', e.target.value)}>
            {EQUIPMENT.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </Field>
        <Field label={`${tp('category')} *`}>
          <select className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
            {EXERCISE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tp('defaultSets')}>
          <input className={inputCls} type="number" min={1} value={form.default_sets} onChange={(e) => set('default_sets', e.target.value)} />
        </Field>
        <Field label={tp('defaultReps')}>
          <input className={inputCls} value={form.default_reps} onChange={(e) => set('default_reps', e.target.value)} placeholder={tp('repsPlaceholder')} />
        </Field>
      </div>
      <Field label={tp('instructions')}>
        <textarea className={`${inputCls} min-h-[80px] resize-none`} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder={tp('optionalCoachingCues')} />
      </Field>
      <Field label={tp('exerciseVideo')}>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setVideoFile(e.target.files[0] || null)}
          className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] file:mr-3 file:px-3 file:py-1 file:rounded-lg file:border-0 file:bg-[#D4AF37]/15 file:text-[#D4AF37] file:text-[12px] file:font-medium file:cursor-pointer outline-none"
        />
        {videoFile && <p className="text-[11px] text-[#6B7280] mt-1">{videoFile.name}</p>}
      </Field>
      {error && <p className="text-[12px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">{tp('cancel')}</button>
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim() || !form.muscle_group || !form.equipment || !form.category}
          className="text-black rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
          style={{ background: '#D4AF37' }}
        >
          {saving ? (videoFile ? tp('uploading') : tp('saving')) : tp('saveExercise')}
        </button>
      </div>
    </Modal>
  );
}

/* ───────────────── Achievement Modal ───────────────── */
// Writes the REAL achievement_definitions schema (0001): name + description
// + icon are NOT NULL, category is the achievement_category enum, criteria
// is optional JSONB. The old form wrote imagined type/requirement_value
// columns — every insert failed and the modal reported success anyway.

function AchievementModal({ onClose, onSaved }) {
  const { t } = useTranslation('pages');
  const tp = (key) => t(`platformSettings.${key}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    icon: '🏆',
    category: 'milestone',
    criteria: '',
  });

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const canSave = form.name.trim() && form.description.trim() && form.icon.trim() && form.category;

  const handleSave = async () => {
    if (!canSave) return;
    setError('');

    // criteria is optional, but if provided it must be valid JSON.
    let criteria = {};
    if (form.criteria.trim()) {
      try {
        criteria = JSON.parse(form.criteria);
      } catch {
        setError(t('platformSettings.criteriaInvalid', 'Criteria must be valid JSON (e.g. {"workouts": 50}).'));
        return;
      }
    }

    setSaving(true);
    const { error: insertError } = await supabase.from('achievement_definitions').insert({
      gym_id: null,
      name: form.name.trim(),
      description: form.description.trim(),
      icon: form.icon.trim(),
      category: form.category,
      criteria,
    });
    setSaving(false);
    if (insertError) {
      // Stay open so the admin can fix and retry — no fake success.
      setError(insertError.message);
      return;
    }
    onSaved();
  };

  return (
    <Modal title={tp('addGlobalAchievement')} onClose={onClose}>
      <Field label={`${tp('nameLabel')} *`}>
        <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={tp('achievementNamePlaceholder')} />
      </Field>
      <Field label={`${tp('description')} *`}>
        <textarea className={`${inputCls} min-h-[60px] resize-none`} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t('platformSettings.iconLabel', 'Icon (emoji)')} *`}>
          <input className={inputCls} value={form.icon} onChange={(e) => set('icon', e.target.value)} placeholder="🏆" maxLength={16} />
        </Field>
        <Field label={`${tp('category')} *`}>
          <select className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
            {ACHIEVEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('platformSettings.criteriaLabel', 'Criteria (JSON, optional)')}>
        <textarea
          className={`${inputCls} min-h-[60px] resize-none font-mono`}
          value={form.criteria}
          onChange={(e) => set('criteria', e.target.value)}
          placeholder='{"workouts": 50}'
        />
      </Field>
      {error && <p className="text-[12px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">{tp('cancel')}</button>
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="text-black rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
          style={{ background: '#D4AF37' }}
        >
          {saving ? tp('saving') : tp('saveAchievement')}
        </button>
      </div>
    </Modal>
  );
}

/* ───────────────── Program Template Modal ───────────────── */
// Writes the REAL program_templates columns (0001): `level` is the
// fitness_level enum (the old form wrote difficulty_level — a column that
// exists in zero migrations, so every insert failed silently), and
// days_per_week + duration_weeks are NOT NULL. created_by is nullable but
// sent for provenance. Writes work via the 0545 super_admin policy.

function ProgramModal({ onClose, onSaved }) {
  const { t } = useTranslation('pages');
  const tp = (key) => t(`platformSettings.${key}`);
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    level: 'beginner',
    days_per_week: 4,
    duration_weeks: 8,
  });

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const daysOk = Number(form.days_per_week) >= 1 && Number(form.days_per_week) <= 7;
  const weeksOk = Number(form.duration_weeks) >= 1;
  const canSave = form.name.trim() && daysOk && weeksOk;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const { error: insertError } = await supabase.from('program_templates').insert({
      gym_id: null,
      created_by: profile?.id ?? null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      level: form.level,
      days_per_week: Number(form.days_per_week),
      duration_weeks: Number(form.duration_weeks),
    });
    setSaving(false);
    if (insertError) {
      // Stay open so the admin can fix and retry — no fake success.
      setError(insertError.message);
      return;
    }
    onSaved();
  };

  return (
    <Modal title={tp('addGlobalTemplate')} onClose={onClose}>
      <Field label={`${tp('nameLabel')} *`}>
        <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={tp('templateNamePlaceholder')} />
      </Field>
      <Field label={tp('difficultyLevel')}>
        <select className={inputCls} value={form.level} onChange={(e) => set('level', e.target.value)}>
          {DIFFICULTY_LEVELS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t('platformSettings.daysPerWeek', 'Days per week')} *`}>
          <input className={inputCls} type="number" min={1} max={7} value={form.days_per_week} onChange={(e) => set('days_per_week', e.target.value)} />
        </Field>
        <Field label={`${tp('durationWeeks')} *`}>
          <input className={inputCls} type="number" min={1} max={52} value={form.duration_weeks} onChange={(e) => set('duration_weeks', e.target.value)} />
        </Field>
      </div>
      <Field label={tp('description')}>
        <textarea className={`${inputCls} min-h-[60px] resize-none`} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={tp('optionalProgramDescription')} />
      </Field>
      {error && <p className="text-[12px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-[12px] text-[#9CA3AF] hover:text-[#E5E7EB] rounded-lg">{tp('cancel')}</button>
        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className="text-black rounded-lg px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
          style={{ background: '#D4AF37' }}
        >
          {saving ? tp('saving') : tp('saveTemplate')}
        </button>
      </div>
    </Modal>
  );
}
