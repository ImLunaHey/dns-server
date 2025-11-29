import { Panel } from "./Panel";
import { DataTable } from "./Table";
import { useStats } from "../hooks/useStats";
import { cn } from "../lib/cn";

export function TopAdvertisers() {
  const { data: stats } = useStats();

  if (!stats?.topAdvertisers || stats.topAdvertisers.length === 0) {
    return (
      <Panel>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Top Advertisers
        </h2>
        <div className="py-8 text-center text-gray-600 dark:text-gray-400">
          No advertiser data available
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="overflow-hidden" padding="none">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-black">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Top Advertisers
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Domains that are frequently blocked (advertising/tracking)
        </p>
      </div>
      <DataTable
        columns={[
          {
            header: "Domain",
            accessor: (row, index) => (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  #{index + 1}
                </span>
                <span className="font-mono text-sm text-gray-900 dark:text-gray-200">
                  {row.domain}
                </span>
              </div>
            ),
          },
          {
            header: "Blocked",
            accessor: (row) => row.blockedCount.toLocaleString(),
            className: "text-red-400 font-medium",
          },
          {
            header: "Total Queries",
            accessor: (row) => row.totalCount.toLocaleString(),
          },
          {
            header: "Block Rate",
            accessor: (row) => (
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 max-w-24">
                  <div
                    className="bg-red-500 h-2 rounded-full"
                    style={{ width: `${Math.min(row.blockRate, 100)}%` }}
                  />
                </div>
                <span
                  className={cn(
                    "text-sm font-medium",
                    row.blockRate >= 90
                      ? "text-red-400"
                      : row.blockRate >= 70
                      ? "text-orange-400"
                      : "text-yellow-400"
                  )}
                >
                  {row.blockRate.toFixed(1)}%
                </span>
              </div>
            ),
          },
        ]}
        data={stats.topAdvertisers}
        emptyMessage="No advertiser data available"
        getRowKey={(row) => row.domain}
      />
    </Panel>
  );
}
