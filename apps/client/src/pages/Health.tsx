import { useHealth } from '../hooks/useHealth';
import { useStats } from '../hooks/useStats';
import { ServerHealthComponent } from '../components/ServerHealth';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { useState, useEffect } from 'react';

function formatUptime(uptimeMs: number): string {
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const uptimeMinutes = Math.floor(uptimeSeconds / 60);
  const uptimeHours = Math.floor(uptimeMinutes / 60);
  const uptimeDays = Math.floor(uptimeHours / 24);
  
  if (uptimeDays > 0) {
    return `${uptimeDays}d ${uptimeHours % 24}h ${uptimeMinutes % 60}m`;
  } else if (uptimeHours > 0) {
    return `${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`;
  } else if (uptimeMinutes > 0) {
    return `${uptimeMinutes}m ${uptimeSeconds % 60}s`;
  } else {
    return `${uptimeSeconds}s`;
  }
}

export function Health() {
  const { data: health, isLoading: healthLoading } = useHealth();
  const { data: stats, isLoading: statsLoading } = useStats();
  const [currentUptime, setCurrentUptime] = useState<string>('');

  useEffect(() => {
    if (!health?.startTime) return;

    const updateUptime = () => {
      const startTime = new Date(health.startTime).getTime();
      const uptime = Date.now() - startTime;
      setCurrentUptime(formatUptime(uptime));
    };

    updateUptime();
    const interval = setInterval(updateUptime, 1000);

    return () => clearInterval(interval);
  }, [health?.startTime]);

  if (healthLoading || statsLoading) {
    return <Loading fullScreen />;
  }

  if (!health) {
    return (
      <>
        <PageHeader title="Server Health" description="DNS server operational status" />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
          <div className="text-center text-gray-500 dark:text-gray-400">
            Unable to load health information
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Server Health"
        description="DNS server operational status and monitoring"
      >
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${
            health.status === 'healthy' ? 'bg-green-500 animate-pulse' :
            health.status === 'degraded' ? 'bg-yellow-500' :
            'bg-red-500'
          }`} />
          <span className={`text-sm font-medium ${
            health.status === 'healthy' ? 'text-green-600 dark:text-green-400' :
            health.status === 'degraded' ? 'text-yellow-600 dark:text-yellow-400' :
            'text-red-600 dark:text-red-400'
          }`}>
            {health.status === 'healthy' ? 'Healthy' :
             health.status === 'degraded' ? 'Degraded' :
             'Unhealthy'}
          </span>
          {currentUptime && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              • {currentUptime}
            </span>
          )}
        </div>
      </PageHeader>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        <div className="space-y-6">
          <ServerHealthComponent health={health} />
          
          {/* Performance Metrics */}
          {stats?.performance && (
            <Panel>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Performance Metrics
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    Average Response Time
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {stats.performance.avgResponseTime !== null
                      ? `${stats.performance.avgResponseTime.toFixed(2)} ms`
                      : "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    P50 (Median)
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {stats.performance.p50 !== null
                      ? `${stats.performance.p50} ms`
                      : "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    P95
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {stats.performance.p95 !== null
                      ? `${stats.performance.p95} ms`
                      : "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    P99
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {stats.performance.p99 !== null
                      ? `${stats.performance.p99} ms`
                      : "N/A"}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    Min Response Time
                  </div>
                  <div className="text-base font-semibold text-gray-900 dark:text-white">
                    {stats.performance.minResponseTime !== null
                      ? `${stats.performance.minResponseTime} ms`
                      : "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    Max Response Time
                  </div>
                  <div className="text-base font-semibold text-gray-900 dark:text-white">
                    {stats.performance.maxResponseTime !== null
                      ? `${stats.performance.maxResponseTime} ms`
                      : "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    Cache Hit Rate
                  </div>
                  <div className="text-base font-semibold text-gray-900 dark:text-white">
                    {stats.performance.cacheHitRate.toFixed(2)}%
                  </div>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </main>
    </>
  );
}

