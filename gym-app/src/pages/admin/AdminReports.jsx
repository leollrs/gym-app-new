import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { AdminPageShell, FadeIn } from '../../components/admin';
import {
  RANGE_PRESETS, EXPORT_DEFS, EXPORT_FNS, HISTORY_PAGE_SIZE,
  getExportHistory, addExportHistory, clearExportHistory,
  getDateRange,
} from '../../lib/admin/reportExports';
import { TK, FK, TONE, Ico, Card } from './components/retosKit';

// page-local icon paths (from the Reportes design)
const RIC = {
  users: <><path d="M16 19a4 4 0 0 0-8 0M12 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 12 11Z" /><path d="M21 18a3.2 3.2 0 0 0-4-3M7 15a3.2 3.2 0 0 0-4 3" /></>,
  scale: <><path d="M12 3v17M6 20h12M4 7l4-2 4 2 4-2 4 2M8 5l-4 8a3 3 0 0 0 8 0L8 5ZM16 5l4 8a3 3 0 0 1-8 0l4-8Z" /></>,
  dumbbell: <><path d="M6.5 6.5 17.5 17.5M3 7v10M21 7v10M6 4v16M18 4v16M2 12h2M20 12h2" /></>,
  trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" /><path d="M9.5 14.5 9 18h6l-.5-3.5M8 21h8M12 18v3" /></>,
  calCheck: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4M8.5 15l2 2 3.5-3.5" /></>,
  swords: <><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l3 3 1.5-1.5M16 16l3-3M21 21l-1.5-1.5" /><path d="M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-3 3-1.5-1.5M8 16l-3-3M3 21l1.5-1.5" /></>,
  cal: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
  bag: <><path d="M6 7V6a3 3 0 0 1 6 0v1m-9 0h12l1 13H4L5 7Z" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 20h16" /></>,
  doc: <><path d="M6 2h8l4 4v16H6V2Z" /><path d="M14 2v4h4M9 13h6M9 17h6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></>,
  chevL: <path d="M15 6l-6 6 6 6" />,
  chevR: <path d="M9 6l6 6-6 6" />,
};

// export key → tone + icon (matches the design)
const KEY_TONE = { members: 'accent', body_metrics: 'hot', workouts: 'coach', prs: 'warn', attendance: 'accent', challenges: 'coach', class_bookings: 'warn', purchases: 'info' };
const KEY_ICON = { members: RIC.users, body_metrics: RIC.scale, workouts: RIC.dumbbell, prs: RIC.trophy, attendance: RIC.calCheck, challenges: RIC.swords, class_bookings: RIC.cal, purchases: RIC.bag };

const RpGroup = ({ children }) => (
  <div style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: TK.textFaint, margin: '28px 0 14px' }}>{children}</div>
);

function ExportCard({ def, exporting, onExport, t }) {
  const key = def.key;
  const isActive = exporting === key;
  const c = TONE[KEY_TONE[key] || 'accent'] || TONE.accent;
  const blocked = !!exporting && !isActive;
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', padding: '18px 18px 16px', height: '100%' }}>
      <div style={{ display: 'flex', gap: 13 }}>
        <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: c.bg, border: `1px solid ${c.line}` }}>
          <Ico ch={KEY_ICON[key] || RIC.doc} size={20} color={c.ink} stroke={1.9} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 16.5, fontWeight: 800, color: TK.text, letterSpacing: -0.3 }}>{t(def.labelKey)}</div>
          <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 5, lineHeight: 1.45 }}>{t(def.descKey)}</div>
        </div>
      </div>
      <button type="button" onClick={() => onExport(key)} disabled={!!exporting}
        style={{ marginTop: 16, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '11px 0', borderRadius: 11, cursor: isActive ? 'wait' : blocked ? 'not-allowed' : 'pointer', background: TK.accentWash, border: `1px solid ${TK.accentLine}`, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.accent, opacity: blocked ? 0.5 : 1 }}>
        {isActive ? (
          <><span className="animate-spin" style={{ width: 14, height: 14, borderRadius: 99, border: `2px solid ${TK.accentLine}`, borderTopColor: TK.accent, display: 'inline-block' }} />{t('admin.reports.exporting')}</>
        ) : (
          <><Ico ch={RIC.download} size={15} color={TK.accent} stroke={2.1} />{t('admin.reports.exportCSV')}</>
        )}
      </button>
    </Card>
  );
}

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
  const [histPage, setHistPage] = useState(0);

  const refreshHistory = useCallback(() => { setHistory(getExportHistory()); setHistPage(0); }, []);

  const handleExport = useCallback(async (key) => {
    if (!gymId || exporting) return;
    if (rangeKey === 'custom' && (!customFrom || !customTo)) {
      showToast(t('admin.reports.pickBothDates', { defaultValue: 'Pick both start and end dates.' }), 'error');
      return;
    }
    if (rangeKey === 'custom' && customFrom && customTo && new Date(customFrom) > new Date(customTo)) {
      showToast(t('admin.reports.invalidDateRange', { defaultValue: 'Start date must be on or before end date.' }), 'error');
      return;
    }
    setExporting(key);
    try {
      const { from, to } = getDateRange(rangeKey, customFrom ? new Date(customFrom).toISOString() : null, customTo ? new Date(customTo).toISOString() : null);
      const exportFn = EXPORT_FNS[key];
      const result = await exportFn(gymId, from, to, t, i18n.language);
      const entry = { key, filename: result.filename, rows: result.rows, range: rangeKey, exportedAt: new Date().toISOString() };
      addExportHistory(entry);
      refreshHistory();
      const def = EXPORT_DEFS.find(d => d.key === key);
      showToast(t('admin.reports.exportSuccess', { name: def ? t(def.labelKey) : result.filename, count: result.rows }), 'success');
    } catch (err) {
      console.error('Export failed:', err);
      showToast(t('admin.reports.exportError'), 'error');
    } finally {
      setExporting(null);
    }
  }, [gymId, exporting, rangeKey, customFrom, customTo, showToast, t, i18n.language, refreshHistory]);

  const handleClearHistory = useCallback(() => {
    clearExportHistory();
    refreshHistory();
  }, [refreshHistory]);

  const dateInput = {
    width: '100%', borderRadius: 10, padding: '9px 12px', fontFamily: FK.body, fontSize: 13,
    background: TK.surface, border: `1px solid ${TK.borderSolid}`, color: TK.text, outline: 'none',
  };
  const pagerBtn = { width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', background: TK.surface, border: `1px solid ${TK.borderSolid}` };

  // paginate the export history (newest first, HISTORY_PAGE_SIZE per page)
  const histPageCount = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const histClamped = Math.min(histPage, histPageCount - 1);
  const visibleHistory = history.slice(histClamped * HISTORY_PAGE_SIZE, histClamped * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);

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

  return (
    <AdminPageShell>
      {/* header */}
      <div data-admin-tour="reports" style={{ minWidth: 0 }}>
        <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.reports.title')}</h1>
        <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.reports.subtitle')}</div>
      </div>

      {/* date range */}
      <FadeIn delay={30}>
        <Card style={{ padding: '18px 22px', marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
            <Ico ch={RIC.cal} size={15} color={TK.textFaint} stroke={2} />
            <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.3, textTransform: 'uppercase', color: TK.textFaint }}>{t('admin.reports.dateRange')}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {RANGE_PRESETS.map(preset => {
              const on = rangeKey === preset.key;
              return (
                <button key={preset.key} type="button" onClick={() => setRangeKey(preset.key)}
                  style={{ padding: '10px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 13, fontWeight: on ? 700 : 600, textTransform: 'uppercase', letterSpacing: 0.5, color: on ? '#fff' : TK.textSub, background: on ? TK.accent : TK.surface, border: `1px solid ${on ? TK.accent : TK.borderSolid}`, whiteSpace: 'nowrap' }}>
                  {t(preset.labelKey)}
                </button>
              );
            })}
          </div>
          {rangeKey === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginTop: 14, maxWidth: 460 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textMute }}>{t('admin.reports.from')}</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={dateInput} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textMute }}>{t('admin.reports.to')}</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={dateInput} />
              </div>
            </div>
          )}
        </Card>
      </FadeIn>

      {/* quick exports + scheduled banner */}
      <RpGroup>{t('admin.reports.quickExports')}</RpGroup>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 18px', borderRadius: 12, background: TK.surface2, border: `1px dashed ${TK.borderSolid}` }}>
        <Ico ch={RIC.clock} size={16} color={TK.textMute} stroke={2} style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute }}>{t('admin.reports.scheduledSoon', 'Scheduled exports coming soon — for now, run exports manually.')}</span>
      </div>

      {/* grouped export cards */}
      {['members', 'activity', 'commerce'].map((g, gi) => {
        const defs = groupMap[g].map(k => EXPORT_DEFS.find(d => d.key === k)).filter(Boolean);
        if (!defs.length) return null;
        return (
          <FadeIn key={g} delay={40 + gi * 20}>
            <RpGroup>{groupLabels[g]}</RpGroup>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[16px]">
              {defs.map(def => (
                <ExportCard key={def.key} def={def} exporting={exporting} onExport={handleExport} t={t} />
              ))}
            </div>
          </FadeIn>
        );
      })}

      {/* export history */}
      <FadeIn delay={120}>
        <Card style={{ padding: '22px 24px', marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.reports.exportHistory')}</div>
              <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 4 }}>
                {history.length === 0 ? t('admin.reports.noHistory') : t('admin.reports.historyRetention', { defaultValue: 'Auto-clears after 30 days' })}
              </div>
            </div>
            {history.length > 0 && (
              <button type="button" onClick={handleClearHistory}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', background: 'transparent', border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 12, fontWeight: 700, color: TK.textMute, flexShrink: 0 }}>
                <Ico ch={RIC.trash} size={13} color={TK.textMute} stroke={2} />{t('admin.reports.clearHistory')}
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '46px 20px' }}>
              <span style={{ width: 52, height: 52, borderRadius: 15, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                <Ico ch={RIC.doc} size={24} color={TK.textFaint} stroke={1.7} />
              </span>
              <span style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 600, color: TK.textSub }}>{t('admin.reports.noHistory')}</span>
              <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textFaint, textAlign: 'center', maxWidth: 340 }}>{t('admin.reports.historyHint', 'When you export a report, it will appear here with its date and range so you can download it again.')}</span>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              {visibleHistory.map((entry, idx) => (
                <div key={`${entry.exportedAt}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: idx > 0 ? `1px solid ${TK.divider}` : 'none' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                    <Ico ch={KEY_ICON[entry.key] || RIC.doc} size={16} color={TK.textSub} stroke={1.9} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FK.body, fontSize: 13, fontWeight: 600, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.filename}</div>
                    <div style={{ fontFamily: FK.mono, fontSize: 11.5, color: TK.textFaint, marginTop: 2 }}>{entry.rows} {t('admin.reports.rows')} · {new Date(entry.exportedAt).toLocaleString()}</div>
                  </div>
                </div>
              ))}
              {history.length > HISTORY_PAGE_SIZE && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${TK.divider}` }}>
                  <button type="button" disabled={histClamped === 0} onClick={() => setHistPage(p => Math.max(0, p - 1))}
                    style={{ ...pagerBtn, opacity: histClamped === 0 ? 0.4 : 1, cursor: histClamped === 0 ? 'default' : 'pointer' }}>
                    <Ico ch={RIC.chevL} size={15} color={TK.textSub} stroke={2.2} />
                  </button>
                  <span style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textMute }}>{histClamped + 1} / {histPageCount}</span>
                  <button type="button" disabled={histClamped >= histPageCount - 1} onClick={() => setHistPage(p => Math.min(histPageCount - 1, p + 1))}
                    style={{ ...pagerBtn, opacity: histClamped >= histPageCount - 1 ? 0.4 : 1, cursor: histClamped >= histPageCount - 1 ? 'default' : 'pointer' }}>
                    <Ico ch={RIC.chevR} size={15} color={TK.textSub} stroke={2.2} />
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      </FadeIn>
    </AdminPageShell>
  );
}
