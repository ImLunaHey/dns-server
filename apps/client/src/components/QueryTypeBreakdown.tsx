import { Chart, PieChartData } from './Chart';
import { useStats } from '../hooks/useStats';

const COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export function QueryTypeBreakdown() {
  const { data: stats } = useStats();

  if (!stats?.queryTypeBreakdown || stats.queryTypeBreakdown.length === 0) {
    return (
      <Chart
        type="pie"
        title="Query Type Breakdown"
        data={[]}
        height={256}
        isEmpty={true}
        emptyMessage="No data available"
        innerRadius={0.5}
      />
    );
  }

  const data: PieChartData[] = stats.queryTypeBreakdown.map((item, index) => ({
    id: item.type,
    value: item.count,
    color: COLORS[index % COLORS.length],
  }));

  return (
    <Chart
      type="pie"
      title="Query Type Breakdown"
      data={data}
      height={256}
      isEmpty={false}
      innerRadius={0.5}
    />
  );
}

