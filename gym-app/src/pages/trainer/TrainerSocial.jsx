import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Heart, MessageCircle } from 'lucide-react';
import Skeleton from '../../components/Skeleton';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { subDays } from 'date-fns';
import logger from '../../lib/logger';
import { TT } from './components/designTokens';
import { TEyebrow, TPageTitle } from './components/designPrimitives';
import TrainerHero from './components/TrainerHero';
import TrainerStatCard from './components/TrainerStatCard';

const SocialFeed = lazy(() => import('../SocialFeed'));

const FeedSkeleton = () => (
  <div className="space-y-3">
    <Skeleton variant="feed" />
    <Skeleton variant="feed" />
    <Skeleton variant="feed" />
  </div>
);

export default function TrainerSocial() {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const [stats, setStats] = useState({ activeClients: 0, totalReactions: 0, totalComments: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  // Load lightweight engagement stats for the hero strip.
  useEffect(() => {
    if (!profile?.id || !profile?.gym_id) return;
    let cancelled = false;
    (async () => {
      try {
        const sevenDaysAgo = subDays(new Date(), 7).toISOString();
        const [tcRes, reactionsRes, commentsRes] = await Promise.all([
          supabase
            .from('trainer_clients')
            .select('client_id, profiles!trainer_clients_client_id_fkey(last_active_at)')
            .eq('trainer_id', profile.id)
            .eq('is_active', true),
          supabase
            .from('feed_reactions')
            .select('id', { count: 'exact', head: true })
            .eq('profile_id', profile.id)
            .gte('created_at', sevenDaysAgo),
          supabase
            .from('feed_comments')
            .select('id', { count: 'exact', head: true })
            .eq('profile_id', profile.id)
            .gte('created_at', sevenDaysAgo),
        ]);

        const clients = (tcRes.data || []).map(r => r.profiles).filter(Boolean);
        const sevenDaysAgoMs = Date.now() - 7 * 86400000;
        const activeClients = clients.filter(c => c.last_active_at && new Date(c.last_active_at).getTime() >= sevenDaysAgoMs).length;

        if (!cancelled) {
          setStats({
            activeClients,
            totalReactions: reactionsRes.count || 0,
            totalComments: commentsRes.count || 0,
          });
        }
      } catch (err) {
        logger.error('TrainerSocial: failed to load stats', err);
      } finally {
        if (!cancelled) setLoadingStats(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.gym_id]);

  return (
    <div style={{ background: TT.bg, minHeight: '100%', paddingBottom: 112 }}>
      {/* Header */}
      <div className="max-w-[720px] md:max-w-5xl mx-auto" style={{ padding: '12px 16px 14px' }}>
        <TEyebrow color={TT.accent}>{t('trainerSocial.accentLabel', 'Community')}</TEyebrow>
        <TPageTitle>{t('trainerSocial.title', 'Activity')}</TPageTitle>
      </div>

      <div className="max-w-[720px] md:max-w-5xl mx-auto px-4 md:px-6 pt-1 space-y-4">
        {/* Hero engagement card */}
        <TrainerHero
          accentLabel={t('trainerSocial.heroLabel', 'Last 7 days')}
          title={t('trainerSocial.heroTitle', 'Active clients in the feed')}
          value={stats.activeClients}
          subText={t('trainerSocial.heroSub', 'Your engaged trainees this week')}
          icon={Users}
        />

        {/* Engagement stat row */}
        <div className="grid grid-cols-2 gap-3">
          <TrainerStatCard
            icon={Heart}
            label={t('trainerSocial.reactionsGiven', 'Reactions given')}
            value={stats.totalReactions}
            sub={t('trainerSocial.lastSevenDays', 'Last 7 days')}
            delay={0.04}
          />
          <TrainerStatCard
            icon={MessageCircle}
            label={t('trainerSocial.commentsPosted', 'Comments')}
            value={stats.totalComments}
            sub={t('trainerSocial.lastSevenDays', 'Last 7 days')}
            delay={0.08}
          />
        </div>

        {loadingStats && (
          <div aria-hidden className="sr-only">{t('trainerSocial.loadingStats', 'Loading stats')}</div>
        )}

        <Suspense fallback={<FeedSkeleton />}>
          <SocialFeed embedded />
        </Suspense>
      </div>
    </div>
  );
}
