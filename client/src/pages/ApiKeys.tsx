import { useState } from "react";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/Table";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Alert } from "../components/Alert";
import { CodeBlock } from "../components/CodeBlock";
import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  ApiKey,
} from "../hooks/useApiKeys";

export function ApiKeys() {
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiresIn, setNewKeyExpiresIn] = useState<number | undefined>(
    undefined
  );
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { data: keysList, isLoading } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const deleteApiKey = useDeleteApiKey();

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      setError("Name is required");
      return;
    }
    setError("");
    try {
      const result = await createApiKey.mutateAsync({
        name: newKeyName.trim(),
        expiresIn: newKeyExpiresIn ? newKeyExpiresIn * 24 * 60 * 60 : undefined, // Convert days to seconds
      });
      if (result?.key) {
        setCreatedKey(result.key);
        setNewKeyName("");
        setNewKeyExpiresIn(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    }
  };

  const handleDelete = async (keyId: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this API key? This action cannot be undone."
      )
    ) {
      return;
    }
    try {
      await deleteApiKey.mutateAsync({ keyId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete API key");
    }
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  const keys = keysList?.data || [];

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Manage API keys for programmatic access"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* New Key Creation */}
        <Panel className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Create New API Key
          </h2>
          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}
          {createdKey && (
            <Alert variant="success" className="mb-4">
              <p className="font-semibold mb-2">API Key Created Successfully!</p>
              <p className="text-sm mb-2">
                Save this key now - it will not be shown again:
              </p>
              <CodeBlock className="bg-white dark:bg-gray-800 border border-green-300 dark:border-green-700">
                <div className="text-sm break-all">
                  {createdKey}
                </div>
              </CodeBlock>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(createdKey);
                }}
                color="green"
                size="sm"
                className="mt-2"
              >
                Copy to Clipboard
              </Button>
              <Button
                onClick={() => setCreatedKey(null)}
                color="gray"
                variant="outline"
                size="sm"
                className="mt-2 ml-2"
              >
                Dismiss
              </Button>
            </Alert>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Name
              </label>
              <Input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production API Key"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Expires In (days, optional)
              </label>
              <Input
                type="number"
                value={newKeyExpiresIn || ""}
                onChange={(e) =>
                  setNewKeyExpiresIn(
                    e.target.value ? parseInt(e.target.value, 10) : undefined
                  )
                }
                placeholder="Leave empty for no expiration"
                min="1"
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={createApiKey.isPending || !newKeyName.trim()}
            >
              {createApiKey.isPending ? "Creating..." : "Create API Key"}
            </Button>
          </div>
        </Panel>

        {/* API Keys List */}
        <Panel className="overflow-hidden" padding="none">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-black">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Your API Keys
            </h2>
          </div>
          <DataTable
            columns={[
              {
                header: "Name",
                accessor: (row) => (
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-200">
                    {row.name || "Unnamed"}
                  </div>
                ),
              },
              {
                header: "Prefix",
                accessor: (row) => (
                  <code className="text-xs text-gray-600 dark:text-gray-400">
                    {row.start || row.prefix || "N/A"}
                  </code>
                ),
              },
              {
                header: "Status",
                accessor: (row) => {
                  const isExpired =
                    row.expiresAt && new Date(row.expiresAt) < new Date();
                  const isEnabled = row.enabled && !isExpired;
                  if (isEnabled) {
                    return <Badge color="green">Active</Badge>;
                  }
                  if (isExpired) {
                    return <Badge color="gray">Expired</Badge>;
                  }
                  return <Badge color="gray">Disabled</Badge>;
                },
              },
              {
                header: "Created",
                accessor: (row) =>
                  row.createdAt
                    ? new Date(row.createdAt).toLocaleDateString()
                    : "N/A",
                className: "text-gray-600 dark:text-gray-400",
              },
              {
                header: "Last Used",
                accessor: (row) =>
                  row.lastRequest
                    ? new Date(row.lastRequest).toLocaleDateString()
                    : "Never",
                className: "text-gray-600 dark:text-gray-400",
              },
              {
                header: "Expires",
                accessor: (row) =>
                  row.expiresAt
                    ? new Date(row.expiresAt).toLocaleDateString()
                    : "Never",
                className: "text-gray-600 dark:text-gray-400",
              },
            ]}
            data={keys}
            actions={(row: ApiKey) => [
              {
                title: "Delete",
                color: "red" as const,
                onClick: () => handleDelete(row.id),
              },
            ]}
            emptyMessage="No API keys created yet"
            getRowKey={(row: ApiKey) => row.id}
          />
        </Panel>

        {/* Usage Instructions */}
        <Panel className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Usage
          </h2>
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <p>
              To use an API key, include it in the{" "}
              <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                x-api-key
              </code>{" "}
              header:
            </p>
            <CodeBlock>
              <div>x-api-key: YOUR_API_KEY</div>
            </CodeBlock>
            <p className="mt-2">Example with curl:</p>
            <CodeBlock>
              <div>curl -H "x-api-key: YOUR_API_KEY" \</div>
              <div className="ml-4">http://localhost:3001/api/stats</div>
            </CodeBlock>
          </div>
        </Panel>
      </main>
    </>
  );
}
