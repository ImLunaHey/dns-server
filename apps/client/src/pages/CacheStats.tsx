import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { StatsCard } from "../components/StatsCard";
import { Panel } from "../components/Panel";
import { Chart } from "../components/Chart";
import { useState } from "react";

export function CacheStats() {
  const [hours, setHours] = useState(24);

  const { data: cacheStats, isLoading } = useQuery({
    queryKey: ["cacheStats", hours],
    queryFn: () => api.getCacheStatistics(hours),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600 dark:text-gray-400">
          Loading cache statistics...
        </div>
      </div>
    );
  }

  if (!cacheStats) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600 dark:text-red-400">
          Failed to load cache statistics
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Cache Statistics
          </h1>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value={1}>Last Hour</option>
            <option value={6}>Last 6 Hours</option>
            <option value={24}>Last 24 Hours</option>
            <option value={168}>Last Week</option>
          </select>
        </div>

        {/* Overall Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <StatsCard
            title="Total Queries"
            value={cacheStats.overall.totalQueries.toLocaleString()}
            color="blue"
          />
          <StatsCard
            title="Cache Hits"
            value={cacheStats.overall.cacheHits.toLocaleString()}
            subtitle={`${cacheStats.overall.hitRate.toFixed(2)}% hit rate`}
            color="green"
          />
          <StatsCard
            title="Cache Misses"
            value={cacheStats.overall.cacheMisses.toLocaleString()}
            subtitle={`${cacheStats.overall.missRate.toFixed(2)}% miss rate`}
            color="orange"
          />
          <StatsCard
            title="Hit Rate"
            value={`${cacheStats.overall.hitRate.toFixed(2)}%`}
            color="purple"
          />
          <StatsCard
            title="Miss Rate"
            value={`${cacheStats.overall.missRate.toFixed(2)}%`}
            color="red"
          />
        </div>

        {/* Cache Statistics by Type */}
        <div className="mb-8">
          <Panel>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Cache Statistics by Query Type
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Total Queries
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Cache Hits
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Cache Misses
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Hit Rate
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Miss Rate
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {cacheStats.byType.map((type) => (
                    <tr key={type.type}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {type.type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {type.totalQueries.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-400">
                        {type.cacheHits.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-orange-600 dark:text-orange-400">
                        {type.cacheMisses.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {type.hitRate.toFixed(2)}%
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {type.missRate.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* Top Domains by Cache Hits */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Panel>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Top Domains by Cache Hits
            </h2>
            <div className="space-y-2">
              {cacheStats.topCacheHits.length > 0 ? (
                cacheStats.topCacheHits.map((domain, index) => (
                  <div
                    key={domain.domain}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400 w-6">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {domain.domain}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-green-600 dark:text-green-400">
                        {domain.cacheHits.toLocaleString()} hits
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {domain.hitRate.toFixed(1)}% hit rate
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                  No cache hits recorded
                </div>
              )}
            </div>
          </Panel>

          {/* Top Domains by Cache Misses */}
          <Panel>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Top Domains by Cache Misses
            </h2>
            <div className="space-y-2">
              {cacheStats.topCacheMisses.length > 0 ? (
                cacheStats.topCacheMisses.map((domain, index) => (
                  <div
                    key={domain.domain}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400 w-6">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {domain.domain}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                        {domain.cacheMisses.toLocaleString()} misses
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {domain.hitRate.toFixed(1)}% hit rate
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                  No cache misses recorded
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Hourly Cache Hit Rate Chart */}
        <div className="mb-8">
          <Chart
            type="line"
            title="Cache Hit Rate Over Time"
            data={[
              {
                id: "Hit Rate",
                data: cacheStats.hourly.map((hour) => ({
                  x: `${hour.hour}h`,
                  y: hour.hitRate,
                })),
              },
            ]}
            height={300}
            isEmpty={cacheStats.hourly.length === 0}
            emptyMessage="No cache data available for this time period"
            xAxisLabel="Time (hours ago)"
            yAxisLabel="Hit Rate (%)"
          />
        </div>
      </div>
    </>
  );
}
