import { useState, useEffect } from "react";
import { useBlockingStatus, useEnableBlocking, useDisableBlocking } from "../hooks/useBlocking";
import { cn } from "../lib/cn";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";

const QUICK_OPTIONS = [
  { label: "10 seconds", seconds: 10 },
  { label: "30 seconds", seconds: 30 },
  { label: "5 minutes", seconds: 300 },
  { label: "10 minutes", seconds: 600 },
  { label: "30 minutes", seconds: 1800 },
  { label: "1 hour", seconds: 3600 },
  { label: "Indefinitely", seconds: null },
];

export function Disable() {
  const { data: status, isLoading } = useBlockingStatus();
  const enableBlocking = useEnableBlocking();
  const disableBlocking = useDisableBlocking();

  const [customSeconds, setCustomSeconds] = useState("");
  const [remainingTime, setRemainingTime] = useState<number | null>(null);

  useEffect(() => {
    if (status?.disabledUntil) {
      const updateRemaining = () => {
        const remaining = Math.max(0, Math.floor((status.disabledUntil! - Date.now()) / 1000));
        setRemainingTime(remaining);
      };
      updateRemaining();
      const interval = setInterval(updateRemaining, 1000);
      return () => clearInterval(interval);
    } else {
      setRemainingTime(null);
    }
  }, [status?.disabledUntil]);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  const handleCustomDisable = () => {
    const seconds = parseInt(customSeconds, 10);
    if (!isNaN(seconds) && seconds > 0) {
      disableBlocking.mutate(seconds);
      setCustomSeconds("");
    }
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  const isDisabled = !status?.enabled || status?.isTemporarilyDisabled;

  return (
    <>
      <PageHeader
        title="Disable Blocking"
        description="Temporarily disable DNS blocking"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "px-4 py-2 rounded-lg font-medium",
              isDisabled
                ? "bg-red-900/50 text-red-300 border border-red-700"
                : "bg-green-900/50 text-green-300 border border-green-700"
            )}
          >
            {isDisabled ? "Blocking Disabled" : "Blocking Enabled"}
          </div>
        </div>
      </PageHeader>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {status?.isTemporarilyDisabled && remainingTime !== null && (
          <div className="mb-6 bg-yellow-900/30 border border-yellow-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-yellow-300">
                  Blocking will re-enable automatically
                </h3>
                <p className="text-yellow-400 text-sm mt-1">
                  Time remaining: <span className="font-mono font-bold">{formatTime(remainingTime)}</span>
                </p>
              </div>
              <Button
                onClick={() => enableBlocking.mutate()}
                color="green"
              >
                Re-enable Now
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Enable Blocking */}
          <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-white mb-4">Enable Blocking</h2>
            <p className="text-gray-400 text-sm mb-6">
              Re-enable DNS blocking to start blocking ads and trackers again.
            </p>
            <Button
              onClick={() => enableBlocking.mutate()}
              disabled={enableBlocking.isPending || (status?.enabled && !status?.isTemporarilyDisabled)}
              color="green"
              className="w-full"
            >
              {enableBlocking.isPending ? "Enabling..." : "Enable Blocking"}
            </Button>
          </div>

          {/* Disable Blocking */}
          <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-white mb-4">Disable Blocking</h2>
            <p className="text-gray-400 text-sm mb-6">
              Temporarily disable DNS blocking. Choose a duration or disable indefinitely.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {QUICK_OPTIONS.map((option) => (
                  <Button
                    key={option.label}
                    onClick={() => disableBlocking.mutate(option.seconds ?? undefined)}
                    disabled={disableBlocking.isPending}
                    color="gray"
                    size="sm"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>

              <div className="pt-4 border-t border-gray-700">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Custom Duration (seconds)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={customSeconds}
                    onChange={(e) => setCustomSeconds(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCustomDisable()}
                    placeholder="e.g., 120"
                    min="1"
                    className="flex-1"
                  />
                  <Button
                    onClick={handleCustomDisable}
                    disabled={disableBlocking.isPending || !customSeconds || parseInt(customSeconds, 10) <= 0}
                  >
                    Disable
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-white mb-4">Current Status</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Blocking Status:</span>
              <span className={cn(
                "font-medium",
                status?.enabled ? "text-green-300" : "text-red-300"
              )}>
                {status?.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            {status?.disabledUntil && (
              <div className="flex justify-between">
                <span className="text-gray-400">Disabled Until:</span>
                <span className="text-gray-300 font-mono">
                  {new Date(status.disabledUntil).toLocaleString()}
                </span>
              </div>
            )}
            {status?.isTemporarilyDisabled && remainingTime !== null && (
              <div className="flex justify-between">
                <span className="text-gray-400">Time Remaining:</span>
                <span className="text-gray-300 font-mono font-bold">
                  {formatTime(remainingTime)}
                </span>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

