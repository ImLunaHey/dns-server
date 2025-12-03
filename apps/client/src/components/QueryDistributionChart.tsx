import { Chart, PieChartData } from './Chart';

interface QueryDistributionChartProps {
  blocked: number;
  allowed: number;
}

export function QueryDistributionChart({ blocked, allowed }: QueryDistributionChartProps) {
  const data: PieChartData[] = [
    { id: 'Blocked', value: blocked, color: '#ef4444' },
    { id: 'Allowed', value: allowed, color: '#22c55e' },
  ];

  const isEmpty = blocked === 0 && allowed === 0;

  return (
    <Chart
      type="pie"
      title="Query Distribution"
      data={data}
      height={300}
      isEmpty={isEmpty}
      emptyMessage="No queries yet"
      innerRadius={0.5}
    />
  );
}
