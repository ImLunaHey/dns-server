import { useState } from "react";
import { useStats } from "../hooks/useStats";
import { useQueries } from "../hooks/useQueries";
import {
  useClientNames,
  useSetClientName,
  useDeleteClientName,
} from "../hooks/useClientNames";
import {
  useClientBlocking,
  useUpdateClientBlocking,
  useAddClientAllowlist,
  useRemoveClientAllowlist,
  useAddClientBlocklist,
  useRemoveClientBlocklist,
} from "../hooks/useClientBlocking";
import { cn } from "../lib/cn";
import { useNavigate } from "@tanstack/react-router";
import { Panel } from "../components/Panel";
import { BlockingRules } from "../components/BlockingRules";
import { DataTable } from "../components/Table";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";

export function Clients() {
  const navigate = useNavigate();
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: queries = [], isLoading: queriesLoading } = useQueries({
    limit: 1000,
  });
  const { data: clientNames = {}, isLoading: namesLoading } = useClientNames();
  const setClientName = useSetClientName();
  const deleteClientName = useDeleteClientName();
  const [editingClient, setEditingClient] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  const loading = statsLoading || queriesLoading || namesLoading;

  const handleEditName = (clientIp: string) => {
    setEditingClient(clientIp);
    setEditName(clientNames[clientIp] || "");
  };

  const handleSaveName = (clientIp: string) => {
    if (editName.trim()) {
      setClientName.mutate({ clientIp, name: editName.trim() });
    } else {
      deleteClientName.mutate(clientIp);
    }
    setEditingClient(null);
    setEditName("");
  };

  const handleCancelEdit = () => {
    setEditingClient(null);
    setEditName("");
  };

  if (loading) {
    return <Loading fullScreen />;
  }

  const getClientStats = (clientIp: string) => {
    const clientQueries = queries.filter((q) => q.clientIp === clientIp);
    const blocked = clientQueries.filter((q) => q.blocked).length;
    const allowed = clientQueries.filter((q) => !q.blocked).length;
    const total = clientQueries.length;
    return { total, blocked, allowed };
  };

  const topClients = stats?.topClientsArray || [];

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${topClients.length} active clients`}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Panel className="overflow-hidden" padding="none">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-black">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Active Clients
            </h2>
          </div>
          <DataTable
            columns={[
              {
                header: "Name / Client IP",
                accessor: (row) => {
                  const clientIp = row.clientIp;
                  return editingClient === clientIp ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveName(clientIp);
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        className="px-2 py-1 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm w-32"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSaveName(clientIp)}
                        className={cn(
                          "px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded text-white"
                        )}
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className={cn(
                          "px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded text-white"
                        )}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div>
                        {clientNames[clientIp] ? (
                          <div className="text-sm text-gray-900 dark:text-white font-medium">
                            {clientNames[clientIp]}
                          </div>
                        ) : null}
                        <div className="text-xs font-mono text-gray-600 dark:text-gray-400">
                          {clientIp}
                        </div>
                      </div>
                      <button
                        onClick={() => handleEditName(clientIp)}
                        className={cn(
                          "px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        )}
                        title="Edit name"
                      >
                        ✏️
                      </button>
                    </div>
                  );
                },
                className: "whitespace-nowrap",
              },
              {
                header: "Total Queries",
                accessor: (row) => row.count.toLocaleString(),
                className: "whitespace-nowrap",
              },
              {
                header: "Blocked",
                accessor: (row) => {
                  const stats = getClientStats(row.clientIp);
                  return stats.blocked.toLocaleString();
                },
                className: "whitespace-nowrap text-sm text-red-300",
              },
              {
                header: "Allowed",
                accessor: (row) => {
                  const stats = getClientStats(row.clientIp);
                  return stats.allowed.toLocaleString();
                },
                className: "whitespace-nowrap text-sm text-green-300",
              },
              {
                header: "Block Rate",
                accessor: (row) => {
                  const stats = getClientStats(row.clientIp);
                  const blockRate =
                    stats.total > 0
                      ? ((stats.blocked / stats.total) * 100).toFixed(1)
                      : "0";
                  return `${blockRate}%`;
                },
                className: "whitespace-nowrap",
              },
            ]}
            data={topClients}
            actions={(row) => {
              const clientIp = row.clientIp;
              return [
                {
                  title: "View Stats",
                  color: "green" as const,
                  onClick: () => {
                    navigate({ to: `/clients/${clientIp}/stats` });
                  },
                },
                {
                  title: "View Queries",
                  color: "blue" as const,
                  onClick: () => {
                    navigate({ to: "/queries", search: { clientIp } });
                  },
                },
                {
                  title:
                    selectedClient === clientIp
                      ? "Hide Rules"
                      : "Blocking Rules",
                  color: "purple" as const,
                  onClick: () =>
                    setSelectedClient(
                      selectedClient === clientIp ? null : clientIp
                    ),
                },
              ];
            }}
            emptyMessage="No clients found"
            getRowKey={(row) => row.clientIp}
          />
        </Panel>

        {/* Blocking Rules for Selected Client */}
        {selectedClient && <ClientBlockingRules clientIp={selectedClient} />}
      </main>
    </>
  );
}

function ClientBlockingRules({ clientIp }: { clientIp: string }) {
  const { data, isLoading } = useClientBlocking(clientIp);
  const updateBlocking = useUpdateClientBlocking();
  const addAllowlist = useAddClientAllowlist();
  const removeAllowlist = useRemoveClientAllowlist();
  const addBlocklist = useAddClientBlocklist();
  const removeBlocklist = useRemoveClientBlocklist();

  if (isLoading || !data) {
    return (
      <Panel className="mt-6">
        <Loading text="Loading blocking rules..." />
      </Panel>
    );
  }

  return (
    <div className="mt-6">
      <BlockingRules
        enabled={data.enabled}
        onToggleEnabled={(enabled) =>
          updateBlocking.mutate({ clientIp, enabled })
        }
        allowlist={data.allowlist}
        blocklist={data.blocklist}
        onAddAllowlist={(domain) => addAllowlist.mutate({ clientIp, domain })}
        onRemoveAllowlist={(domain) =>
          removeAllowlist.mutate({ clientIp, domain })
        }
        onAddBlocklist={(domain) => addBlocklist.mutate({ clientIp, domain })}
        onRemoveBlocklist={(domain) =>
          removeBlocklist.mutate({ clientIp, domain })
        }
        isLoading={
          updateBlocking.isPending ||
          addAllowlist.isPending ||
          removeAllowlist.isPending ||
          addBlocklist.isPending ||
          removeBlocklist.isPending
        }
        title={`Blocking Rules for ${clientIp}`}
      />
    </div>
  );
}
