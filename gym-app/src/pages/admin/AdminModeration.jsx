import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare, Activity, ShieldAlert, Flag, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import {
  PageHeader, AdminCard, AdminPageShell, FadeIn, AdminTabs,
} from '../../components/admin';
import { fetchPosts, fetchComments, fetchReports } from '../../lib/admin/moderationQueries';
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

  // Prefetch all data for stat cards + tab counts
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

  const pendingReports = reports.filter(r => r.status === 'pending').length;

  const tabs = [
    { key: 'reports',  label: t('admin.moderation.reports', { defaultValue: 'Reports' }),   icon: Flag,            count: pendingReports || null },
    { key: 'posts',    label: t('admin.moderation.feedPosts', { defaultValue: 'Posts' }),    icon: Activity,        count: posts.length || null },
    { key: 'comments', label: t('admin.moderation.comments', { defaultValue: 'Comments' }),  icon: MessageSquare,   count: comments.length || null },
  ];

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.moderation.title', { defaultValue: 'Content Moderation' })}
        subtitle={t('admin.moderation.subtitle', { defaultValue: 'Review and moderate feed posts, comments, and member reports' })}
      />

      {/* Focused status banner — tab counts already surface report totals, so the
          page-level signal is just "do you have pending work right now?". */}
      <FadeIn>
        {pendingReports > 0 ? (
          <div
            className="flex items-center gap-3 mt-5 mb-6 px-4 py-3 rounded-xl"
            style={{
              background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)',
            }}
          >
            <AlertTriangle size={18} style={{ color: 'var(--color-danger)' }} className="flex-shrink-0" />
            <span className="flex-1 min-w-0 text-[13.5px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.moderation.pendingBanner', {
                count: pendingReports,
                defaultValue: 'You have {{count}} pending reports — review now',
              })}
            </span>
            <button
              onClick={() => setTab('reports')}
              className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
              style={{
                background: 'var(--color-danger)',
                color: '#fff',
              }}
            >
              {t('admin.moderation.reviewNow', 'Review')}
            </button>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 mt-5 mb-6 px-4 py-2.5 rounded-xl"
            style={{
              background: 'color-mix(in srgb, var(--color-success) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)',
            }}
          >
            <CheckCircle size={16} style={{ color: 'var(--color-success)' }} className="flex-shrink-0" />
            <span className="text-[12.5px] font-semibold" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.moderation.allResolved', 'All reports resolved')}
            </span>
          </div>
        )}
      </FadeIn>

      {/* Tab bar */}
      <AdminTabs tabs={tabs.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: t.count }))} active={tab} onChange={setTab} className="mb-5" />

      {/* Tab content */}
      {!gymId ? (
        <AdminCard>
          <div className="text-center py-16">
            <ShieldAlert size={32} className="text-[#4B5563] mx-auto mb-3" />
            <p className="text-[14px] text-[#6B7280]">{t('admin.moderation.noGym', { defaultValue: 'No gym associated with your account.' })}</p>
          </div>
        </AdminCard>
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
