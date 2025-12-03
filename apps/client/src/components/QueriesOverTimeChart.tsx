import { useState } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import { DNSQuery } from '../lib/api';
import { cn } from '../lib/cn';
import { Panel } from './Panel';

interface QueriesOverTimeChartProps {
  queries: DNSQuery[];
}

type TimeRange = '1h' | '6h' | '24h' | '7d' | 'custom';

const TIME_RANGES: Record<TimeRange, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'custom': 0,
};

export function QueriesOverTimeChart({ queries }: QueriesOverTimeChartProps) {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('24h');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const getTimeRange = () => {
    if (selectedRange === 'custom') {
      if (!customStart || !customEnd) return null;
      const start = new Date(customStart).getTime();
      const end = new Date(customEnd).getTime();
      return { start, end };
    }
    const now = Date.now();
    const start = now - TIME_RANGES[selectedRange];
    return { start, end: now };
  };

  const timeRange = getTimeRange();
  const filteredQueries = timeRange
    ? queries.filter(q => q.timestamp >= timeRange.start && q.timestamp <= timeRange.end)
    : [];

  const getInterval = (range: TimeRange) => {
    switch (range) {
      case '1h': return 5 * 60 * 1000; // 5 minutes
      case '6h': return 30 * 60 * 1000; // 30 minutes
      case '24h': return 60 * 60 * 1000; // 1 hour
      case '7d': return 6 * 60 * 60 * 1000; // 6 hours
      default: return 60 * 60 * 1000;
    }
  };

  const interval = getInterval(selectedRange);
  const timeSlots: Record<number, { blocked: number; allowed: number }> = {};

  filteredQueries.forEach(query => {
    const slotTime = Math.floor(query.timestamp / interval) * interval;
    if (!timeSlots[slotTime]) {
      timeSlots[slotTime] = { blocked: 0, allowed: 0 };
    }
    if (query.blocked) {
      timeSlots[slotTime].blocked++;
    } else {
      timeSlots[slotTime].allowed++;
    }
  });

  const data = Object.entries(timeSlots)
    .map(([time, counts]) => {
      const date = new Date(Number(time));
      let label = '';
      if (selectedRange === '1h') {
        label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (selectedRange === '6h' || selectedRange === '24h') {
        label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        label = date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
      }
      return {
        time: label,
        timestamp: Number(time),
        Blocked: counts.blocked,
        Allowed: counts.allowed,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  return (
    <Panel>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Queries Over Time</h2>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {(['1h', '6h', '24h', '7d'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setSelectedRange(range)}
                className={cn(
                  'px-3 py-1 text-sm rounded transition-colors',
                  selectedRange === range
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                )}
              >
                {range.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelectedRange('custom')}
            className={cn(
              'px-3 py-1 text-sm rounded transition-colors',
              selectedRange === 'custom'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            )}
          >
            Custom
          </button>
        </div>
      </div>

      {selectedRange === 'custom' && (
        <div className="mb-4 flex gap-2">
          <input
            type="datetime-local"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm"
          />
          <input
            type="datetime-local"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm"
          />
        </div>
      )}

      <div style={{ height: '300px' }}>
        {data.length > 0 ? (
          <ResponsiveBar
            data={data}
            keys={['Blocked', 'Allowed']}
            indexBy="time"
            margin={{ top: 20, right: 80, bottom: 60, left: 60 }}
            padding={0.3}
            valueScale={{ type: 'linear' }}
            indexScale={{ type: 'band', round: true }}
            colors={['#ef4444', '#22c55e']}
            borderColor={{ from: 'color', modifiers: [['darker', 1.6]] }}
            axisTop={null}
            axisRight={null}
            axisBottom={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: -45,
              legend: 'Time',
              legendPosition: 'middle',
              legendOffset: 50,
            }}
            axisLeft={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: 'Queries',
              legendPosition: 'middle',
              legendOffset: -40,
            }}
            labelSkipWidth={12}
            labelSkipHeight={12}
            labelTextColor={{ from: 'color', modifiers: [['darker', 1.6]] }}
            legends={[
              {
                dataFrom: 'keys',
                anchor: 'bottom-right',
                direction: 'column',
                justify: false,
                translateX: 120,
                translateY: 0,
                itemsSpacing: 2,
                itemWidth: 100,
                itemHeight: 20,
                itemDirection: 'left-to-right',
                itemOpacity: 0.85,
                symbolSize: 20,
              },
            ]}
            theme={{
              background: 'transparent',
              text: {
                fontSize: 12,
                fill: '#9ca3af',
              },
              axis: {
                domain: {
                  line: {
                    stroke: '#374151',
                    strokeWidth: 1,
                  },
                },
                ticks: {
                  line: {
                    stroke: '#4b5563',
                    strokeWidth: 1,
                  },
                  text: {
                    fill: '#9ca3af',
                  },
                },
              },
              grid: {
                line: {
                  stroke: '#374151',
                  strokeWidth: 1,
                },
              },
              tooltip: {
                container: {
                  background: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '0.5rem',
                  color: '#f3f4f6',
                },
              },
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 dark:text-gray-400">
            {selectedRange === 'custom' && (!customStart || !customEnd)
              ? 'Please select a date range'
              : 'No data available for this time range'}
          </div>
        )}
      </div>
    </Panel>
  );
}
