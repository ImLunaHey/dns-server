import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, DNSQuery, DNSStats } from './lib/api';
import { StatsCard } from './components/StatsCard';
import { QueryLog } from './components/QueryLog';
import { RankedList } from './components/RankedList';
import { QueryDistributionChart } from './components/QueryDistributionChart';
import { QueryTypesChart } from './components/QueryTypesChart';
import { QueriesOverTimeChart } from './components/QueriesOverTimeChart';
import { Sidebar } from './components/Sidebar';
import { useClientNames } from './hooks/useClientNames';

function App() {
  const queryClient = useQueryClient();
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<DNSStats>({
    queryKey: ['stats'],
    queryFn: () => api.getStats(),
    refetchInterval: 2000,
  });

  const { data: queries = [], isLoading: queriesLoading } = useQuery<DNSQuery[]>({
    queryKey: ['queries'],
    queryFn: () => api.getQueries(50),
    refetchInterval: 2000,
  });

  const { data: clientNames = {} } = useClientNames();

  const blockMutation = useMutation({
    mutationFn: (domain: string) => api.addToBlocklist(domain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['queries'] });
    },
  });

  const allowMutation = useMutation({
    mutationFn: (domain: string) => api.removeFromBlocklist(domain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['queries'] });
    },
  });

  const handleBlock = (domain: string) => {
    blockMutation.mutate(domain);
  };

  const handleAllow = (domain: string) => {
    allowMutation.mutate(domain);
  };

  const loading = statsLoading || queriesLoading;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-xl text-gray-400">Loading...</div>
      </div>
    );
  }

  const blockRate = stats
    ? ((stats.blockedQueries / stats.totalQueries) * 100).toFixed(1)
    : '0';

  const filteredQueries = selectedClient
    ? queries.filter(q => q.clientIp === selectedClient)
    : queries;

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <Sidebar
        topClients={stats?.topClientsArray || []}
        queries={queries}
        onClientSelect={setSelectedClient}
      />

      {/* Main Content Area */}
      <div className="flex-1 md:ml-64">
        {/* Header */}
        <header className="bg-black shadow-lg border-b border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-white">DNS Server</h1>
                <p className="text-gray-400 mt-1">
                  {selectedClient
                    ? `Viewing queries from ${selectedClient}`
                    : 'Ad-blocking DNS with real-time monitoring'}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                <span className="text-sm text-gray-300 font-medium">Active</span>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Total Queries"
            value={stats?.totalQueries.toLocaleString() || '0'}
            color="blue"
          />
          <StatsCard
            title="Blocked"
            value={stats?.blockedQueries.toLocaleString() || '0'}
            subtitle={`${blockRate}% of total`}
            color="red"
          />
          <StatsCard
            title="Allowed"
            value={stats?.allowedQueries.toLocaleString() || '0'}
            color="green"
          />
          <StatsCard
            title="Blocklist Size"
            value={stats?.blocklistSize.toLocaleString() || '0'}
            subtitle="domains blocked"
            color="purple"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <QueryDistributionChart
            blocked={filteredQueries.filter(q => q.blocked).length}
            allowed={filteredQueries.filter(q => !q.blocked).length}
          />
          <QueryTypesChart />
        </div>

        {/* Queries Over Time */}
        <div className="mb-8">
          <QueriesOverTimeChart queries={filteredQueries} />
        </div>

        {/* Top Domains */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <RankedList
            title="Top Queried Domains"
            items={(stats?.topDomainsArray || []).map(item => ({ label: item.domain, value: item.count }))}
            color="blue"
          />
          <RankedList
            title="Top Blocked Domains"
            items={(stats?.topBlockedArray || []).map(item => ({ label: item.domain, value: item.count }))}
            color="red"
          />
        </div>

        {/* Query Log */}
        <QueryLog 
          queries={filteredQueries} 
          clientNames={clientNames}
          onBlock={handleBlock} 
          onAllow={handleAllow} 
        />
        </main>
      </div>
    </div>
  );
}

export default App;
