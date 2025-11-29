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
  const [domainPattern, setDomainPattern] = useState('');
  const [cached, setCached] = useState<boolean | undefined>(undefined);
  const [blockReason, setBlockReason] = useState<string>('');
  const [minResponseTime, setMinResponseTime] = useState<string>('');
  const [maxResponseTime, setMaxResponseTime] = useState<string>('');
  const [blockReasons, setBlockReasons] = useState<string[]>([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [realTimeEnabled, setRealTimeEnabled] = useState(false);
  const [queries, setQueries] = useState<DNSQuery[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastQueryIdRef = useRef<string | null>(null);

  const startTime = startDate ? new Date(startDate).getTime() : undefined;
  const endTime = endDate ? new Date(endDate).getTime() + 86400000 - 1 : undefined; // End of day

  // Load block reasons on mount
  useEffect(() => {
    api.getBlockReasons().then(setBlockReasons).catch(console.error);
  }, []);

  const { data: initialQueries = [], isLoading: queriesLoading } = useQueries({
    limit: 1000,
    clientIp,
    filters: {
      type: type || undefined,
      blocked,
      startTime,
      endTime,
      domain: domainSearch || undefined,
      domainPattern: domainPattern || undefined,
      cached,
      blockReason: blockReason || undefined,
      minResponseTime: minResponseTime ? parseInt(minResponseTime, 10) : undefined,
      maxResponseTime: maxResponseTime ? parseInt(maxResponseTime, 10) : undefined,
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
                  domainPattern: domainPattern || undefined,
                  cached,
                  blockReason: blockReason || undefined,
                  minResponseTime: minResponseTime ? parseInt(minResponseTime, 10) : undefined,
                  maxResponseTime: maxResponseTime ? parseInt(maxResponseTime, 10) : undefined,
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
                  domainPattern: domainPattern || undefined,
                  cached,
                  blockReason: blockReason || undefined,
                  minResponseTime: minResponseTime ? parseInt(minResponseTime, 10) : undefined,
                  maxResponseTime: maxResponseTime ? parseInt(maxResponseTime, 10) : undefined,
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0 mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h2>
            <Button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              variant="ghost"
              size="sm"
            >
              {showAdvancedFilters ? 'Hide Advanced' : 'Show Advanced'}
            </Button>
          </div>

          {/* Basic Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
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
                  "w-full h-10 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
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
                  "w-full h-10 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
              >
                <option value="">All</option>
                <option value="blocked">Blocked</option>
                <option value="allowed">Allowed</option>
              </select>
            </div>
            <div className="sm:col-span-2 xl:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Date Range
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  placeholder="Start"
                  className={cn(
                    "flex-1 min-w-44 h-10 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500"
                  )}
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  placeholder="End"
                  className={cn(
                    "flex-1 min-w-44 h-10 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500"
                  )}
                />
              </div>
            </div>
          </div>

          {/* Advanced Filters (Collapsible) */}
          {showAdvancedFilters && (
            <>
              <div className="border-t border-gray-200 dark:border-gray-700 my-4"></div>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Advanced Filters</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Domain Pattern
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">(wildcards: *.example.com)</span>
                  </label>
                  <SearchInput
                    value={domainPattern}
                    onChange={setDomainPattern}
                    placeholder="*.example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Cached
                  </label>
                  <select
                    value={cached === undefined ? '' : cached ? 'yes' : 'no'}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCached(value === '' ? undefined : value === 'yes');
                    }}
                    className={cn(
                      "w-full h-10 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500"
                    )}
                  >
                    <option value="">All</option>
                    <option value="yes">Cached</option>
                    <option value="no">Not Cached</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Block Reason
                  </label>
                  <select
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    className={cn(
                      "w-full h-10 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500"
                    )}
                  >
                    <option value="">All Reasons</option>
                    {blockReasons.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 xl:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Response Time (ms)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={minResponseTime}
                      onChange={(e) => setMinResponseTime(e.target.value)}
                      placeholder="Min"
                      className={cn(
                        "flex-1 min-w-[80px] h-10 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500"
                      )}
                    />
                    <input
                      type="number"
                      value={maxResponseTime}
                      onChange={(e) => setMaxResponseTime(e.target.value)}
                      placeholder="Max"
                      className={cn(
                        "flex-1 min-w-[80px] h-10 px-4 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500"
                      )}
                    />
                  </div>
                </div>
                </div>
              </div>
            </>
          )}

          {/* Clear Filters Button */}
          {(type || blocked !== undefined || startDate || endDate || domainSearch || domainPattern || cached !== undefined || blockReason || minResponseTime || maxResponseTime) && (
            <div className="mt-4">
              <Button
                onClick={() => {
                  setType('');
                  setBlocked(undefined);
                  setStartDate('');
                  setEndDate('');
                  setDomainSearch('');
                  setDomainPattern('');
                  setCached(undefined);
                  setBlockReason('');
                  setMinResponseTime('');
                  setMaxResponseTime('');
                }}
                color="gray"
                variant="outline"
                size="sm"
              >
                Clear All Filters
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

