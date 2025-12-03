import { useStats } from "../hooks/useStats";
import { useQueries } from "../hooks/useQueries";
import { useClientNames } from "../hooks/useClientNames";
import { useBlockDomain, useAllowDomain } from "../hooks/useBlocklistMutations";
import { StatsCard } from "../components/StatsCard";
import { QueryLog } from "../components/QueryLog";
import { RankedList } from "../components/RankedList";
import { QueryDistributionChart } from "../components/QueryDistributionChart";
import { QueryTypesChart } from "../components/QueryTypesChart";
import { QueriesOverTimeChart } from "../components/QueriesOverTimeChart";
import { BlockPercentageChart } from "../components/BlockPercentageChart";
import { TopAdvertisers } from "../components/TopAdvertisers";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { api } from "../lib/api";
import { useToastContext } from "../contexts/ToastContext";

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: queries = [], isLoading: queriesLoading } = useQueries({
    limit: 50,
  });
  const { data: clientNames = {} } = useClientNames();
  const blockMutation = useBlockDomain();
  const allowMutation = useAllowDomain();
  const toast = useToastContext();

  const handleBlock = (domain: string) => {
    blockMutation.mutate(domain);
  };

  const handleAllow = (domain: string) => {
    allowMutation.mutate(domain);
  };

  const loading = statsLoading || queriesLoading;

  if (loading) {
    return <Loading fullScreen />;
  }

  const blockRate = stats
    ? ((stats.blockedQueries / stats.totalQueries) * 100).toFixed(1)
    : "0";

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Ad-blocking DNS with real-time monitoring"
      >
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              try {
                const blob = await api.exportStatsCSV();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `dns-stats-${
                  new Date().toISOString().split("T")[0]
                }.csv`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Failed to export statistics"
                );
              }
            }}
            variant="outline"
          >
            Export CSV
          </Button>
          <Button
            onClick={async () => {
              try {
                const blob = await api.exportStatsJSON();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `dns-stats-${
                  new Date().toISOString().split("T")[0]
                }.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Failed to export statistics"
                );
              }
            }}
            variant="outline"
          >
            Export JSON
          </Button>
        </div>
      </PageHeader>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <StatsCard
            title="Total Queries"
            value={stats?.totalQueries.toLocaleString() || "0"}
            color="blue"
          />
          <StatsCard
            title="Blocked"
            value={stats?.blockedQueries.toLocaleString() || "0"}
            subtitle={`${blockRate}% of total`}
            color="red"
          />
          <StatsCard
            title="Allowed"
            value={stats?.allowedQueries.toLocaleString() || "0"}
            color="green"
          />
          <StatsCard
            title="Cached"
            value={stats?.cachedQueries.toLocaleString() || "0"}
            subtitle={
              stats?.totalQueries
                ? `${((stats.cachedQueries / stats.totalQueries) * 100).toFixed(
                    1
                  )}% of total`
                : undefined
            }
            color="orange"
          />
          <StatsCard
            title="Blocklist Size"
            value={stats?.blocklistSize.toLocaleString() || "0"}
            subtitle="domains blocked"
            color="purple"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <QueryDistributionChart
            blocked={stats?.blockedQueries || 0}
            allowed={stats?.allowedQueries || 0}
          />
          <QueryTypesChart />
        </div>

        {/* Block Percentage Over Time */}
        <div className="mb-8">
          <BlockPercentageChart />
        </div>

        {/* Queries Over Time */}
        <div className="mb-8">
          <QueriesOverTimeChart queries={queries} />
        </div>

        {/* Top Advertisers */}
        <div className="mb-8">
          <TopAdvertisers />
        </div>

        {/* Top Domains */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <RankedList
            title="Top Queried Domains"
            items={(stats?.topDomainsArray || []).map((item) => ({
              label: item.domain,
              value: item.count,
            }))}
            color="blue"
          />
          <RankedList
            title="Top Blocked Domains"
            items={(stats?.topBlockedArray || []).map((item) => ({
              label: item.domain,
              value: item.count,
            }))}
            color="red"
          />
        </div>

        {/* Query Log */}
        <QueryLog
          queries={queries}
          clientNames={clientNames}
          onBlock={handleBlock}
          onAllow={handleAllow}
        />
      </main>
    </>
  );
}
