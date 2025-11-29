import { useStats } from '../hooks/useStats';
import { StatsCard } from '../components/StatsCard';
import { QueryDistributionChart } from '../components/QueryDistributionChart';
import { Link } from '@tanstack/react-router';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';

export function PublicDashboard() {
  const { data: stats, isLoading: statsLoading } = useStats();

  if (statsLoading) {
    return <Loading fullScreen />;
  }

  const blockRate = stats
    ? ((stats.blockedQueries / stats.totalQueries) * 100).toFixed(1)
    : '0';

  return (
    <>
      <PageHeader
        title="DNS Server Stats"
        description="Public statistics"
      >
        <Link
          to="/login"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition-colors"
        >
          Sign In
        </Link>
      </PageHeader>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Total Queries"
            value={stats?.totalQueries.toLocaleString() || '0'}
            color="blue"
          />
          <StatsCard
            title="Blocked"
            value={stats?.blockedQueries.toLocaleString() || '0'}
            subtitle={`${blockRate}% of total`}
            color="red"
          />
          <StatsCard
            title="Allowed"
            value={stats?.allowedQueries.toLocaleString() || '0'}
            color="green"
          />
          <StatsCard
            title="Blocklist Size"
            value={stats?.blocklistSize.toLocaleString() || '0'}
            subtitle="domains blocked"
            color="purple"
          />
        </div>

        {/* Chart */}
        <div className="mb-8">
          <QueryDistributionChart
            blocked={stats?.blockedQueries || 0}
            allowed={stats?.allowedQueries || 0}
          />
        </div>
      </main>
    </>
  );
}

