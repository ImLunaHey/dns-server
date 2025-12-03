import { Chart, PieChartData } from './Chart';
import { useStats } from '../hooks/useStats';

const COLORS = ['#a855f7', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1', '#14b8a6', '#f97316'];

export function QueryTypesChart() {
  const { data: stats } = useStats();

  if (!stats?.queryTypeBreakdown || stats.queryTypeBreakdown.length === 0) {
    return (
      <Chart
        type="pie"
        title="Query Types"
        data={[]}
        height={300}
        isEmpty={true}
        emptyMessage="No data available"
        innerRadius={0.5}
      />
    );
  }

  const data: PieChartData[] = stats.queryTypeBreakdown
    .map((item, index) => ({
      id: item.type,
      value: item.count,
      color: COLORS[index % COLORS.length],
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <Chart
      type="pie"
      title="Query Types"
      data={data}
      height={300}
      isEmpty={false}
      innerRadius={0.5}
    />
  );
}
