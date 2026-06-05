import { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { adminKeys } from '../../lib/adminQueryKeys';
import { AdminPageShell, FadeIn, CardSkeleton } from '../../components/admin';
import AdminPagination from '../../components/admin/AdminPagination';
import {
  normalizeWeeks,
  calcDaySeconds,
  fmtTime,
  buildWeeksFromPattern,
  PROGRAM_TEMPLATES,
} from './components/programHelpers';
import { CLASS_COVERS } from './components/CoverPreview';
import { validateImageFile } from '../../lib/validateImage';
import TemplatesModal from './components/TemplatesModal';
import ProgramBuilderModal from './components/ProgramBuilderModal';
import ProgramSuggestionCard from './components/ProgramSuggestionCard';
import { TK, FK, TONE, Ico, ICON, Card, Avatar, PrimaryBtn } from './components/retosKit';


// ── local icon map (paths from the "Programas de entrenamiento" handoff) ──
const PRIC = {
  dumbbell: ICON.dumbbell,
  users: ICON.users,
  search: ICON.search,
  chevR: <path d="m9 18 6-6-6-6" />,
  chevD: ICON.chevD,
  trash: ICON.trash,
  fire: ICON.flame,
};

const PROGRAMS_PAGE_SIZE = 5;

// Extended gym_programs columns (migration 0513). Frontend stays resilient
// before the migration. Capability is detected from the list query (zero failed
// writes when we already know the columns are absent) with a write-time retry as
// a safety net. null = unknown, true = present, false = absent.
let gymProgramsExtended = null;
const PROGRAM_EXT_COLS = ['name_es', 'description_es', 'cover_preset', 'image_path'];
const stripProgramExt = (p) => { const c = { ...p }; PROGRAM_EXT_COLS.forEach(k => delete c[k]); return c; };
const isSchemaMiss = (err) => !!err && (err.code === 'PGRST204' || /could not find|does not exist|schema cache/i.test(err.message || ''));
// Map a program category to a sensible cover preset; random otherwise.
const pickCover = (category) => {
  const MAP = { hypertrophy: 'strength', strength: 'strength', general: 'functional', sport: 'functional', home: 'functional', advanced: 'strength', express: 'crossfit', cardio: 'cardio' };
  return MAP[category] || CLASS_COVERS[Math.floor(Math.random() * CLASS_COVERS.length)].key;
};

// ── stat card (colored left rail + big number + label + icon box) ──
function PrgStat({ value, label, rail, icon }) {
  return (
    <Card style={{ position: 'relative', overflow: 'hidden', padding: '20px 24px' }}>
      <span style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3.5, borderRadius: 99, background: rail }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div className="admin-kpi" style={{ fontFamily: FK.display, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.05, color: TK.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        {icon && (
          <span style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
            <Ico ch={icon} size={17} color={TK.textMute} stroke={2} />
          </span>
        )}
      </div>
      <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 10 }}>{label}</div>
    </Card>
  );
}

// ── square icon action button (chevron / trash) ──
function RowAction({ icon, onClick, ariaLabel, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0, cursor: 'pointer',
        display: 'grid', placeItems: 'center',
        background: TK.surface, border: `1px solid ${TK.borderSolid}`,
      }}
    >
      <Ico ch={icon} size={danger ? 15 : 16} color={danger ? 'var(--color-danger)' : TK.textSub} stroke={danger ? 2 : 2.2} />
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function AdminPrograms() {
  const { t, i18n } = useTranslation('pages');
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const isEs = i18n.language?.startsWith('es');

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [prefillProgram, setPrefillProgram] = useState(null);
  const [expandedEnroll, setExpandedEnroll] = useState(null);
  const [enrolledMembers, setEnrolledMembers] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [programSearch, setProgramSearch] = useState('');
  const [durationFilter, setDurationFilter] = useState('all');
  const [statusTab, setStatusTab] = useState('published');
  const [page, setPage] = useState(1);

  useEffect(() => { document.title = t('admin.programs.pageTitle', `Admin - Programs | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

  // ── Queries ──────────────────────────────────────────────

  const {
    data: programs = [],
    isLoading: loadingPrograms,
  } = useQuery({
    queryKey: adminKeys.programs(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_programs')
        .select('*')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Detect whether the 0513 columns exist, so writes never send them blindly.
      if (data && data.length) gymProgramsExtended = ('cover_preset' in data[0]) || ('name_es' in data[0]);
      return data || [];
    },
    enabled: !!gymId,
  });

  const {
    data: enrollments = [],
  } = useQuery({
    queryKey: [...adminKeys.programs(gymId), 'enrollments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_program_enrollments')
        .select('program_id')
        .eq('gym_id', gymId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Derived data ─────────────────────────────────────────

  const enrollmentCounts = {};
  enrollments.forEach(r => {
    enrollmentCounts[r.program_id] = (enrollmentCounts[r.program_id] || 0) + 1;
  });

  const programStats = (() => {
    const publishedCount = programs.filter(p => p.is_published).length;
    // gym_program_enrollments has no completion tracking yet — every enrollment counts as active.
    const activeCount = enrollments.length;
    const compRate = 0;

    let topName = '—';
    if (Object.keys(enrollmentCounts).length > 0) {
      const topId = Object.entries(enrollmentCounts).sort((a, b) => b[1] - a[1])[0][0];
      const topProg = programs.find(p => p.id === topId);
      topName = topProg?.name || '—';
    }

    return { totalPrograms: publishedCount, activeEnrollments: activeCount, completionRate: compRate, topProgram: topName };
  })();

  // ── Mutations ────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async ({ programId, payload, imageFile, imagePath }) => {
      const wantExt = gymProgramsExtended !== false;
      const body = { ...payload };
      if (wantExt) {
        // Resolve the cover photo (reuses the public, admin-writable class-images bucket).
        let finalPath = imagePath ?? null;
        if (imageFile) {
          const validation = await validateImageFile(imageFile);
          if (!validation.valid) throw new Error(validation.error);
          const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[validation.mime] || 'jpg';
          const path = `${gymId}/programs/${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from('class-images').upload(path, imageFile, { cacheControl: '3600', upsert: false });
          if (upErr) throw upErr;
          finalPath = path;
        }
        body.image_path = finalPath;
      }
      const run = (b) => programId
        ? supabase.from('gym_programs').update(b).eq('id', programId).eq('gym_id', gymId)
        : supabase.from('gym_programs').insert(b).select('id').single();
      // Send extended columns unless we've detected they're absent; on a schema
      // miss (unknown case, e.g. brand-new gym), drop them, remember, and retry.
      let res = await run(wantExt ? body : stripProgramExt(body));
      if (res.error && wantExt && isSchemaMiss(res.error)) {
        gymProgramsExtended = false;
        res = await run(stripProgramExt(body));
      }
      if (res.error) throw res.error;
      if (programId) logAdminAction('update_program', 'program', programId);
      else logAdminAction('create_program', 'program', res.data.id, { name: payload.name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.programs(gymId) });
      queryClient.invalidateQueries({ queryKey: ['program-suggestion', gymId] });
      setShowCreate(false);
      setPrefillProgram(null);
      setEditing(null);
      showToast(t('admin.programs.saved', { defaultValue: 'Program saved' }), 'success');
    },
    onError: (err) => {
      showToast(err?.message || t('admin.programs.saveFailed', { defaultValue: 'Could not save program' }), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('gym_programs').delete().eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction('delete_program', 'program', id);
    },
    onSuccess: () => {
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: adminKeys.programs(gymId) });
    },
  });

  // Quick publish / unpublish toggle from a program row.
  const togglePublishMutation = useMutation({
    mutationFn: async ({ id, next }) => {
      const { error } = await supabase.from('gym_programs').update({ is_published: next }).eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction(next ? 'publish_program' : 'unpublish_program', 'program', id);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: adminKeys.programs(gymId) }); },
    onError: (err) => { showToast(err?.message || t('admin.programs.saveFailed', { defaultValue: 'Could not save program' }), 'error'); },
  });

  // ── Handlers ─────────────────────────────────────────────

  const handleSaveProgram = ({ name, nameEs, description, descriptionEs, durationWeeks, weeks, coverPreset, imageFile, imagePath, isPublished }) => {
    // Validation
    if (!name?.trim()) {
      showToast(t('admin.programs.nameRequired', { defaultValue: 'Program name is required' }), 'error');
      return;
    }
    if (!durationWeeks || durationWeeks < 1 || durationWeeks > 52) {
      showToast(t('admin.programs.invalidDuration', { defaultValue: 'Duration must be 1–52 weeks' }), 'error');
      return;
    }
    const weekKeys = Object.keys(weeks || {});
    if (weekKeys.length === 0) {
      showToast(t('admin.programs.noWeeks', { defaultValue: 'Add at least one week of workouts' }), 'error');
      return;
    }
    let totalExercises = 0;
    let invalidExercise = false;
    for (const weekData of Object.values(weeks)) {
      const dayList = weekData?.days || weekData;
      if (!dayList) continue;
      for (const day of Object.values(dayList)) {
        const exercises = Array.isArray(day) ? day : (day?.exercises || []);
        for (const ex of exercises) {
          totalExercises++;
          const sets = Number(ex?.sets ?? ex?.target_sets);
          const rest = Number(ex?.rest_seconds ?? ex?.rest);
          if (!ex?.exercise_id && !ex?.id && !ex?.name) invalidExercise = true;
          if (Number.isFinite(sets) && (sets < 1 || sets > 20)) invalidExercise = true;
          if (Number.isFinite(rest) && (rest < 0 || rest > 600)) invalidExercise = true;
        }
      }
    }
    if (totalExercises === 0) {
      showToast(t('admin.programs.noExercises', { defaultValue: 'Add at least one exercise' }), 'error');
      return;
    }
    if (invalidExercise) {
      showToast(t('admin.programs.invalidExercise', { defaultValue: 'Sets must be 1–20, rest 0–600s' }), 'error');
      return;
    }

    const payload = {
      gym_id: gymId,
      created_by: user.id,
      name: name.trim(),
      name_es: nameEs?.trim() || null,
      description,
      description_es: descriptionEs?.trim() || null,
      duration_weeks: durationWeeks,
      weeks,
      cover_preset: coverPreset || pickCover(),
      is_published: isPublished ?? true,
    };
    saveMutation.mutate({
      programId: editing?.id || null,
      payload,
      imageFile,
      imagePath,
    });
  };

  // "Create This Program" on the monthly suggestion → create it immediately,
  // using the mapped template's structure but the suggestion's own name/desc.
  const handleSuggestionCreate = (suggestion) => {
    const tpl = suggestion?.template && PROGRAM_TEMPLATES.find(p => p.id === suggestion.template);
    if (!tpl) { setPrefillProgram(null); setShowTemplates(true); return; }
    const tEn = i18n.getFixedT('en', 'pages');
    const tEs = i18n.getFixedT('es', 'pages');
    const nameKey = `admin.programs.suggestion.${suggestion.nameKey}.name`;
    const descKey = `admin.programs.suggestion.${suggestion.descKey}.desc`;
    saveMutation.mutate({
      programId: null,
      payload: {
        gym_id: gymId,
        created_by: user.id,
        name: tEn(nameKey, suggestion.nameDefault),
        name_es: tEs(nameKey, suggestion.nameDefault),
        description: tEn(descKey, suggestion.descDefault),
        description_es: tEs(descKey, suggestion.descDefault),
        duration_weeks: tpl.durationWeeks,
        weeks: buildWeeksFromPattern(tpl.weekPattern, tpl.durationWeeks),
        cover_preset: pickCover(tpl.category),
        is_published: true,
      },
    });
  };

  const handleTemplateSelect = (template) => {
    // Manual templates carry a `weekPattern` → create the program immediately
    // (bilingual, EN + ES resolved from the template keys). The admin can edit
    // it afterward from the list. This is what "Use Template" implies.
    if (template.weekPattern && !template.weeks) {
      const tEn = i18n.getFixedT('en', 'pages');
      const tEs = i18n.getFixedT('es', 'pages');
      saveMutation.mutate({
        programId: null,
        payload: {
          gym_id: gymId,
          created_by: user.id,
          name: tEn(template.nameKey, template.name),
          name_es: tEs(template.nameKey, template.name),
          description: tEn(template.descKey, template.description),
          description_es: tEs(template.descKey, template.description),
          duration_weeks: template.durationWeeks,
          weeks: buildWeeksFromPattern(template.weekPattern, template.durationWeeks),
          cover_preset: pickCover(template.category),
          is_published: true,
        },
      });
      setShowTemplates(false);
      return;
    }
    // Auto-generated result (carries `weeks`) → open the builder prefilled so
    // the admin can remove/swap exercises, edit reps/sets, add supersets, etc.
    setPrefillProgram({
      name: template.name,
      description: template.description,
      duration_weeks: template.durationWeeks,
      weeks: template.weeks || buildWeeksFromPattern(template.weekPattern, template.durationWeeks),
      cover_preset: template.cover_preset || pickCover(template.category),
    });
    setShowTemplates(false);
  };

  const loadEnrolledMembers = async (programId) => {
    if (enrolledMembers[programId]) return;
    const { data } = await supabase
      .from('gym_program_enrollments')
      .select('profile_id, enrolled_at, profiles(full_name)')
      .eq('program_id', programId)
      .eq('gym_id', gymId)
      .order('enrolled_at', { ascending: true });
    setEnrolledMembers(prev => ({ ...prev, [programId]: data || [] }));
  };

  const toggleEnroll = (programId) => {
    if (expandedEnroll === programId) {
      setExpandedEnroll(null);
    } else {
      setExpandedEnroll(programId);
      loadEnrolledMembers(programId);
    }
  };

  // ── Filtered programs ────────────────────────────────────

  const filteredPrograms = useMemo(() => {
    let result = programs;
    // Status tab — published vs draft. `is_published` lives on gym_programs.
    if (statusTab === 'published') {
      result = result.filter(p => p.is_published === true);
    } else if (statusTab === 'draft') {
      result = result.filter(p => p.is_published !== true);
    }
    if (programSearch.trim()) {
      const q = programSearch.toLowerCase();
      result = result.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
      );
    }
    if (durationFilter !== 'all') {
      const weeks = parseInt(durationFilter);
      if (durationFilter === '12+') {
        result = result.filter(p => (p.duration_weeks || 0) >= 12);
      } else {
        result = result.filter(p => (p.duration_weeks || 0) <= weeks);
      }
    }
    return result;
  }, [programs, programSearch, durationFilter, statusTab]);

  const statusCounts = useMemo(() => ({
    published: programs.filter(p => p.is_published === true).length,
    draft: programs.filter(p => p.is_published !== true).length,
  }), [programs]);

  // Page of programs to render (1-based AdminPagination).
  const pagedPrograms = filteredPrograms.slice((page - 1) * PROGRAMS_PAGE_SIZE, page * PROGRAMS_PAGE_SIZE);

  // ── Render ───────────────────────────────────────────────

  const loading = loadingPrograms;

  const statusTabs = [
    { key: 'published', label: t('admin.programs.published', 'Published'), count: statusCounts.published },
    { key: 'draft', label: t('admin.programs.draft', 'Draft'), count: statusCounts.draft },
  ];

  const durationPills = [
    { key: 'all', label: t('admin.programs.durationAll', 'All') },
    { key: '4', label: t('admin.programs.durationShort', '1–4w') },
    { key: '8', label: t('admin.programs.durationMed', '5–8w') },
    { key: '12+', label: t('admin.programs.durationLong', '12w+') },
  ];

  return (
    <AdminPageShell>
      {/* header */}
      <div data-admin-tour="programs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.programs.title', 'Programs')}</h1>
          <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.programs.subtitle', 'Multi-week training plans members can enroll in')}</div>
        </div>
        <PrimaryBtn icon={ICON.plus} onClick={() => { setPrefillProgram(null); setShowTemplates(true); }}>{t('admin.programs.newProgram', 'New Program')}</PrimaryBtn>
      </div>

      {/* Program Suggestion (self-spaces with mb; renders null when none) */}
      <div style={{ marginTop: 22 }}>
        <ProgramSuggestionCard
          gymId={gymId}
          t={t}
          isEs={isEs}
          onCreateProgram={handleSuggestionCreate}
        />
      </div>

      {/* Program Analytics Summary */}
      {!loading && programs.length > 0 && (
        <FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <PrgStat value={programStats.totalPrograms} label={t('admin.programs.publishedPrograms', 'Published Programs')} rail={TK.accent} icon={PRIC.dumbbell} />
            <PrgStat value={programStats.activeEnrollments} label={t('admin.programs.activeEnrollments', 'Active Enrollments')} rail="var(--color-info)" icon={PRIC.users} />
            <PrgStat value={programStats.topProgram} label={t('admin.programs.mostPopular', 'Most Popular')} rail="var(--color-coach)" icon={PRIC.fire} />
          </div>
        </FadeIn>
      )}

      {/* Status tabs — separate Published from Draft */}
      {!loading && programs.length > 0 && (
        <div style={{ display: 'flex', gap: 30, margin: '24px 0 0', paddingLeft: 4 }}>
          {statusTabs.map(tb => {
            const on = statusTab === tb.key;
            return (
              <button key={tb.key} type="button" onClick={() => { setStatusTab(tb.key); setPage(1); }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer', paddingBottom: 6, position: 'relative', background: 'transparent', border: 'none' }}>
                <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: on ? TK.accent : TK.textMute }}>{tb.label}</span>
                <span style={{ minWidth: 24, padding: '2px 8px', borderRadius: 999, textAlign: 'center', fontFamily: FK.mono, fontSize: 12, fontWeight: 700, background: on ? TK.accentSoft : TK.surface2, color: on ? TK.accentInk : TK.textMute, border: `1px solid ${on ? TK.accentLine : TK.borderSolid}` }}>{tb.count}</span>
                {on && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2.5, borderRadius: 99, background: TK.accent }} />}
              </button>
            );
          })}
        </div>
      )}

      {/* Search and filters */}
      {!loading && programs.length > 0 && (
        <FadeIn delay={0.05}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
            {/* Search */}
            <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 11, padding: '12px 16px', borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow }}>
              <Ico ch={PRIC.search} size={17} color={TK.textMute} stroke={2} />
              <input
                type="text"
                placeholder={t('admin.programs.searchPlaceholder', 'Search programs…')}
                aria-label={t('admin.programs.searchPlaceholder', 'Search programs')}
                value={programSearch}
                onChange={e => { setProgramSearch(e.target.value); setPage(1); }}
                style={{ flex: 1, minWidth: 0, background: 'transparent', outline: 'none', border: 'none', fontFamily: FK.body, fontSize: 14.5, color: TK.text }}
              />
            </div>
            {/* Duration filter pills */}
            <div className="scrollbar-hide" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {durationPills.map(f => {
                const on = durationFilter === f.key;
                return (
                  <button key={f.key} type="button" onClick={() => { setDurationFilter(f.key); setPage(1); }}
                    style={{ flexShrink: 0, padding: '10px 16px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 12.5, fontWeight: on ? 700 : 600, letterSpacing: 0.4, textTransform: 'uppercase', color: on ? '#fff' : TK.textSub, background: on ? TK.text : TK.surface, border: `1px solid ${on ? TK.text : TK.borderSolid}` }}>
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </FadeIn>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
          <CardSkeleton h="h-[80px]" />
          <CardSkeleton h="h-[80px]" />
          <CardSkeleton h="h-[80px]" />
        </div>
      ) : programs.length === 0 ? (
        <FadeIn>
          <div style={{ textAlign: 'center', padding: '72px 20px' }}>
            <span style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: TK.surface2 }}>
              <Ico ch={PRIC.dumbbell} size={24} color={TK.textMute} stroke={1.8} />
            </span>
            <p style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text, margin: 0 }}>{t('admin.programs.noPrograms', 'No programs yet')}</p>
            <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, margin: '6px 0 18px' }}>{t('admin.programs.noProgramsHint', 'Create structured programs for your members to follow')}</p>
            <div style={{ display: 'inline-flex' }}>
              <PrimaryBtn icon={ICON.plus} onClick={() => { setPrefillProgram(null); setShowTemplates(true); }}>{t('admin.programs.createFirst', 'Create your first program')}</PrimaryBtn>
            </div>
          </div>
        </FadeIn>
      ) : (
        <FadeIn>
          {filteredPrograms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', marginTop: 16 }}>
              <Ico ch={PRIC.search} size={24} color={TK.textMute} stroke={1.8} style={{ margin: '0 auto 8px' }} />
              <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, margin: 0 }}>{t('admin.programs.noMatchingPrograms', 'No programs match your search')}</p>
            </div>
          ) : (
            <Card style={{ overflow: 'hidden', marginTop: 16 }}>
              {pagedPrograms.map((p, idx) => {
                const wks = normalizeWeeks(p.weeks);
                const allDays = Object.values(wks).flat();
                const totalDays = allDays.length;
                const totalEx   = allDays.reduce((s, d) => s + d.exercises.length, 0);
                const avgTime   = totalDays > 0
                  ? Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / totalDays)
                  : 0;
                const isLast = idx === pagedPrograms.length - 1;
                const isOpen = expandedEnroll === p.id;
                return (
                  <div key={p.id} style={{ borderBottom: isLast ? 'none' : `1px solid ${TK.divider}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '18px 22px' }}>
                      {/* dumbbell icon tile */}
                      <span style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: TONE.coach.bg }}>
                        <Ico ch={PRIC.dumbbell} size={21} color={TONE.coach.fg} stroke={1.9} />
                      </span>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* title + weeks badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: FK.display, fontSize: 17, fontWeight: 800, color: TK.text, letterSpacing: -0.3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                          <span style={{ padding: '2px 9px', borderRadius: 7, background: TK.surface2, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.mono, fontSize: 11.5, fontWeight: 700, color: TK.textMute }}>
                            {p.duration_weeks}{t('admin.programs.weeksShort', 'w')}
                          </span>
                        </div>
                        {/* mono meta line */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, fontFamily: FK.mono, fontSize: 12.5, color: TK.textFaint, flexWrap: 'wrap' }}>
                          <span>{totalDays} {t('admin.programs.days', 'days')}</span><span>·</span>
                          <span>{totalEx} {t('admin.programs.exercises', 'exercises')}</span>
                          {avgTime > 0 && <><span>·</span><span>~{fmtTime(avgTime)}/{t('admin.programs.session', 'session')}</span></>}
                        </div>
                        {/* description */}
                        {p.description && (
                          <p className="line-clamp-2" style={{ margin: '10px 0 0', fontFamily: FK.body, fontSize: 14, color: TK.textMute, lineHeight: 1.5, maxWidth: 600 }}>{p.description}</p>
                        )}
                        {/* enrolled expander */}
                        <button
                          type="button"
                          onClick={() => toggleEnroll(p.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 11, fontFamily: FK.body, fontSize: 13, fontWeight: 600, color: TK.textSub, cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }}
                        >
                          <Ico ch={PRIC.users} size={14} color={TK.textMute} stroke={2} />
                          <span>{enrollmentCounts[p.id] ?? 0} {t('admin.programs.enrolled', 'enrolled')}</span>
                          <Ico ch={PRIC.chevD} size={13} color={TK.textFaint} stroke={2.2} style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                        </button>
                      </div>

                      {/* status pill + actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => togglePublishMutation.mutate({ id: p.id, next: !p.is_published })}
                          title={p.is_published ? t('admin.programs.unpublishHint', 'Click to unpublish — hide from members') : t('admin.programs.publishHint', 'Click to publish — show to members')}
                          className="transition-opacity hover:opacity-75"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
                            fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
                            background: p.is_published ? TONE.good.bg : TK.surface, color: p.is_published ? TONE.good.ink : TK.textSub,
                            border: `1px solid ${p.is_published ? TONE.good.line : TK.borderSolid}`,
                          }}
                        >
                          {p.is_published && <span style={{ width: 6, height: 6, borderRadius: 99, background: TONE.good.fg }} />}
                          {p.is_published ? t('admin.programs.published', 'Published') : t('admin.programs.draft', 'Draft')}
                        </button>

                        <RowAction icon={PRIC.chevR} onClick={() => setEditing(p)} ariaLabel={t('admin.programs.editProgram', 'Edit program')} />
                        {confirmDeleteId === p.id ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => deleteMutation.mutate(p.id)}
                              style={{ padding: '6px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, color: 'var(--color-danger)', background: 'var(--color-danger-soft)' }}
                            >
                              {t('admin.programs.confirm')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              style={{ padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 11.5, fontWeight: 700, color: TK.textSub, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}
                            >
                              {t('admin.programs.cancel')}
                            </button>
                          </span>
                        ) : (
                          <RowAction icon={PRIC.trash} danger onClick={() => setConfirmDeleteId(p.id)} ariaLabel={t('admin.programs.deleteProgram', 'Delete program')} />
                        )}
                      </div>
                    </div>

                    {/* Enrolled members panel */}
                    {isOpen && (
                      <div style={{ padding: '14px 22px 18px', borderTop: `1px solid ${TK.divider}` }}>
                        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textMute, marginBottom: 12 }}>
                          {t('admin.programs.enrolledMembers', 'Enrolled Members')}
                        </div>
                        {!enrolledMembers[p.id] ? (
                          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
                            <span className="animate-spin" style={{ width: 16, height: 16, borderRadius: 99, border: `2px solid ${TK.borderSolid}`, borderTopColor: TK.accent, display: 'inline-block' }} />
                          </div>
                        ) : enrolledMembers[p.id].length === 0 ? (
                          <p style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textFaint, textAlign: 'center', padding: '8px 0', margin: 0 }}>{t('admin.programs.noEnrolled', 'No members enrolled yet')}</p>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            {enrolledMembers[p.id].map((e, i) => {
                              const name = e.profiles?.full_name ?? '?';
                              const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                              return (
                                <div key={e.profile_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '7px 14px 7px 7px', borderRadius: 999, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                                  <Avatar initials={initials} hue={i} size={26} />
                                  <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 600, color: TK.text }}>{name}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ padding: '0 22px 14px' }}>
                <AdminPagination
                  page={page}
                  pageSize={PROGRAMS_PAGE_SIZE}
                  total={filteredPrograms.length}
                  onPageChange={setPage}
                />
              </div>
            </Card>
          )}
        </FadeIn>
      )}

      {showTemplates && (
        <TemplatesModal
          onClose={() => setShowTemplates(false)}
          onSelect={handleTemplateSelect}
          onStartFromScratch={() => { setShowTemplates(false); setShowCreate(true); }}
        />
      )}
      {(showCreate || prefillProgram) && !editing && (
        <ProgramBuilderModal
          initialData={prefillProgram}
          onClose={() => { setShowCreate(false); setPrefillProgram(null); saveMutation.reset(); }}
          onSave={handleSaveProgram}
          saving={saveMutation.isPending}
          saveError={saveMutation.error?.message || ''}
        />
      )}
      {editing && (
        <ProgramBuilderModal
          program={editing}
          onClose={() => { setEditing(null); saveMutation.reset(); }}
          onSave={handleSaveProgram}
          saving={saveMutation.isPending}
          saveError={saveMutation.error?.message || ''}
        />
      )}
    </AdminPageShell>
  );
}
