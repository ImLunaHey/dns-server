import { useState } from 'react';
import { cn } from '../lib/cn';

interface SidebarProps {
  topClients: Array<{ clientIp: string; count: number }>;
  queries: Array<{ clientIp?: string; blocked: boolean }>;
  onClientSelect?: (clientIp: string | null) => void;
}

export function Sidebar({ topClients, queries, onClientSelect }: SidebarProps) {
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  const handleClientClick = (clientIp: string) => {
    const newSelection = selectedClient === clientIp ? null : clientIp;
    setSelectedClient(newSelection);
    onClientSelect?.(newSelection);
  };

  const getClientStats = (clientIp: string) => {
    const clientQueries = queries.filter(q => q.clientIp === clientIp);
    const blocked = clientQueries.filter(q => q.blocked).length;
    const allowed = clientQueries.filter(q => !q.blocked).length;
    return { total: clientQueries.length, blocked, allowed };
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'fixed left-0 top-0 z-40 h-full w-12 bg-white dark:bg-black border-r border-gray-200 dark:border-gray-700',
          'flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
          'md:block'
        )}
        aria-label="Open sidebar"
      >
        <svg
          className="w-6 h-6 text-gray-600 dark:text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
    );
  }

  return (
    <>
      {/* Overlay for mobile */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-30 md:hidden',
          'transition-opacity'
        )}
        onClick={() => {
          setIsOpen(false);
          setSelectedClient(null);
          onClientSelect?.(null);
        }}
      />

      <aside className={cn(
        'fixed left-0 top-0 z-40 h-screen w-64 bg-white dark:bg-black border-r border-gray-200 dark:border-gray-700',
        'flex flex-col transition-transform overflow-hidden',
        'shadow-xl md:shadow-none'
      )}>
      <div className={cn(
        'flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'
      )}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Clients</h2>
        <button
          onClick={() => {
            setIsOpen(false);
            setSelectedClient(null);
            onClientSelect?.(null);
          }}
          className={cn(
            'p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors'
          )}
          aria-label="Close sidebar"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          <button
            onClick={() => {
              setSelectedClient(null);
              onClientSelect?.(null);
            }}
            className={cn(
              'w-full text-left px-3 py-2 rounded-lg transition-colors',
              selectedClient === null
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
            )}
          >
            <div className="font-medium">All Clients</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              {topClients.reduce((sum, c) => sum + c.count, 0).toLocaleString()} queries
            </div>
          </button>

          {topClients.map(({ clientIp, count }) => {
            const stats = getClientStats(clientIp);
            const isSelected = selectedClient === clientIp;

            return (
              <button
                key={clientIp}
                onClick={() => handleClientClick(clientIp)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg transition-colors',
                  isSelected
                    ? 'bg-slate-200 dark:bg-purple-900/50 border border-slate-300 dark:border-purple-700 text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-transparent'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-sm font-medium truncate">
                    {clientIp}
                  </div>
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 ml-2">
                    {count.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-600 dark:text-gray-400">
                  <span className={cn(
                    'px-1.5 py-0.5 rounded',
                    'bg-red-900/30 text-red-300 border border-red-700/50'
                  )}>
                    {stats.blocked} blocked
                  </span>
                  <span className={cn(
                    'px-1.5 py-0.5 rounded',
                    'bg-green-900/30 text-green-300 border border-green-700/50'
                  )}>
                    {stats.allowed} allowed
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
    </>
  );
}

