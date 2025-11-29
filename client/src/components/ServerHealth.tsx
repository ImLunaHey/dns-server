import { ServerHealth } from "../lib/api";
import { Panel } from "./Panel";
import { useState, useEffect } from "react";

interface ServerHealthProps {
  health: ServerHealth;
}

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

export function ServerHealthComponent({ health }: ServerHealthProps) {
  const [uptimeFormatted, setUptimeFormatted] = useState<string>('');

  useEffect(() => {
    // Calculate uptime on client side for smooth updates
    const updateUptime = () => {
      if (health.startTime) {
        const startTime = new Date(health.startTime).getTime();
        const uptime = Date.now() - startTime;
        setUptimeFormatted(formatUptime(uptime));
      }
    };

    // Update immediately
    updateUptime();

    // Update every second for smooth animation
    const interval = setInterval(updateUptime, 1000);

    return () => clearInterval(interval);
  }, [health.startTime]);
  const statusColors = {
    healthy: "bg-green-500",
    degraded: "bg-yellow-500",
    unhealthy: "bg-red-500",
  };

  const statusLabels = {
    healthy: "Healthy",
    degraded: "Degraded",
    unhealthy: "Unhealthy",
  };

  const serverStatus = (enabled: boolean) => (
    <span
      className={`inline-flex items-center ${
        enabled ? "text-green-600 dark:text-green-400" : "text-gray-400"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full mr-2 ${
          enabled ? "bg-green-500" : "bg-gray-400"
        }`}
      />
      {enabled ? "Active" : "Inactive"}
    </span>
  );

  return (
    <Panel padding="none">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Server Health
          </h3>
          <div className="flex items-center space-x-2">
            <div
              className={`w-3 h-3 rounded-full ${statusColors[health.status]} ${
                health.status === "healthy" ? "animate-pulse" : ""
              }`}
            />
            <span
              className={`text-sm font-medium ${
                health.status === "healthy"
                  ? "text-green-600 dark:text-green-400"
                  : health.status === "degraded"
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {statusLabels[health.status]}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Uptime
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {uptimeFormatted}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Queries/sec
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {health.queriesPerSecond}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Total Queries
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {health.queryCount.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Error Rate
            </div>
            <div
              className={`text-lg font-semibold ${
                health.errorRate > 5
                  ? "text-red-600 dark:text-red-400"
                  : health.errorRate > 1
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-gray-900 dark:text-white"
              }`}
            >
              {health.errorRate.toFixed(2)}%
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Server Status
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                UDP DNS
              </span>
              {serverStatus(health.servers.udp)}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                TCP DNS
              </span>
              {serverStatus(health.servers.tcp)}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                DNS-over-TLS
              </span>
              {serverStatus(health.servers.dot)}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                DNS-over-HTTPS
              </span>
              {serverStatus(health.servers.doh)}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
