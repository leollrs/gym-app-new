import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { AdminPageShell, FadeIn } from '../../components/admin';
import { fetchPosts, fetchComments, fetchReports, fetchPendingReportCount } from '../../lib/admin/moderationQueries';
import { TK, FK, Ico, Card, MIC, ModTabs } from './components/moderationKit';
import PostsTab from './components/PostsTab';
import CommentsTab from './components/CommentsTab';
import ReportsTab from './components/ReportsTab';

// ── MAIN ───────────────────────────────────────────────────────────────────

export default function AdminModeration() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const [tab, setTab] = useState('reports');

  useEffect(() => { document.title = `${t('admin.moderation.title', 'Admin - Moderation')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const gymId = profile?.gym_id;

  // Prefetch all three lists so the banner + tab counts are accurate up front.
  const { data: reports = [] } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'reports'],
    queryFn: () => fetchReports(gymId),
    enabled: !!gymId,
  });
  const { data: posts = [] } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'posts'],
    queryFn: () => fetchPosts(gymId),
    enabled: !!gymId,
  });
  const { data: comments = [] } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'comments'],
    queryFn: () => fetchComments(gymId),
    enabled: !!gymId,
  });

  // True pending count via a head-only COUNT — fetchReports is capped at 50, so
  // filtering that list would undercount pending reports on a busy gym.
  const { data: pendingReportCount = 0 } = useQuery({
    queryKey: [...adminKeys.moderation(gymId), 'pendingCount'],
    queryFn: () => fetchPendingReportCount(gymId),
    enabled: !!gymId,
  });

  // Fall back to the list-derived count only until the head-count resolves, so
  // the badge never shows a value larger than what the count query will confirm.
  const pendingReports = pendingReportCount || reports.filter(r => r.status === 'pending').length;

  const tabs = [
    { key: 'reports',  label: t('admin.moderation.reports', { defaultValue: 'Reports' }),    icon: MIC.flag,  count: pendingReports || null },
    { key: 'posts',    label: t('admin.moderation.feedPosts', { defaultValue: 'Posts' }),    icon: MIC.pulse, count: posts.length || null },
    { key: 'comments', label: t('admin.moderation.comments', { defaultValue: 'Comments' }),  icon: MIC.chat,  count: comments.length || null },
  ];

  return (
    <AdminPageShell>
      {/* header */}
      <div data-admin-tour="moderation" style={{ minWidth: 0 }}>
        <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>
          {t('admin.moderation.title', { defaultValue: 'Content Moderation' })}
        </h1>
        <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>
          {t('admin.moderation.subtitle', { defaultValue: 'Review and moderate feed posts, comments, and member reports' })}
        </div>
      </div>

      {/* status banner — pending (danger) vs all-clear (success) */}
      <FadeIn>
        {pendingReports > 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, padding: '14px 20px', borderRadius: 14,
            background: 'var(--color-danger-soft)', border: '1px solid color-mix(in srgb, var(--color-danger) 32%, transparent)',
          }}>
            <span style={{ width: 30, height: 30, borderRadius: 99, display: 'grid', placeItems: 'center', background: TK.surface, border: '1px solid color-mix(in srgb, var(--color-danger) 32%, transparent)', flexShrink: 0 }}>
              <Ico ch={MIC.flag} size={16} color="var(--color-danger)" stroke={2.1} />
            </span>
            <span style={{ flex: 1, minWidth: 0, fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: 'var(--color-danger-ink, var(--color-danger))' }}>
              {t('admin.moderation.pendingBanner', { count: pendingReports, defaultValue: 'You have {{count}} pending reports — review now' })}
            </span>
            <button onClick={() => setTab('reports')} style={{
              flexShrink: 0, padding: '8px 16px', borderRadius: 999, cursor: 'pointer', border: 'none',
              background: 'var(--color-danger)', color: '#fff', fontFamily: FK.body, fontSize: 12.5, fontWeight: 700,
            }}>
              {t('admin.moderation.reviewNow', { defaultValue: 'Review' })}
            </button>
          </div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, padding: '14px 20px', borderRadius: 14,
            background: 'var(--color-success-soft)', border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
          }}>
            <span style={{ width: 30, height: 30, borderRadius: 99, display: 'grid', placeItems: 'center', background: TK.surface, border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)', flexShrink: 0 }}>
              <Ico ch={MIC.check} size={17} color="var(--color-success)" stroke={2.1} />
            </span>
            <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: 'var(--color-success-ink, var(--color-success))' }}>
              {t('admin.moderation.allResolved', { defaultValue: 'All reports resolved' })}
            </span>
          </div>
        )}
      </FadeIn>

      {/* tab bar */}
      <ModTabs tabs={tabs} active={tab} onPick={setTab} />

      {/* tab content */}
      {!gymId ? (
        <Card style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Ico ch={MIC.flag} size={30} color={TK.textFaint} stroke={1.7} style={{ margin: '0 auto 12px' }} />
          <p style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute }}>{t('admin.moderation.noGym', { defaultValue: 'No gym associated with your account.' })}</p>
        </Card>
      ) : (
        <FadeIn delay={0.05} key={tab}>
          {tab === 'reports' ? (
            <ReportsTab gymId={gymId} />
          ) : tab === 'posts' ? (
            <PostsTab gymId={gymId} />
          ) : (
            <CommentsTab gymId={gymId} />
          )}
        </FadeIn>
      )}
    </AdminPageShell>
  );
}
