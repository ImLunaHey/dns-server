import { DNSQuery } from '../lib/api';
import { Panel } from './Panel';
import { DataTable } from './Table';
import { Badge } from './Badge';

interface QueryLogProps {
  queries: DNSQuery[];
  clientNames?: Record<string, string>;
  onBlock: (domain: string) => void;
  onAllow: (domain: string) => void;
  onReplay?: (domain: string, type: string) => void;
}

export function QueryLog({ queries, clientNames = {}, onBlock, onAllow, onReplay }: QueryLogProps) {
  const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) {
      return seconds <= 0 ? 'just now' : `${seconds}s ago`;
    } else if (minutes < 60) {
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else if (days < 7) {
      return `${days}d ago`;
    } else {
      // For older than a week, show the date
      const date = new Date(timestamp);
      return date.toLocaleDateString();
    }
  };

  const formatFullTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <Panel className="overflow-hidden" padding="none">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-black">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Recent Queries</h2>
      </div>
      <DataTable
        columns={[
          {
            header: "Time",
            accessor: (row) => (
              <span 
                title={formatFullTime(row.timestamp)}
                className="cursor-help whitespace-nowrap text-gray-600 dark:text-gray-400"
              >
                {formatRelativeTime(row.timestamp)}
              </span>
            ),
            className: "whitespace-nowrap",
          },
          {
            header: "Host",
            accessor: (row) => {
              if (!row.clientIp) return <span className="text-gray-600 dark:text-gray-400">-</span>;
              return clientNames[row.clientIp] ? (
                <>
                  <div className="text-gray-900 dark:text-white font-medium">
                    {clientNames[row.clientIp]}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400 text-xs font-mono">
                    {row.clientIp}
                  </div>
                </>
              ) : (
                <span className="text-gray-700 dark:text-gray-300 font-mono">{row.clientIp}</span>
              );
            },
            className: "whitespace-nowrap",
            hideOnMobile: true,
          },
          {
            header: "Domain",
            accessor: (row) => (
              <>
                <div className="flex items-center gap-2">
                  <div className="min-w-[120px] max-w-[180px] sm:max-w-[250px] md:max-w-none truncate text-sm text-gray-800 dark:text-gray-200 font-mono">
                    {row.domain}
                  </div>
                  {onReplay && (
                    <button
                      onClick={() => onReplay(row.domain, row.type)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                      title="Replay this query"
                    >
                      Replay
                    </button>
                  )}
                </div>
                {/* Show host on mobile */}
                <div className="sm:hidden mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {row.clientIp ? (
                    clientNames[row.clientIp] ? (
                      <span>{clientNames[row.clientIp]} ({row.clientIp})</span>
                    ) : (
                      <span>{row.clientIp}</span>
                    )
                  ) : (
                    <span>-</span>
                  )}
                </div>
              </>
            ),
          },
          {
            header: "Type",
            accessor: "type",
            className: "whitespace-nowrap text-gray-600 dark:text-gray-400",
            hideOnMobile: true,
          },
          {
            header: "Status",
            accessor: (row) => {
              if (row.blocked) {
                return <Badge color="red">Blocked</Badge>;
              }
              return <Badge color="green">Allowed</Badge>;
            },
            className: "whitespace-nowrap",
          },
          {
            header: "Cached",
            accessor: (row) => {
              if (row.cached) {
                return <Badge color="orange">Cached</Badge>;
              }
              return <span className="text-gray-500 dark:text-gray-500">-</span>;
            },
            className: "whitespace-nowrap",
            hideOnMobile: true,
          },
          {
            header: "Response",
            accessor: (row) => row.responseTime ? `${row.responseTime}ms` : '-',
            className: "whitespace-nowrap text-gray-600 dark:text-gray-400",
            hideOnMobile: true,
          },
        ]}
        data={queries}
        actions={(row) => [
          row.blocked
            ? {
                title: "Allow",
                color: "green" as const,
                onClick: () => onAllow(row.domain),
              }
            : {
                title: "Block",
                color: "red" as const,
                onClick: () => onBlock(row.domain),
              },
        ]}
        emptyMessage="No queries"
        getRowKey={(row) => row.id}
      />
    </Panel>
  );
}
