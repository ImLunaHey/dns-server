import { useHealth } from '../hooks/useHealth';
import { ServerHealthComponent } from '../components/ServerHealth';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
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
  const { data: health, isLoading } = useHealth();
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

  if (isLoading) {
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
        <ServerHealthComponent health={health} />
      </main>
    </>
  );
}

