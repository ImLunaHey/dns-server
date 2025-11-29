import { useState, useEffect, useRef } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQueries } from '../hooks/useQueries';
import { useBlockDomain, useAllowDomain } from '../hooks/useBlocklistMutations';
import { useClientNames } from '../hooks/useClientNames';
import { QueryLog } from '../components/QueryLog';
import { Panel } from '../components/Panel';
import { cn } from '../lib/cn';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { SearchInput } from '../components/SearchInput';
import { Button } from '../components/Button';
import { api } from '../lib/api';
import { DNSQuery } from '../lib/api';

export function QueryLogPage() {
  const search = useSearch({ from: '/queries' });
  const clientIp = search.clientIp as string | undefined;

  const [type, setType] = useState<string>('');
  const [blocked, setBlocked] = useState<boolean | undefined>(undefined);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [domainSearch, setDomainSearch] = useState('');
  const [realTimeEnabled, setRealTimeEnabled] = useState(false);
  const [queries, setQueries] = useState<DNSQuery[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastQueryIdRef = useRef<string | null>(null);

  const startTime = startDate ? new Date(startDate).getTime() : undefined;
  const endTime = endDate ? new Date(endDate).getTime() + 86400000 - 1 : undefined; // End of day

  const { data: initialQueries = [], isLoading: queriesLoading } = useQueries({
    limit: 1000,
    clientIp,
    filters: {
      type: type || undefined,
      blocked,
      startTime,
      endTime,
      domain: domainSearch || undefined,
    },
    enabled: !realTimeEnabled, // Only fetch when real-time is disabled
  });

  // Initialize queries from initial fetch
  useEffect(() => {
    if (!realTimeEnabled && initialQueries.length > 0) {
      setQueries(initialQueries);
      lastQueryIdRef.current = initialQueries[0]?.id || null;
    }
  }, [initialQueries, realTimeEnabled]);

  // Real-time streaming
  useEffect(() => {
    if (!realTimeEnabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    const params = new URLSearchParams();
    if (clientIp) params.append('clientIp', clientIp);
    if (type) params.append('type', type);
    if (blocked !== undefined) params.append('blocked', blocked.toString());
    if (domainSearch) params.append('domain', domainSearch);

    const eventSource = new EventSource(`/api/queries/stream?${params}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'queries' && Array.isArray(data.queries)) {
          setQueries((prev) => {
            const newQueries = data.queries.filter(
              (q: DNSQuery) => !prev.some((p) => p.id === q.id)
            );
            return [...newQueries, ...prev].slice(0, 1000);
          });
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    eventSource.onerror = () => {
      console.error('SSE connection error');
      eventSource.close();
      eventSourceRef.current = null;
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [realTimeEnabled, clientIp, type, blocked, domainSearch]);

  const { data: clientNames = {} } = useClientNames();

  const blockMutation = useBlockDomain();
  const allowMutation = useAllowDomain();

  const handleBlock = (domain: string) => {
    blockMutation.mutate(domain);
  };

  const handleAllow = (domain: string) => {
    allowMutation.mutate(domain);
  };

  const loading = queriesLoading && !realTimeEnabled;

  if (loading) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Query Log"
        description={clientIp ? `Viewing queries from ${clientIp}` : 'All DNS queries'}
      >
        <div className="flex gap-2">
          <Button
            onClick={() => setRealTimeEnabled(!realTimeEnabled)}
            variant={realTimeEnabled ? "solid" : "outline"}
          >
            {realTimeEnabled ? "⏸ Stop Live" : "▶ Start Live"}
          </Button>
          <Button
            onClick={async () => {
              if (confirm('Archive queries older than 7 days? This will remove them from the active log.')) {
                try {
                  const result = await api.archiveQueries(7, true);
                  alert(`Archived ${result.archived} queries`);
                } catch (error) {
                  alert('Failed to archive queries');
                }
              }
            }}
            variant="outline"
          >
            Archive Old Queries
          </Button>
          <Button
            onClick={async () => {
              try {
                const filters = {
                  clientIp,
                  type: type || undefined,
                  blocked,
                  startTime,
                  endTime,
                  domain: domainSearch || undefined,
                };
                const blob = await api.exportQueriesCSV(filters);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dns-queries-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                alert(error instanceof Error ? error.message : 'Failed to export queries');
              }
            }}
            variant="outline"
          >
            Export CSV
          </Button>
          <Button
            onClick={async () => {
              try {
                const filters = {
                  clientIp,
                  type: type || undefined,
                  blocked,
                  startTime,
                  endTime,
                  domain: domainSearch || undefined,
                };
                const blob = await api.exportQueriesJSON(filters);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dns-queries-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                alert(error instanceof Error ? error.message : 'Failed to export queries');
              }
            }}
            variant="outline"
          >
            Export JSON
          </Button>
        </div>
      </PageHeader>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <Panel className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Domain Search
              </label>
              <SearchInput
                value={domainSearch}
                onChange={setDomainSearch}
                placeholder="Search domains..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Query Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={cn(
                  "w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
              >
                <option value="">All Types</option>
                <option value="A">A</option>
                <option value="AAAA">AAAA</option>
                <option value="MX">MX</option>
                <option value="TXT">TXT</option>
                <option value="CNAME">CNAME</option>
                <option value="NS">NS</option>
                <option value="PTR">PTR</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <select
                value={blocked === undefined ? '' : blocked ? 'blocked' : 'allowed'}
                onChange={(e) => {
                  const value = e.target.value;
                  setBlocked(value === '' ? undefined : value === 'blocked');
                }}
                className={cn(
                  "w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
              >
                <option value="">All</option>
                <option value="blocked">Blocked</option>
                <option value="allowed">Allowed</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={cn(
                  "w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={cn(
                  "w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
              />
            </div>
          </div>

              {(type || blocked !== undefined || startDate || endDate || domainSearch) && (
                <div className="mt-4">
                  <Button
                    onClick={() => {
                      setType('');
                      setBlocked(undefined);
                      setStartDate('');
                      setEndDate('');
                      setDomainSearch('');
                    }}
                    color="gray"
                    variant="outline"
                  >
                    Clear Filters
                  </Button>
                </div>
              )}
        </Panel>

        <QueryLog 
          queries={queries} 
          clientNames={clientNames}
          onBlock={handleBlock} 
          onAllow={handleAllow} 
        />
      </main>
    </>
  );
}

