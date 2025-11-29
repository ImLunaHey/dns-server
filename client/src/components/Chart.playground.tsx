import { ComponentPlaygroundConfig } from "./playground.types";
import {
  Chart,
  ChartType,
  PieChartData,
  LineChartData,
  BarChartData,
} from "./Chart";

export const ChartPlayground = {
  name: "Chart" as const,
  controls: [
    {
      key: "type" as const,
      label: "Chart Type",
      type: "select" as const,
      options: [
        { label: "Pie", value: "pie" as const },
        { label: "Line", value: "line" as const },
        { label: "Bar", value: "bar" as const },
      ],
      defaultValue: "pie" as const,
    },
    {
      key: "title" as const,
      label: "Title",
      type: "text" as const,
      defaultValue: "Chart Title",
    },
    {
      key: "height" as const,
      label: "Height (px)",
      type: "number" as const,
      defaultValue: 300,
    },
    {
      key: "dataPoints" as const,
      label: "Number of Data Points",
      type: "number" as const,
      defaultValue: 5,
    },
    {
      key: "emptyMessage" as const,
      label: "Empty Message",
      type: "text" as const,
      defaultValue: "No data available",
    },
    {
      key: "padding" as const,
      label: "Padding",
      type: "select" as const,
      options: [
        { label: "None", value: "none" as const },
        { label: "Small", value: "sm" as const },
        { label: "Medium", value: "md" as const },
        { label: "Large", value: "lg" as const },
      ],
      defaultValue: "lg" as const,
    },
    {
      key: "noShadow" as const,
      label: "No Shadow",
      type: "toggle" as const,
      defaultValue: false,
    },
  ],
  render: (props) => {
    const type = props.type as ChartType;
    const dataPoints = Number(props.dataPoints) || 5;

    let data: PieChartData[] | LineChartData[] | BarChartData[];

    if (type === "pie") {
      const colors = [
        "#ef4444",
        "#22c55e",
        "#3b82f6",
        "#f59e0b",
        "#8b5cf6",
        "#ec4899",
        "#06b6d4",
        "#f97316",
      ];
      data = Array.from({ length: dataPoints }, (_, i) => ({
        id: `Item ${i + 1}`,
        value: (dataPoints - i) * 100,
        color: colors[i % colors.length],
      })) as PieChartData[];
    } else if (type === "line") {
      data = [
        {
          id: "Series 1",
          data: Array.from({ length: dataPoints }, (_, i) => ({
            x: `Day ${i + 1}`,
            y: Math.floor(Math.random() * 100) + 20,
          })),
        },
      ] as LineChartData[];
    } else {
      data = Array.from({ length: dataPoints }, (_, i) => ({
        id: `Item ${i + 1}`,
        value1: Math.floor(Math.random() * 100) + 20,
        value2: Math.floor(Math.random() * 100) + 20,
      })) as BarChartData[];
    }

    return (
      <Chart
        title={props.title as string}
        type={type}
        data={data}
        height={Number(props.height) || 300}
        emptyMessage={props.emptyMessage as string}
        padding={props.padding as "none" | "sm" | "md" | "lg"}
        noShadow={props.noShadow as boolean}
        xAxisLabel={
          type === "line" || type === "bar" ? "Category" : undefined
        }
        yAxisLabel={type === "line" || type === "bar" ? "Value" : undefined}
        keys={type === "bar" ? ["value1", "value2"] : undefined}
        indexBy={type === "bar" ? "id" : undefined}
      />
    );
  },
  codeGen: (props) => {
    const type = props.type as ChartType;

    let dataExample = "";
    if (type === "pie") {
      dataExample = `[
  { id: "Item 1", value: 500, color: "#ef4444" },
  { id: "Item 2", value: 400, color: "#22c55e" },
  // ... more items
]`;
    } else if (type === "line") {
      dataExample = `[
  {
    id: "Series 1",
    data: [
      { x: "Day 1", y: 50 },
      { x: "Day 2", y: 60 },
      // ... more points
    ],
  },
]`;
    } else {
      dataExample = `[
  { id: "Item 1", value1: 50, value2: 60 },
  { id: "Item 2", value1: 40, value2: 70 },
  // ... more items
]`;
    }

    const parts: string[] = [];
    parts.push(`type="${type}"`);
    parts.push(`title="${props.title}"`);
    if (Number(props.height) !== 300) parts.push(`height={${props.height}}`);
    if (props.emptyMessage !== "No data available")
      parts.push(`emptyMessage="${props.emptyMessage}"`);
    if (props.padding !== "lg") parts.push(`padding="${props.padding}"`);
    if (props.noShadow) parts.push("noShadow");
    if (type === "line" || type === "bar") {
      parts.push('xAxisLabel="Category"');
      parts.push('yAxisLabel="Value"');
    }
    if (type === "bar") {
      parts.push('keys={["value1", "value2"]}');
      parts.push('indexBy="id"');
    }

    return `<Chart
  ${parts.join("\n  ")}
  data={${dataExample}}
/>`;
  },
} satisfies ComponentPlaygroundConfig;

