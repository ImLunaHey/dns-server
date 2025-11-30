import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { Loading } from "../components/Loading";
import { DataTable } from "../components/Table";

export function ClientStats() {
  const { clientIp } = useParams({ from: "/clients/$clientIp/stats" });

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["clientStats", clientIp],
    queryFn: () => api.getClientStats(clientIp!),
    enabled: !!clientIp,
  });

  if (isLoading) {
    return <Loading fullScreen />;
  }

  if (error || !stats) {
    return (
      <>
        <PageHeader title="Client Statistics" />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Panel>
            <p className="text-red-400">
              {error instanceof Error ? error.message : "Failed to load client statistics"}
            </p>
          </Panel>
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Client Statistics: ${clientIp}`}
        description={`Statistics for ${clientIp}`}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Overview Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Panel>
              <div className="text-sm text-gray-400">Total Queries</div>
              <div className="text-2xl font-bold text-white mt-2">
                {stats.totalQueries.toLocaleString()}
              </div>
            </Panel>
            <Panel>
              <div className="text-sm text-gray-400">Blocked Queries</div>
              <div className="text-2xl font-bold text-red-400 mt-2">
                {stats.blockedQueries.toLocaleString()}
              </div>
            </Panel>
            <Panel>
              <div className="text-sm text-gray-400">Allowed Queries</div>
              <div className="text-2xl font-bold text-green-400 mt-2">
                {(stats.totalQueries - stats.blockedQueries).toLocaleString()}
              </div>
            </Panel>
            <Panel>
              <div className="text-sm text-gray-400">Block Percentage</div>
              <div className="text-2xl font-bold text-white mt-2">
                {stats.blockPercentage.toFixed(1)}%
              </div>
            </Panel>
          </div>

          {/* Time Range */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-4">Time Range</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-400">First Query</div>
                <div className="text-white mt-1">
                  {stats.timeRange.first
                    ? new Date(stats.timeRange.first).toLocaleString()
                    : "N/A"}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Last Query</div>
                <div className="text-white mt-1">
                  {stats.timeRange.last
                    ? new Date(stats.timeRange.last).toLocaleString()
                    : "N/A"}
                </div>
              </div>
            </div>
          </Panel>

          {/* Top Domains */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-4">Top Domains</h2>
            <DataTable
              columns={[
                { header: "Domain", accessor: "domain" },
                {
                  header: "Count",
                  accessor: "count",
                  render: (value) => (value as number).toLocaleString(),
                },
              ]}
              data={stats.topDomains}
              getRowKey={(row) => row.domain}
            />
          </Panel>

          {/* Top Blocked Domains */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-4">Top Blocked Domains</h2>
            <DataTable
              columns={[
                { header: "Domain", accessor: "domain" },
                {
                  header: "Count",
                  accessor: "count",
                  render: (value) => (value as number).toLocaleString(),
                },
              ]}
              data={stats.topBlocked}
              getRowKey={(row) => row.domain}
            />
          </Panel>

          {/* Query Types */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-4">Query Types</h2>
            <DataTable
              columns={[
                { header: "Type", accessor: "type" },
                {
                  header: "Count",
                  accessor: "count",
                  render: (value) => (value as number).toLocaleString(),
                },
              ]}
              data={stats.queryTypes}
              getRowKey={(row) => row.type}
            />
          </Panel>
        </div>
      </main>
    </>
  );
}

