import { useState } from 'react';
import { Filter, Pencil, Star, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';
import { applySegmentFilters } from '../../../lib/admin/segmentFilters';
import { ICON_MAP, ICON_OPTIONS, COLOR_OPTIONS } from './segmentConstants';

/**
 * Inline label/control pair used inside SegmentEditorModal — a thin
 * grid wrapper so all filter rows line up on desktop and stack on mobile.
 */
function FilterRow({ label, children }) {
  return (
    <label className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 items-start">
      <span className="text-[12px] text-[#9CA3AF] font-medium pt-2 sm:text-right">{label}</span>
      <div>{children}</div>
    </label>
  );
}

/**
 * Create/edit modal for a member segment. The filter spec lives in
 * `filters` (a plain JSON object stored on `member_segments.filters`),
 * which `applySegmentFilters` translates into the actual DB query. The
 * "Preview Count" button is a sanity check that runs the same query the
 * segment list uses for counts — admins can iterate the filter spec
 * before committing.
 */
export default function SegmentEditorModal({ segment, gymId, adminId, onClose, onSaved }) {
  const { t } = useTranslation('pages');
  const isEditing = !!segment;

  const [name, setName] = useState(segment?.name || '');
  const [description, setDescription] = useState(segment?.description || '');
  const [color, setColor] = useState(segment?.color || 'var(--color-accent)');
  const [icon, setIcon] = useState(segment?.icon || 'users');
  const [filters, setFilters] = useState(segment?.filters || {});
  const [saving, setSaving] = useState(false);
  const [previewCount, setPreviewCount] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const updateFilter = (key, value) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
    setPreviewCount(null);
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const members = await applySegmentFilters(gymId, filters);
      setPreviewCount(members.length);
    } catch {
      setPreviewCount(0);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEditing) {
        await supabase.from('member_segments').update({
          name: name.trim(),
          description: description.trim() || null,
          color,
          icon,
          filters,
          updated_at: new Date().toISOString(),
        }).eq('id', segment.id).eq('gym_id', gymId);
      } else {
        await supabase.from('member_segments').insert({
          gym_id: gymId,
          name: name.trim(),
          description: description.trim() || null,
          color,
          icon,
          filters,
          created_by: adminId,
        });
      }
      onSaved();
    } catch (err) {
      logger.error('SegmentEditorModal save:', err);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full bg-white/[0.04] border border-white/8 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37]/30 transition-all';

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title={isEditing ? t('admin.segments.editSegment', 'Edit Segment') : t('admin.segments.createSegment', 'Create Segment')}
      titleIcon={Filter}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="flex-1 py-2.5 text-[13px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] bg-white/[0.04] hover:bg-white/[0.06] border border-white/6 rounded-lg transition-all">
            {t('admin.segments.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 py-2.5 text-[13px] font-bold text-[#05070B] bg-[#D4AF37] hover:bg-[#C5A028] rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? '...' : isEditing ? t('admin.segments.save', 'Save Changes') : t('admin.segments.create', 'Create Segment')}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Name + Description */}
        <div className="space-y-3">
          <SectionLabel icon={Pencil}>{t('admin.segments.details', 'Details')}</SectionLabel>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('admin.segments.namePlaceholder', 'Segment name...')}
            aria-label={t('admin.segments.namePlaceholder', 'Segment name')}
            className={inputClass}
            maxLength={80}
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('admin.segments.descPlaceholder', 'Optional description...')}
            aria-label={t('admin.segments.descPlaceholder', 'Optional description')}
            className={inputClass}
            maxLength={200}
          />
        </div>

        {/* Color + Icon */}
        <div className="space-y-3">
          <SectionLabel icon={Star}>{t('admin.segments.appearance', 'Appearance')}</SectionLabel>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-[11px] text-[#6B7280] mb-1.5">{t('admin.segments.color', 'Color')}</p>
              <div className="flex items-center gap-1.5">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-white/30 ring-offset-1 ring-offset-[#0F172A] scale-110' : 'hover:scale-105'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-[#6B7280] mb-1.5">{t('admin.segments.icon', 'Icon')}</p>
              <div className="flex items-center gap-1 flex-wrap">
                {ICON_OPTIONS.map(ic => {
                  const IC = ICON_MAP[ic];
                  return (
                    <button
                      key={ic}
                      onClick={() => setIcon(ic)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${icon === ic ? 'bg-white/10 text-[#E5E7EB]' : 'text-[#4B5563] hover:text-[#6B7280] hover:bg-white/[0.04]'}`}
                    >
                      <IC size={14} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-3">
          <SectionLabel icon={Filter}>{t('admin.segments.filters', 'Filters')}</SectionLabel>

          {/* Joined date range */}
          <FilterRow label={t('admin.segments.filterJoinedAfter', 'Joined after')}>
            <input
              type="date"
              value={filters.joined_after || ''}
              onChange={e => updateFilter('joined_after', e.target.value)}
              className={inputClass}
            />
          </FilterRow>
          <FilterRow label={t('admin.segments.filterJoinedBefore', 'Joined before')}>
            <input
              type="date"
              value={filters.joined_before || ''}
              onChange={e => updateFilter('joined_before', e.target.value)}
              className={inputClass}
            />
          </FilterRow>

          {/* Last workout */}
          <FilterRow label={t('admin.segments.filterLastWorkout', 'No workout in X+ days')}>
            <input
              type="number"
              min="1"
              value={filters.last_workout_days_ago_gt ?? ''}
              onChange={e => updateFilter('last_workout_days_ago_gt', e.target.value ? Number(e.target.value) : null)}
              placeholder="14"
              className={inputClass}
            />
          </FilterRow>

          {/* Total workouts */}
          <FilterRow label={t('admin.segments.filterWorkoutsLt', 'Total workouts less than')}>
            <input
              type="number"
              min="0"
              value={filters.workout_count_lt ?? ''}
              onChange={e => updateFilter('workout_count_lt', e.target.value ? Number(e.target.value) : null)}
              placeholder="5"
              className={inputClass}
            />
          </FilterRow>
          <FilterRow label={t('admin.segments.filterWorkoutsGt', 'Total workouts greater than')}>
            <input
              type="number"
              min="0"
              value={filters.workout_count_gt ?? ''}
              onChange={e => updateFilter('workout_count_gt', e.target.value ? Number(e.target.value) : null)}
              placeholder="10"
              className={inputClass}
            />
          </FilterRow>

          {/* Streak */}
          <FilterRow label={t('admin.segments.filterStreakLt', 'Streak less than')}>
            <input
              type="number"
              min="0"
              value={filters.streak_lt ?? ''}
              onChange={e => updateFilter('streak_lt', e.target.value ? Number(e.target.value) : null)}
              placeholder="3"
              className={inputClass}
            />
          </FilterRow>
          <FilterRow label={t('admin.segments.filterStreakGt', 'Streak greater than')}>
            <input
              type="number"
              min="0"
              value={filters.streak_gt ?? ''}
              onChange={e => updateFilter('streak_gt', e.target.value ? Number(e.target.value) : null)}
              placeholder="7"
              className={inputClass}
            />
          </FilterRow>

          {/* Churn tier */}
          <FilterRow label={t('admin.segments.filterChurnTier', 'Churn risk tier')}>
            <div className="flex flex-wrap gap-1.5">
              {['low', 'medium', 'high', 'critical'].map(tier => {
                const active = (filters.churn_tier || []).includes(tier);
                const tierColors = { low: 'var(--color-success)', medium: 'var(--color-warning)', high: 'var(--color-danger)', critical: 'var(--color-danger)' };
                return (
                  <button
                    key={tier}
                    onClick={() => {
                      const prev = filters.churn_tier || [];
                      updateFilter('churn_tier', active ? prev.filter(t => t !== tier) : [...prev, tier]);
                    }}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                      active
                        ? 'border-white/10 text-[#E5E7EB]'
                        : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF] hover:border-white/8'
                    }`}
                    style={active ? { background: `${tierColors[tier]}20`, borderColor: `${tierColors[tier]}40` } : {}}
                  >
                    {t(`admin.riskLabels.${tier}`, tier)}
                  </button>
                );
              })}
            </div>
          </FilterRow>

          {/* Fitness level */}
          <FilterRow label={t('admin.segments.filterFitnessLevel', 'Fitness level')}>
            <div className="flex flex-wrap gap-1.5">
              {['beginner', 'intermediate', 'advanced'].map(level => {
                const active = (filters.fitness_level || []).includes(level);
                return (
                  <button
                    key={level}
                    onClick={() => {
                      const prev = filters.fitness_level || [];
                      updateFilter('fitness_level', active ? prev.filter(l => l !== level) : [...prev, level]);
                    }}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                      active
                        ? 'bg-[#D4AF37]/15 border-[#D4AF37]/30 text-[#E5E7EB]'
                        : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF] hover:border-white/8'
                    }`}
                  >
                    {t(`admin.segments.fitnessLevels.${level}`, level)}
                  </button>
                );
              })}
            </div>
          </FilterRow>

          {/* Has referral */}
          <FilterRow label={t('admin.segments.filterReferral', 'Has made referral')}>
            <div className="flex items-center gap-2">
              {[
                { label: t('admin.segments.any', 'Any'), value: undefined },
                { label: t('admin.segments.yes', 'Yes'), value: true },
                { label: t('admin.segments.no', 'No'), value: false },
              ].map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => updateFilter('has_referral', opt.value)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                    filters.has_referral === opt.value
                      ? 'bg-[#D4AF37]/15 border-[#D4AF37]/30 text-[#E5E7EB]'
                      : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF] hover:border-white/8'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </FilterRow>
        </div>

        {/* Live preview */}
        <div className="flex items-center gap-3 pt-2 border-t border-white/6">
          <button
            onClick={handlePreview}
            disabled={previewLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-[#D4AF37] bg-[#D4AF37]/10 hover:bg-[#D4AF37]/18 rounded-lg transition-colors disabled:opacity-50"
          >
            <Eye size={13} />
            {previewLoading ? '...' : t('admin.segments.preview', 'Preview Count')}
          </button>
          {previewCount !== null && (
            <span className="text-[13px] font-bold text-[#E5E7EB]">
              {previewCount} {t('admin.segments.matchingMembers', 'matching members')}
            </span>
          )}
        </div>
      </div>
    </AdminModal>
  );
}
