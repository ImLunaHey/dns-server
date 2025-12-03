import { Chart, LineChartData } from './Chart';
import { useStats } from '../hooks/useStats';

export function BlockPercentageChart() {
  const { data: stats } = useStats();

  if (!stats?.blockPercentageOverTime || stats.blockPercentageOverTime.length === 0) {
    return (
      <Chart
        type="line"
        title="Block Percentage Over Time (30 days)"
        data={[]}
        height={256}
        isEmpty={true}
        emptyMessage="No data available"
        xAxisLabel="Date"
        yAxisLabel="Block Percentage (%)"
      />
    );
  }

  const data: LineChartData[] = [
    {
      id: 'Block Percentage',
      data: stats.blockPercentageOverTime.map((item) => ({
        x: item.date,
        y: item.blockPercentage,
      })),
    },
  ];

  return (
    <Chart
      type="line"
      title="Block Percentage Over Time (30 days)"
      data={data}
      height={256}
      isEmpty={false}
      xAxisLabel="Date"
      yAxisLabel="Block Percentage (%)"
    />
  );
}

