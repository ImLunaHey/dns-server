import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Panel } from "../components/Panel";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { FormField } from "../components/FormField";
import { Chart } from "../components/Chart";

export function QueryPatterns() {
  const [hours, setHours] = useState(24);

  const { data: patterns = [], isLoading } = useQuery({
    queryKey: ["query-patterns", hours],
    queryFn: () => api.getQueryPatterns(hours),
  });

  if (isLoading) {
    return <Loading fullScreen />;
  }

  const chartData = patterns.map((pattern) => ({
    hour: pattern.hour,
    total: pattern.total,
    blocked: pattern.blocked,
    blockPercentage: pattern.blockPercentage,
  }));

  const totalQueries = patterns.reduce((sum, p) => sum + p.total, 0);
  const totalBlocked = patterns.reduce((sum, p) => sum + p.blocked, 0);
  const avgBlockPercentage =
    patterns.length > 0
      ? patterns.reduce((sum, p) => sum + p.blockPercentage, 0) /
        patterns.length
      : 0;

  return (
    <>
      <PageHeader
        title="Query Patterns"
        description="Analyze DNS query patterns over time"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Time Range
              </h2>
              <FormField label="" className="w-48">
                <Select
                  value={hours.toString()}
                  onChange={(e) => setHours(parseInt(e.target.value, 10))}
                >
                  <option value="1">Last 1 hour</option>
                  <option value="6">Last 6 hours</option>
                  <option value="12">Last 12 hours</option>
                  <option value="24">Last 24 hours</option>
                  <option value="48">Last 48 hours</option>
                  <option value="72">Last 72 hours</option>
                  <option value="168">Last 7 days</option>
                </Select>
              </FormField>
            </div>
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Panel>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                Total Queries
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {totalQueries.toLocaleString()}
              </p>
            </Panel>
            <Panel>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                Blocked Queries
              </h3>
              <p className="text-3xl font-bold text-red-600 dark:text-red-400">
                {totalBlocked.toLocaleString()}
              </p>
            </Panel>
            <Panel>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                Average Block Rate
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {avgBlockPercentage.toFixed(2)}%
              </p>
            </Panel>
          </div>

          <Panel>
            {chartData.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                No query data available for the selected time range.
              </p>
            ) : (
              <div className="h-96">
                <Chart
                  title="Query Patterns Over Time"
                  type="line"
                  data={[
                    {
                      id: "Total Queries",
                      data: chartData.map((d) => ({
                        x: `Hour ${d.hour}`,
                        y: d.total,
                      })),
                    },
                    {
                      id: "Blocked Queries",
                      data: chartData.map((d) => ({
                        x: `Hour ${d.hour}`,
                        y: d.blocked,
                      })),
                    },
                  ]}
                  xAxisLabel="Time (Hours)"
                  yAxisLabel="Number of Queries"
                />
              </div>
            )}
          </Panel>

          <Panel>
            {chartData.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                No query data available for the selected time range.
              </p>
            ) : (
              <div className="h-96">
                <Chart
                  title="Block Percentage Over Time"
                  type="line"
                  data={[
                    {
                      id: "Block Percentage",
                      data: chartData.map((d) => ({
                        x: `Hour ${d.hour}`,
                        y: d.blockPercentage,
                      })),
                    },
                  ]}
                  xAxisLabel="Time (Hours)"
                  yAxisLabel="Block Percentage (%)"
                />
              </div>
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}

