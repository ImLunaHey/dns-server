import { Panel } from "./Panel";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveLine } from "@nivo/line";
import { ResponsiveBar } from "@nivo/bar";
import { useEffect, useState } from "react";

export type ChartType = "pie" | "line" | "bar";

export interface PieChartData {
  id: string;
  value: number;
  color?: string;
}

export interface LineChartData {
  id: string;
  data: Array<{ x: string | number; y: number }>;
}

export interface BarChartData {
  [key: string]: string | number;
}

interface ChartProps {
  title: string;
  type: ChartType;
  data: PieChartData[] | LineChartData[] | BarChartData[];
  height?: number | string;
  emptyMessage?: string;
  isEmpty?: boolean;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  noShadow?: boolean;
  // Pie chart specific
  innerRadius?: number;
  // Line chart specific
  xAxisLabel?: string;
  yAxisLabel?: string;
  // Bar chart specific
  keys?: string[];
  indexBy?: string;
}

export function Chart({
  title,
  type,
  data,
  height = 300,
  emptyMessage = "No data available",
  className,
  padding = "lg",
  noShadow = false,
  innerRadius = 0.5,
  xAxisLabel,
  yAxisLabel,
  keys,
  indexBy,
  isEmpty: isEmptyProp,
}: ChartProps) {
  const heightStyle = typeof height === "number" ? `${height}px` : height;
  const isEmpty = isEmptyProp !== undefined ? isEmptyProp : data.length === 0;

  // Detect dark mode using media query
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDarkMode(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const labelColor = isDarkMode ? "#d1d5db" : "#6b7280"; // gray-300 in dark, gray-500 in light

  const commonTheme = {
    background: "transparent",
    text: {
      fontSize: 12,
      fill: labelColor,
    },
    tooltip: {
      container: {
        background: "rgb(17 24 39)",
        border: "1px solid rgb(55 65 81)",
        borderRadius: "0.5rem",
        color: "rgb(243 244 246)",
      },
    },
  };

  const renderChart = () => {
    if (isEmpty) {
      return (
        <div className="h-full flex items-center justify-center text-gray-600 dark:text-gray-400">
          {emptyMessage}
        </div>
      );
    }

    switch (type) {
      case "pie": {
        const pieData = data as PieChartData[];
        return (
          <ResponsivePie
            data={pieData}
            margin={{ top: 20, right: 40, bottom: 20, left: 40 }}
            innerRadius={innerRadius}
            padAngle={2}
            cornerRadius={4}
            activeOuterRadiusOffset={8}
            colors={
              pieData[0]?.color ? { datum: "data.color" } : { scheme: "nivo" }
            }
            borderWidth={2}
            borderColor={{ from: "color", modifiers: [["darker", 0.2]] }}
            arcLinkLabelsSkipAngle={10}
            arcLinkLabelsTextColor={labelColor}
            arcLinkLabelsThickness={2}
            arcLinkLabelsColor={{ from: "color" }}
            arcLabelsSkipAngle={10}
            arcLabelsTextColor="currentColor"
            theme={commonTheme}
            tooltip={({ datum }) => {
              const total = pieData.reduce((sum, d) => sum + d.value, 0);
              return (
                <div className="bg-white dark:bg-black border border-gray-300 dark:border-gray-800 rounded px-2 py-1 shadow-lg text-xs whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: datum.color }}
                    />
                    <span className="text-gray-900 dark:text-white font-medium">
                      {datum.id}:
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {datum.value.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-gray-600 dark:text-gray-400 text-xs mt-0.5">
                    {((datum.value / total) * 100).toFixed(1)}%
                  </div>
                </div>
              );
            }}
          />
        );
      }
      case "line": {
        const lineData = data as LineChartData[];
        return (
          <ResponsiveLine
            data={lineData}
            margin={{ top: 20, right: 20, bottom: 50, left: 50 }}
            xScale={{ type: "point" }}
            yScale={{ type: "linear", min: "auto", max: "auto" }}
            axisTop={null}
            axisRight={null}
            axisBottom={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: -45,
              legend: xAxisLabel,
              legendOffset: 50,
              legendPosition: "middle",
            }}
            axisLeft={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: yAxisLabel,
              legendOffset: -50,
              legendPosition: "middle",
            }}
            pointSize={6}
            pointColor={{ theme: "background" }}
            pointBorderWidth={2}
            pointBorderColor={{ from: "serieColor" }}
            useMesh={true}
            theme={{
              ...commonTheme,
              grid: {
                line: {
                  stroke: "#374151",
                  strokeWidth: 1,
                },
              },
              axis: {
                domain: {
                  line: {
                    stroke: "#6b7280",
                    strokeWidth: 1,
                  },
                },
              },
            }}
            tooltip={({ point }) => (
              <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg p-2">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {point.data.x}
                </div>
                <div className="text-sm">
                  {yAxisLabel || "Value"}:{" "}
                  <span className="font-medium">{point.data.y}</span>
                </div>
              </div>
            )}
          />
        );
      }
      case "bar": {
        const barData = data as BarChartData[];
        const barKeys =
          keys ||
          (barData.length > 0
            ? Object.keys(barData[0]).filter((k) => k !== (indexBy || "id"))
            : []);
        return (
          <ResponsiveBar
            data={barData}
            keys={barKeys}
            indexBy={indexBy || "id"}
            margin={{ top: 20, right: 40, bottom: 60, left: 50 }}
            padding={0.3}
            valueScale={{ type: "linear" }}
            indexScale={{ type: "band", round: true }}
            colors={{ scheme: "nivo" }}
            borderColor={{ from: "color", modifiers: [["darker", 1.6]] }}
            axisTop={null}
            axisRight={null}
            axisBottom={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: -45,
              legend: xAxisLabel,
              legendPosition: "middle",
              legendOffset: 50,
            }}
            axisLeft={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: yAxisLabel,
              legendPosition: "middle",
              legendOffset: -40,
            }}
            labelSkipWidth={12}
            labelSkipHeight={12}
            labelTextColor={{ from: "color", modifiers: [["darker", 1.6]] }}
            legends={[
              {
                dataFrom: "keys",
                anchor: "bottom-right",
                direction: "column",
                justify: false,
                translateX: 120,
                translateY: 0,
                itemsSpacing: 2,
                itemWidth: 100,
                itemHeight: 20,
                itemDirection: "left-to-right",
                itemOpacity: 0.85,
                symbolSize: 20,
              },
            ]}
            theme={{
              ...commonTheme,
              axis: {
                domain: {
                  line: {
                    stroke: "#374151",
                    strokeWidth: 1,
                  },
                },
                ticks: {
                  line: {
                    stroke: "#4b5563",
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
          />
        );
      }
    }
  };

  return (
    <Panel className={className} padding={padding} noShadow={noShadow}>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        {title}
      </h2>
      <div style={{ height: heightStyle }}>{renderChart()}</div>
    </Panel>
  );
}
