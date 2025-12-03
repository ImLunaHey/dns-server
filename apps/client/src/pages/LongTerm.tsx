import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ResponsiveLine } from "@nivo/line";
import { cn } from "../lib/cn";
import { Loading } from "../components/Loading";

const DAY_OPTIONS = [7, 14, 30, 60, 90];

export function LongTerm() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({
    queryKey: ["longTerm", days],
    queryFn: () => api.getLongTermData(days),
  });

  if (isLoading) {
    return <Loading fullScreen />;
  }

  const chartData = [
    {
      id: "Total Queries",
      data: (data || []).map((d: { date: string; total: number }) => ({
        x: d.date,
        y: d.total,
      })),
    },
    {
      id: "Blocked Queries",
      data: (data || []).map((d: { date: string; blocked: number }) => ({
        x: d.date,
        y: d.blocked,
      })),
    },
  ];

  const totalQueries = (data || []).reduce((sum: number, d: { total: number }) => sum + d.total, 0);
  const totalBlocked = (data || []).reduce((sum: number, d: { blocked: number }) => sum + d.blocked, 0);
  const avgQueriesPerDay = data && data.length > 0 ? Math.round(totalQueries / data.length) : 0;

  return (
    <>
      <header className="bg-white dark:bg-black shadow-lg border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto pl-16 md:pl-4 pr-4 sm:px-6 lg:px-8 py-4 md:py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Long-term Data</h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">Historical statistics and trends</p>
            </div>
            <div className="flex gap-2">
              {DAY_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => setDays(option)}
                  className={cn(
                    "px-4 py-2 rounded-lg font-medium transition-colors",
                    days === option
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                  )}
                >
                  {option}d
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Total Queries</h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">{totalQueries.toLocaleString()}</p>
            <p className="text-sm text-gray-600 dark:text-gray-500 mt-1">Over {days} days</p>
          </div>
          <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Blocked Queries</h3>
            <p className="text-3xl font-bold text-red-600 dark:text-red-400">{totalBlocked.toLocaleString()}</p>
            <p className="text-sm text-gray-600 dark:text-gray-500 mt-1">
              {totalQueries > 0 ? ((totalBlocked / totalQueries) * 100).toFixed(1) : 0}% blocked
            </p>
          </div>
          <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Avg. Queries/Day</h3>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{avgQueriesPerDay.toLocaleString()}</p>
            <p className="text-sm text-gray-600 dark:text-gray-500 mt-1">Daily average</p>
          </div>
        </div>

        <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Queries Over Time</h2>
          <div className="h-96">
            {data && data.length > 0 ? (
              <ResponsiveLine
                data={chartData}
                margin={{ top: 20, right: 20, bottom: 60, left: 60 }}
                xScale={{ type: "point" }}
                yScale={{
                  type: "linear",
                  min: "auto",
                  max: "auto",
                }}
                axisTop={null}
                axisRight={null}
                axisBottom={{
                  tickSize: 5,
                  tickPadding: 5,
                  tickRotation: -45,
                  legend: "Date",
                  legendOffset: 50,
                  legendPosition: "middle",
                }}
                axisLeft={{
                  tickSize: 5,
                  tickPadding: 5,
                  tickRotation: 0,
                  legend: "Queries",
                  legendOffset: -50,
                  legendPosition: "middle",
                }}
                pointSize={8}
                pointColor={{ theme: "background" }}
                pointBorderWidth={2}
                pointBorderColor={{ from: "serieColor" }}
                pointLabelYOffset={-12}
                useMesh={true}
                legends={[
                  {
                    anchor: "top-right",
                    direction: "column",
                    justify: false,
                    translateX: 0,
                    translateY: 0,
                    itemsSpacing: 0,
                    itemDirection: "left-to-right",
                    itemWidth: 80,
                    itemHeight: 20,
                    itemOpacity: 0.75,
                    symbolSize: 12,
                    symbolShape: "circle",
                  },
                ]}
                theme={{
                  background: "transparent",
                  text: {
                    fill: "#9ca3af",
                    fontSize: 12,
                  },
                  axis: {
                    domain: {
                      line: {
                        stroke: "#4b5563",
                        strokeWidth: 1,
                      },
                    },
                    ticks: {
                      line: {
                        stroke: "#6b7280",
                        strokeWidth: 1,
                      },
                      text: {
                        fill: "#9ca3af",
                      },
                    },
                  },
                  grid: {
                    line: {
                      stroke: "#374151",
                      strokeWidth: 1,
                    },
                  },
                }}
                colors={["#a855f7", "#ef4444"]}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 dark:text-gray-400">
                No data available for the selected time period
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

