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
import {
  useClientUpstreamDNS,
  useSetClientUpstreamDNS,
  useDeleteClientUpstreamDNS,
} from "../hooks/useClientUpstreamDNS";
import { useModalManager } from "../contexts/ModalContext";
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
  const modalManager = useModalManager();

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
                    navigate({
                      to: "/clients/$clientIp/stats",
                      params: { clientIp },
                    });
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
                  title: "Blocking Rules",
                  color: "purple" as const,
                  onClick: () => {
                    const modalId = `blocking-rules-${clientIp}`;
                    modalManager.add(
                      modalId,
                      () => <ClientBlockingRulesModal clientIp={clientIp} />,
                      { size: "lg" }
                    );
                  },
                },
                {
                  title: "Upstream DNS",
                  color: "yellow" as const,
                  onClick: () => {
                    const modalId = `upstream-dns-${clientIp}`;
                    modalManager.add(
                      modalId,
                      () => <ClientUpstreamDNSModal clientIp={clientIp} />,
                      { size: "md" }
                    );
                  },
                },
              ];
            }}
            emptyMessage="No clients found"
            getRowKey={(row) => row.clientIp}
          />
        </Panel>
      </main>
    </>
  );
}

function ClientBlockingRulesModal({ clientIp }: { clientIp: string }) {
  const { data, isLoading } = useClientBlocking(clientIp);
  const updateBlocking = useUpdateClientBlocking();
  const addAllowlist = useAddClientAllowlist();
  const removeAllowlist = useRemoveClientAllowlist();
  const addBlocklist = useAddClientBlocklist();
  const removeBlocklist = useRemoveClientBlocklist();

  if (isLoading || !data) {
    return (
      <div className="py-8">
        <Loading text="Loading blocking rules..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Blocking Rules for {clientIp}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configure blocking rules for this specific client
        </p>
      </div>
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
      />
    </div>
  );
}

function ClientUpstreamDNSModal({ clientIp }: { clientIp: string }) {
  const { data, isLoading } = useClientUpstreamDNS(clientIp);
  const deleteUpstreamDNS = useDeleteClientUpstreamDNS();
  const modalManager = useModalManager();

  if (isLoading || !data) {
    return (
      <div className="py-8">
        <Loading text="Loading upstream DNS..." />
      </div>
    );
  }

  const currentUpstreamDNS = data.upstreamDNS;

  const handleEdit = () => {
    const modalId = `edit-upstream-dns-${clientIp}`;
    modalManager.add(
      modalId,
      () => (
        <EditUpstreamDNSModal
          clientIp={clientIp}
          currentValue={currentUpstreamDNS || ""}
        />
      ),
      { size: "md" }
    );
  };

  const handleDelete = () => {
    const modalId = `delete-upstream-dns-${clientIp}`;
    modalManager.add(
      modalId,
      () => <DeleteUpstreamDNSModal clientIp={clientIp} />,
      { size: "sm" }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Upstream DNS for {clientIp}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configure a custom upstream DNS server for this client. This takes
          priority over global upstream DNS and conditional forwarding.
        </p>
      </div>
      {currentUpstreamDNS ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Current Upstream DNS:
            </label>
            <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded font-mono text-sm text-gray-900 dark:text-white">
              {currentUpstreamDNS}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleEdit}
              className={cn(
                "px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
              )}
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteUpstreamDNS.isPending}
              className={cn(
                "px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No custom upstream DNS configured. This client will use the global
            upstream DNS or conditional forwarding rules.
          </p>
          <button
            onClick={handleEdit}
            className={cn(
              "px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
            )}
          >
            Set Upstream DNS
          </button>
        </div>
      )}
    </div>
  );
}

function EditUpstreamDNSModal({
  clientIp,
  currentValue,
}: {
  clientIp: string;
  currentValue: string;
}) {
  const setUpstreamDNS = useSetClientUpstreamDNS();
  const modalManager = useModalManager();
  const [upstreamDNSValue, setUpstreamDNSValue] = useState(currentValue);

  const handleSave = () => {
    if (upstreamDNSValue.trim()) {
      setUpstreamDNS.mutate(
        { clientIp, upstreamDNS: upstreamDNSValue.trim() },
        {
          onSuccess: () => {
            modalManager.remove(`edit-upstream-dns-${clientIp}`);
          },
        }
      );
    }
  };

  const handleCancel = () => {
    modalManager.remove(`edit-upstream-dns-${clientIp}`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Edit Upstream DNS
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configure a custom upstream DNS server for {clientIp}
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Upstream DNS Server(s)
        </label>
        <input
          type="text"
          value={upstreamDNSValue}
          onChange={(e) => setUpstreamDNSValue(e.target.value)}
          placeholder="1.1.1.1 or 1.1.1.1,8.8.8.8,9.9.9.9 (comma-separated for failover)"
          className={cn(
            "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
            "focus:outline-none focus:ring-2 focus:ring-blue-500"
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          autoFocus
        />
        <p className="text-xs text-gray-400 mt-1">
          IP address(es) of upstream DNS server(s). Multiple servers can be
          comma-separated for automatic failover. Supports IP addresses, DoH
          (https://), and DoT (tls://) URLs.
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={handleCancel}
          disabled={setUpstreamDNS.isPending}
          className={cn(
            "px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={setUpstreamDNS.isPending || !upstreamDNSValue.trim()}
          className={cn(
            "px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function DeleteUpstreamDNSModal({ clientIp }: { clientIp: string }) {
  const deleteUpstreamDNS = useDeleteClientUpstreamDNS();
  const modalManager = useModalManager();

  const handleDelete = () => {
    deleteUpstreamDNS.mutate(
      { clientIp },
      {
        onSuccess: () => {
          modalManager.remove(`delete-upstream-dns-${clientIp}`);
        },
      }
    );
  };

  const handleCancel = () => {
    modalManager.remove(`delete-upstream-dns-${clientIp}`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Remove Upstream DNS
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Are you sure you want to remove the custom upstream DNS configuration
          for {clientIp}? This client will use the global upstream DNS or
          conditional forwarding rules.
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={handleCancel}
          disabled={deleteUpstreamDNS.isPending}
          className={cn(
            "px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={deleteUpstreamDNS.isPending}
          className={cn(
            "px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
