import { useState } from 'react';
import posthogClient from 'posthog-js';
import { Filter, Pencil, Star, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';
import { applySegmentFilters } from '../../../lib/admin/segmentFilters';
import { ICON_MAP, ICON_OPTIONS, COLOR_OPTIONS } from './segmentConstants';

// Token-styled input (cream-theme aware). Pure Tailwind arbitrary-value
// classes — no inline style — so the focus-border class isn't outranked.
const inputClass =
  'w-full rounded-[10px] px-3 py-2 text-[13px] outline-none transition-colors ' +
  'bg-[var(--color-bg-input)] text-[var(--color-admin-text)] ' +
  'border border-[var(--color-admin-border)] focus:border-[var(--color-accent)] ' +
  'placeholder:text-[var(--color-admin-text-faint)]';

/**
 * Inline label/control pair used inside SegmentEditorModal — a thin
 * grid wrapper so all filter rows line up on desktop and stack on mobile.
 */
function FilterRow({ label, children }) {
  return (
    <label className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 items-start">
      <span className="pt-2 sm:text-right" style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-admin-text-sub)' }}>{label}</span>
      <div>{children}</div>
    </label>
  );
}

/**
 * Soft-filled toggle pill — matches the risk-pill language used across the
 * redesigned Segmentos page (soft tint + colored text when active).
 */
function ChoicePill({ active, color = 'var(--color-accent)', onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="transition-colors"
      style={{
        padding: '5px 11px', fontSize: 11, fontWeight: 700, borderRadius: 999, cursor: 'pointer',
        background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--color-bg-subtle)',
        color: active ? color : 'var(--color-admin-text-sub)',
        border: `1px solid ${active ? `color-mix(in srgb, ${color} 45%, transparent)` : 'var(--color-admin-border)'}`,
      }}
    >
      {children}
    </button>
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
        posthogClient?.capture('admin_segment_created');
      }
      onSaved();
    } catch (err) {
      logger.error('SegmentEditorModal save:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title={isEditing ? t('admin.segments.editSegment', 'Edit Segment') : t('admin.segments.createSegment', 'Create Segment')}
      titleIcon={Filter}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-[13px] font-medium rounded-lg transition-colors text-[var(--color-admin-text-sub)] border border-[var(--color-admin-border)]"
            style={{ background: 'var(--color-bg-subtle)' }}
          >
            {t('admin.segments.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 py-2.5 text-[13px] font-bold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 text-[var(--color-text-on-accent)]"
            style={{ background: 'var(--color-accent)' }}
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
              <p className="mb-1.5" style={{ fontSize: 11, color: 'var(--color-admin-text-muted)' }}>{t('admin.segments.color', 'Color')}</p>
              <div className="flex items-center gap-1.5">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={c}
                    className="w-6 h-6 rounded-full transition-transform"
                    style={{
                      background: c,
                      transform: color === c ? 'scale(1.12)' : 'scale(1)',
                      boxShadow: color === c
                        ? `0 0 0 2px var(--color-admin-panel), 0 0 0 4px color-mix(in srgb, ${c} 60%, transparent)`
                        : 'none',
                    }}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5" style={{ fontSize: 11, color: 'var(--color-admin-text-muted)' }}>{t('admin.segments.icon', 'Icon')}</p>
              <div className="flex items-center gap-1 flex-wrap">
                {ICON_OPTIONS.map(ic => {
                  const IC = ICON_MAP[ic];
                  const isSel = icon === ic;
                  return (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setIcon(ic)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                      style={{
                        background: isSel ? 'var(--color-accent-soft)' : 'transparent',
                        color: isSel ? 'var(--color-accent-dark, var(--color-accent))' : 'var(--color-admin-text-faint)',
                      }}
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
            <div className="flex flex-wrap gap-2">
              {['low', 'medium', 'high', 'critical'].map(tier => {
                const active = (filters.churn_tier || []).includes(tier);
                const tierColors = { low: 'var(--color-success)', medium: 'var(--color-warning)', high: 'var(--color-danger)', critical: 'var(--color-danger)' };
                return (
                  <ChoicePill
                    key={tier}
                    active={active}
                    color={tierColors[tier]}
                    onClick={() => {
                      const prev = filters.churn_tier || [];
                      updateFilter('churn_tier', active ? prev.filter(x => x !== tier) : [...prev, tier]);
                    }}
                  >
                    {t(`admin.riskLabels.${tier}`, tier)}
                  </ChoicePill>
                );
              })}
            </div>
          </FilterRow>

          {/* Fitness level */}
          <FilterRow label={t('admin.segments.filterFitnessLevel', 'Fitness level')}>
            <div className="flex flex-wrap gap-2">
              {['beginner', 'intermediate', 'advanced'].map(level => {
                const active = (filters.fitness_level || []).includes(level);
                return (
                  <ChoicePill
                    key={level}
                    active={active}
                    onClick={() => {
                      const prev = filters.fitness_level || [];
                      updateFilter('fitness_level', active ? prev.filter(l => l !== level) : [...prev, level]);
                    }}
                  >
                    {t(`admin.segments.fitnessLevels.${level}`, level)}
                  </ChoicePill>
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
                <ChoicePill
                  key={String(opt.value)}
                  active={filters.has_referral === opt.value}
                  onClick={() => updateFilter('has_referral', opt.value)}
                >
                  {opt.label}
                </ChoicePill>
              ))}
            </div>
          </FilterRow>
        </div>

        {/* Live preview */}
        <div className="flex items-center gap-3 pt-3" style={{ borderTop: '1px solid var(--color-admin-border)' }}>
          <button
            onClick={handlePreview}
            disabled={previewLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent-dark, var(--color-accent))' }}
          >
            <Eye size={13} />
            {previewLoading ? '...' : t('admin.segments.preview', 'Preview Count')}
          </button>
          {previewCount !== null && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-admin-text)' }}>
              {previewCount} {t('admin.segments.matchingMembers', 'matching members')}
            </span>
          )}
        </div>
      </div>
    </AdminModal>
  );
}
