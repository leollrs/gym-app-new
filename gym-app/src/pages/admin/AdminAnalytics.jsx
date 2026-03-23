import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FadeIn, PageHeader } from '../../components/admin';

import GrowthChart from './components/analytics/GrowthChart';
import RetentionChart from './components/analytics/RetentionChart';
import ActivityChart from './components/analytics/ActivityChart';
import CohortTable from './components/analytics/CohortTable';
import ChallengeStats from './components/analytics/ChallengeStats';
import OnboardingFunnel from './components/analytics/OnboardingFunnel';
import LifecycleStages from './components/analytics/LifecycleStages';
import TrainerPerformance from './components/analytics/TrainerPerformance';
import MonthlySummary from './components/analytics/MonthlySummary';

export default function AdminAnalytics() {
  const { profile } = useAuth();
  const gymId = profile?.gym_id;

  useEffect(() => { document.title = 'Admin - Analytics | IronForge'; }, []);

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">

      {/* Page header */}
      <FadeIn>
        <PageHeader
          title="Analytics"
          subtitle="Retention, growth, and engagement metrics"
          className="mb-6"
        />
      </FadeIn>

      {/* Member Lifecycle Funnel */}
      <FadeIn delay={60}>
        <LifecycleStages gymId={gymId} />
      </FadeIn>

      {/* Monthly Summary */}
      <FadeIn delay={90}>
        <MonthlySummary gymId={gymId} />
      </FadeIn>

      {/* Row 1: Member Growth + Retention Rate */}
      <FadeIn delay={120}>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <GrowthChart gymId={gymId} />
          <RetentionChart gymId={gymId} />
        </div>
      </FadeIn>

      {/* Row 1b: Engagement */}
      <FadeIn delay={180}>
        <div className="mb-4">
          <ActivityChart gymId={gymId} />
        </div>
      </FadeIn>

      {/* Row 2: Cohort Retention */}
      <FadeIn delay={240}>
        <div className="mb-4">
          <CohortTable gymId={gymId} />
        </div>
      </FadeIn>

      {/* Row 3: Challenge Participation + Onboarding Completion */}
      <FadeIn delay={300}>
        <div className="grid md:grid-cols-2 gap-4">
          <ChallengeStats gymId={gymId} />
          <OnboardingFunnel gymId={gymId} />
        </div>
      </FadeIn>

      {/* Trainer Performance */}
      <FadeIn delay={360}>
        <TrainerPerformance gymId={gymId} />
      </FadeIn>
    </div>
  );
}
