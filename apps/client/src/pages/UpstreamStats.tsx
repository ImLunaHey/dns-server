import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type UpstreamStats, type UpstreamHourlyStats } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { Loading } from "../components/Loading";
import { Chart } from "../components/Chart";
import { DataTable } from "../components/Table";
import { Select } from "../components/Select";
import { FormField } from "../components/FormField";

const HOUR_OPTIONS = [1, 6, 12, 24, 48, 72];

export function UpstreamStats() {
  const [hours, setHours] = useState(24);

  const { data: stats, isLoading: statsLoading } = useQuery<UpstreamStats[]>({
    queryKey: ["upstreamStats", hours],
    queryFn: () => api.getUpstreamStats(hours),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: hourlyStats, isLoading: hourlyLoading } = useQuery<UpstreamHourlyStats[]>({
    queryKey: ["upstreamHourlyStats", hours],
    queryFn: () => api.getUpstreamHourlyStats(hours),
    refetchInterval: 30000,
  });

  if (statsLoading || hourlyLoading) {
    return <Loading fullScreen />;
  }

  // Prepare chart data for response time over time
  const responseTimeChartData = hourlyStats
    ? Object.entries(
        hourlyStats.reduce((acc, stat) => {
          if (!acc[stat.upstream]) {
            acc[stat.upstream] = [];
          }
          acc[stat.upstream].push({
            x: stat.hour,
            y: Math.round(stat.avgResponseTime),
          });
          return acc;
        }, {} as Record<string, Array<{ x: string; y: number }>>)
      ).map(([upstream, data]) => ({
        id: upstream,
        data: data.sort((a, b) => a.x.localeCompare(b.x)),
      }))
    : [];

  // Prepare chart data for success rate over time
  const successRateChartData = hourlyStats
    ? Object.entries(
        hourlyStats.reduce((acc, stat) => {
          if (!acc[stat.upstream]) {
            acc[stat.upstream] = [];
          }
          const successRate =
            stat.totalQueries > 0
              ? Math.round((stat.successCount / stat.totalQueries) * 100 * 100) / 100
              : 0;
          acc[stat.upstream].push({
            x: stat.hour,
            y: successRate,
          });
          return acc;
        }, {} as Record<string, Array<{ x: string; y: number }>>)
      ).map(([upstream, data]) => ({
        id: upstream,
        data: data.sort((a, b) => a.x.localeCompare(b.x)),
      }))
    : [];

  return (
    <>
      <PageHeader
        title="Upstream DNS Performance"
        description="Monitor response times and success rates for upstream DNS servers"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <FormField label="Time Range">
            <Select value={hours.toString()} onChange={(e) => setHours(parseInt(e.target.value, 10))}>
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h.toString()}>
                  Last {h} {h === 1 ? "hour" : "hours"}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {stats && stats.length > 0 ? (
          <>
            <Panel>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Upstream Server Statistics
              </h2>
              <DataTable
                data={stats}
                getRowKey={(row) => row.upstream}
                columns={[
                  { header: "Upstream", accessor: "upstream" },
                  {
                    header: "Total Queries",
                    accessor: (row) => row.totalQueries.toLocaleString(),
                  },
                  {
                    header: "Success Rate",
                    accessor: (row: UpstreamStats) => (
                      <span
                        className={
                          row.successRate >= 99
                            ? "text-green-600 dark:text-green-400"
                            : row.successRate >= 95
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {row.successRate.toFixed(2)}%
                      </span>
                    ),
                  },
                  {
                    header: "Success",
                    accessor: (row: UpstreamStats) => row.successCount.toLocaleString(),
                  },
                  {
                    header: "Failures",
                    accessor: (row: UpstreamStats) => (
                      <span className={row.failureCount > 0 ? "text-red-600 dark:text-red-400" : ""}>
                        {row.failureCount.toLocaleString()}
                      </span>
                    ),
                  },
                  {
                    header: "Avg Response Time",
                    accessor: (row: UpstreamStats) => `${Math.round(row.avgResponseTime)}ms`,
                  },
                  {
                    header: "Min Response Time",
                    accessor: (row: UpstreamStats) => `${row.minResponseTime}ms`,
                  },
                  {
                    header: "Max Response Time",
                    accessor: (row: UpstreamStats) => `${row.maxResponseTime}ms`,
                  },
                ]}
              />
            </Panel>

            {responseTimeChartData.length > 0 && (
              <Panel>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Average Response Time Over Time
                </h2>
                <div className="h-80">
                  <Chart
                    type="line"
                    data={responseTimeChartData}
                    title="Average Response Time Over Time"
                    xAxisLabel="Time"
                    yAxisLabel="Response Time (ms)"
                  />
                </div>
              </Panel>
            )}

            {successRateChartData.length > 0 && (
              <Panel>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Success Rate Over Time
                </h2>
                <div className="h-80">
                  <Chart
                    type="line"
                    data={successRateChartData}
                    title="Success Rate Over Time"
                    xAxisLabel="Time"
                    yAxisLabel="Success Rate (%)"
                  />
                </div>
              </Panel>
            )}
          </>
        ) : (
          <Panel>
            <p className="text-gray-600 dark:text-gray-400">
              No upstream performance data available for the selected time range.
            </p>
          </Panel>
        )}
      </main>
    </>
  );
}

