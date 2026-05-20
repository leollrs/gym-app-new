import { useState, useCallback, useMemo } from 'react';
import {
  Download, Clock, FileSpreadsheet, CalendarRange, Timer, Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  PageHeader, FadeIn, AdminPageShell, SectionLabel,
} from '../../components/admin';
import {
  RANGE_PRESETS, EXPORT_DEFS, EXPORT_FNS,
  getExportHistory, addExportHistory, clearExportHistory,
  getDateRange,
} from '../../lib/admin/reportExports';


// ── Tone → CSS var mapping ─────────────────────────────────
const TONE_VARS = {
  teal:  { bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',  fg: 'var(--color-accent)' },
  coach: { bg: 'var(--color-coach-soft)',   fg: 'var(--color-coach)' },
  warn:  { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning)' },
  hot:   { bg: 'var(--color-danger-soft)',  fg: 'var(--color-danger)' },
  good:  { bg: 'var(--color-success-soft)', fg: 'var(--color-success)' },
  info:  { bg: 'var(--color-info-soft)',    fg: 'var(--color-info)' },
};

// Assign a tone per export key (matches reference palette)
const EXPORT_TONE = {
  members: 'teal',
  workouts: 'coach',
  prs: 'warn',
  attendance: 'teal',
  body_metrics: 'hot',
  challenges: 'coach',
  purchases: 'good',
  class_bookings: 'warn',
};

// ── Report Card ─────────────────────────────────────────────
function ReportCard({ def, exporting, onExport, t, delay }) {
  const { key, icon: Icon, labelKey, descKey } = def;
  const isActive = exporting === key;
  const tone = TONE_VARS[EXPORT_TONE[key] || 'teal'];

  return (
    <FadeIn delay={delay}>
      <div className="admin-card flex flex-col h-full" style={{ padding: 16 }}>
        <div className="flex items-start gap-2.5 mb-2.5">
          <div
            className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0"
            style={{ background: tone.bg }}
          >
            <Icon size={15} style={{ color: tone.fg }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-extrabold leading-tight" style={{ color: 'var(--color-admin-text)', fontFamily: 'Archivo, sans-serif' }}>
              {t(labelKey)}
            </p>
            <p className="text-[11px] mt-[3px] leading-[1.4]" style={{ color: 'var(--color-admin-text-muted)' }}>
              {t(descKey)}
            </p>
          </div>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => onExport(key)}
          disabled={!!exporting}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[10px] text-[12px] font-bold transition-all mt-2 disabled:opacity-50"
          style={{
            background: isActive
              ? 'color-mix(in srgb, var(--color-accent) 22%, transparent)'
              : 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
            color: 'var(--color-accent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
            cursor: isActive ? 'wait' : exporting ? 'not-allowed' : 'pointer',
          }}
        >
          {isActive ? (
            <>
              <div className="w-3.5 h-3.5 rounded-full animate-spin" style={{ border: '2px solid color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
              {t('admin.reports.exporting')}
            </>
          ) : (
            <>
              <Download size={14} />
              {t('admin.reports.exportCSV')}
            </>
          )}
        </button>
      </div>
    </FadeIn>
  );
}

// ── Component ────────────────────────────────────────────────
export default function AdminReports() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const gymId = profile?.gym_id;

  const [rangeKey, setRangeKey] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exporting, setExporting] = useState(null);
  const [history, setHistory] = useState(() => getExportHistory());

  const refreshHistory = useCallback(() => setHistory(getExportHistory()), []);

  const handleExport = useCallback(async (key) => {
    if (!gymId || exporting) return;
    if (rangeKey === 'custom' && (!customFrom || !customTo)) {
      showToast(t('admin.reports.pickBothDates', { defaultValue: 'Pick both start and end dates.' }), 'error');
      return;
    }
    // Sanity-check the custom range: from must be on/before to.
    if (rangeKey === 'custom' && customFrom && customTo && new Date(customFrom) > new Date(customTo)) {
      showToast(t('admin.reports.invalidDateRange', { defaultValue: 'Start date must be on or before end date.' }), 'error');
      return;
    }
    setExporting(key);
    try {
      const { from, to } = getDateRange(rangeKey, customFrom ? new Date(customFrom).toISOString() : null, customTo ? new Date(customTo).toISOString() : null);
      const exportFn = EXPORT_FNS[key];
      const result = await exportFn(gymId, from, to, t, i18n.language);

      const entry = {
        key,
        filename: result.filename,
        rows: result.rows,
        range: rangeKey,
        exportedAt: new Date().toISOString(),
      };
      addExportHistory(entry);
      refreshHistory();
      showToast(t('admin.reports.exportSuccess', { filename: result.filename, count: result.rows }), 'success');
    } catch (err) {
      console.error('Export failed:', err);
      showToast(t('admin.reports.exportError'), 'error');
    } finally {
      setExporting(null);
    }
  }, [gymId, exporting, rangeKey, customFrom, customTo, showToast, t, refreshHistory]);

  const handleClearHistory = useCallback(() => {
    clearExportHistory();
    refreshHistory();
  }, [refreshHistory]);

  return (
    <AdminPageShell size="narrow">
      {/* ── Header ─────────────────────────────────────────── */}
      <FadeIn>
        <PageHeader
          title={t('admin.reports.title')}
          subtitle={t('admin.reports.subtitle')}
        />
      </FadeIn>

      <div className="mt-6">
        {/* ── Global Date Range ─────────────────────────────── */}
        <FadeIn delay={0.05}>
          <div className="admin-card mb-[18px]" style={{ padding: 16 }}>
            <div className="flex items-center gap-2 mb-3">
              <CalendarRange size={14} style={{ color: 'var(--color-admin-text-muted)' }} />
              <span className="admin-eyebrow">{t('admin.reports.dateRange')}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:flex-wrap">
              {RANGE_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  onClick={() => setRangeKey(preset.key)}
                  className={`admin-pill flex-shrink-0 ${rangeKey === preset.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
                  style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
            {rangeKey === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 max-w-md">
                <div className="flex flex-col gap-1">
                  <label className="admin-eyebrow">{t('admin.reports.from')}</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="w-full rounded-lg px-3 py-1.5 text-[13px]"
                    style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="admin-eyebrow">{t('admin.reports.to')}</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="w-full rounded-lg px-3 py-1.5 text-[13px]"
                    style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                  />
                </div>
              </div>
            )}
          </div>
        </FadeIn>

        {/* ── Quick Exports grid ────────────────────────────── */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2.5">
            <FileSpreadsheet size={13} style={{ color: 'var(--color-admin-text-muted)' }} />
            <span className="admin-eyebrow">{t('admin.reports.quickExports')}</span>
          </div>

          {/* Muted banner: scheduled exports coming soon (replaces the old stub section) */}
          <div
            className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{
              background: 'var(--color-admin-panel)',
              border: '1px solid var(--color-admin-border)',
              color: 'var(--color-admin-text-muted)',
              fontSize: 12,
            }}
          >
            <Timer size={13} />
            <span>{t('admin.reports.scheduledSoon', 'Scheduled exports coming soon — for now, run exports manually.')}</span>
          </div>

          {(() => {
            // Group cards into Members / Activity / Commerce
            const groupMap = {
              members: ['members', 'body_metrics'],
              activity: ['workouts', 'prs', 'attendance', 'challenges', 'class_bookings'],
              commerce: ['purchases'],
            };
            const groupLabels = {
              members: t('admin.reports.groupMembers', 'Members'),
              activity: t('admin.reports.groupActivity', 'Activity'),
              commerce: t('admin.reports.groupCommerce', 'Commerce'),
            };
            const groups = ['members', 'activity', 'commerce'];
            let cardIdx = 0;
            return groups.map((g) => {
              const defs = groupMap[g]
                .map(k => EXPORT_DEFS.find(d => d.key === k))
                .filter(Boolean);
              if (defs.length === 0) return null;
              return (
                <div key={g} className="mb-4">
                  <SectionLabel className="mb-2">{groupLabels[g]}</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-3">
                    {defs.map((def) => {
                      const delay = 0.08 + (cardIdx++) * 0.03;
                      return (
                        <ReportCard
                          key={def.key}
                          def={def}
                          exporting={exporting}
                          onExport={handleExport}
                          t={t}
                          delay={delay}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* ── Export History (full width) ─────────────────── */}
        <FadeIn delay={0.2}>
          <div className="admin-card" style={{ padding: 20 }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[13px] font-extrabold" style={{ color: 'var(--color-admin-text)', fontFamily: 'Archivo, sans-serif' }}>{t('admin.reports.exportHistory')}</p>
                <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                  {history.length === 0 ? t('admin.reports.noHistory') : `${history.length}`}
                </p>
              </div>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="flex items-center gap-1 text-[11px] transition-colors"
                  style={{ color: 'var(--color-admin-text-muted)' }}
                >
                  <Trash2 size={12} />
                  {t('admin.reports.clearHistory')}
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="text-center" style={{ padding: '28px 0', color: 'var(--color-admin-text-muted)', fontSize: 12.5 }}>
                <div
                  className="flex items-center justify-center mx-auto mb-2.5"
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--color-admin-panel)' }}
                >
                  <Clock size={18} style={{ color: 'var(--color-admin-text-muted)' }} />
                </div>
                {t('admin.reports.noHistory')}
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
                {history.map((entry, idx) => {
                  const def = EXPORT_DEFS.find(d => d.key === entry.key);
                  const EntryIcon = def?.icon || FileSpreadsheet;
                  return (
                    <div key={idx} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-admin-panel)' }}>
                        <EntryIcon size={14} style={{ color: 'var(--color-admin-text-sub)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{entry.filename}</p>
                        <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                          {entry.rows} {t('admin.reports.rows')} &middot; {new Date(entry.exportedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </FadeIn>
      </div>
    </AdminPageShell>
  );
}
