import { useState } from "react";
import { useAdlists, useAddAdlist, useRemoveAdlist, useUpdateBlocklists, useBlocklistUpdateStatus } from "../hooks/useAdlists";
import { cn } from "../lib/cn";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/Table";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";

export function Adlists() {
  const { data, isLoading } = useAdlists();
  const addAdlist = useAddAdlist();
  const removeAdlist = useRemoveAdlist();
  const updateBlocklists = useUpdateBlocklists();
  const { data: updateStatus } = useBlocklistUpdateStatus();
  const [newUrl, setNewUrl] = useState("");

  const handleAdd = () => {
    if (newUrl.trim()) {
      addAdlist.mutate(newUrl.trim());
      setNewUrl("");
    }
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  const adlists = data?.adlists || [];
  const activeUrls = data?.activeUrls || [];

  return (
    <>
      <PageHeader
        title="Adlists"
        description="Manage ad-blocking lists"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Update Status */}
        {updateStatus && (
          <Panel className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Blocklist Update Status
                </h3>
                <div className="space-y-1">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Status: <span className={cn(
                      "font-medium",
                      updateStatus.status === 'running' && "text-blue-600 dark:text-blue-400",
                      updateStatus.status === 'completed' && "text-green-600 dark:text-green-400",
                      updateStatus.status === 'failed' && "text-red-600 dark:text-red-400"
                    )}>
                      {updateStatus.status === 'running' && '⏳ Running...'}
                      {updateStatus.status === 'completed' && '✅ Completed'}
                      {updateStatus.status === 'failed' && '❌ Failed'}
                    </span>
                  </p>
                  {updateStatus.status === 'completed' && updateStatus.domainsAdded !== undefined && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Domains added: {updateStatus.domainsAdded.toLocaleString()}
                    </p>
                  )}
                  {updateStatus.status === 'failed' && updateStatus.error && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Error: {updateStatus.error}
                    </p>
                  )}
                  {updateStatus.completedAt && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Last updated: {new Date(updateStatus.completedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
              <Button
                onClick={() => updateBlocklists.mutate()}
                disabled={updateBlocklists.isPending || updateStatus?.status === 'running'}
              >
                {updateBlocklists.isPending || updateStatus?.status === 'running' ? 'Updating...' : 'Update Blocklists'}
              </Button>
            </div>
          </Panel>
        )}

        <Panel className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add New Adlist</h2>
          <div className="flex gap-2">
            <Input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="https://example.com/blocklist.txt"
              className="flex-1"
            />
            <Button
              onClick={handleAdd}
              disabled={addAdlist.isPending}
            >
              Add
            </Button>
          </div>
        </Panel>

        <Panel className="overflow-hidden" padding="none">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-black">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Active Adlists</h2>
          </div>
          <DataTable
            columns={[
              {
                header: "URL",
                accessor: (row) => {
                  const adlist = adlists.find((a) => a.url === row);
                  return (
                    <>
                      <div className="text-sm text-gray-900 dark:text-gray-200 break-all">
                        {row}
                      </div>
                      {adlist && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          Added: {new Date(adlist.addedAt).toLocaleDateString()}
                        </div>
                      )}
                    </>
                  );
                },
              },
              {
                header: "Status",
                accessor: (row) => {
                  const adlist = adlists.find((a) => a.url === row);
                  const isActive = adlist?.enabled !== false;
                  return isActive ? (
                    <Badge color="green">Active</Badge>
                  ) : (
                    <Badge color="gray">Disabled</Badge>
                  );
                },
                className: "whitespace-nowrap",
              },
            ]}
            data={activeUrls}
            actions={(url) => [
              {
                title: "Remove",
                color: "red" as const,
                onClick: () => removeAdlist.mutate(url),
                disabled: removeAdlist.isPending,
              },
            ]}
            emptyMessage="No adlists configured"
            getRowKey={(url) => url}
          />
        </Panel>
      </main>
    </>
  );
}

