import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/Table";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { FormField } from "../components/FormField";
import { Select } from "../components/Select";
import { useToastContext } from "../contexts/ToastContext";

export function TSIGKeys() {
  const queryClient = useQueryClient();
  const toast = useToastContext();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAlgorithm, setNewAlgorithm] = useState("hmac-sha256");
  const [newSecret, setNewSecret] = useState("");

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["tsig-keys"],
    queryFn: () => api.getTSIGKeys(),
  });

  const createKey = useMutation({
    mutationFn: (data: { name: string; algorithm: string; secret: string }) =>
      api.createTSIGKey(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tsig-keys"] });
      setShowAddForm(false);
      setNewName("");
      setNewSecret("");
      toast.success("TSIG key created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create TSIG key");
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.updateTSIGKeyEnabled(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tsig-keys"] });
      toast.success("TSIG key updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update TSIG key");
    },
  });

  const deleteKey = useMutation({
    mutationFn: (id: number) => api.deleteTSIGKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tsig-keys"] });
      toast.success("TSIG key deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete TSIG key");
    },
  });

  const handleAdd = () => {
    if (newName.trim() && newSecret.trim()) {
      createKey.mutate({
        name: newName.trim(),
        algorithm: newAlgorithm,
        secret: newSecret.trim(),
      });
    }
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="TSIG Keys"
        description="Manage TSIG keys for Dynamic DNS (DDNS) authentication"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {showAddForm && (
            <Panel>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Add New TSIG Key
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Name">
                  <Input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="key-name"
                  />
                </FormField>
                <FormField label="Algorithm">
                  <Select
                    value={newAlgorithm}
                    onChange={(e) => setNewAlgorithm(e.target.value)}
                  >
                    <option value="hmac-md5">HMAC-MD5</option>
                    <option value="hmac-sha1">HMAC-SHA1</option>
                    <option value="hmac-sha256">HMAC-SHA256</option>
                    <option value="hmac-sha512">HMAC-SHA512</option>
                  </Select>
                </FormField>
                <FormField label="Secret">
                  <Input
                    type="password"
                    value={newSecret}
                    onChange={(e) => setNewSecret(e.target.value)}
                    placeholder="base64-encoded secret"
                  />
                </FormField>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={handleAdd}
                  disabled={
                    createKey.isPending ||
                    !newName.trim() ||
                    !newSecret.trim()
                  }
                >
                  Add Key
                </Button>
                <Button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewName("");
                    setNewSecret("");
                  }}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </Panel>
          )}

          {!showAddForm && (
            <div className="flex justify-end">
              <Button onClick={() => setShowAddForm(true)}>Add TSIG Key</Button>
            </div>
          )}

          <Panel>
            {keys.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                No TSIG keys configured. Add one to enable Dynamic DNS updates.
              </p>
            ) : (
              <DataTable
                data={keys}
                getRowKey={(row) => row.id}
                columns={[
                  { header: "Name", accessor: "name" },
                  { header: "Algorithm", accessor: "algorithm" },
                  {
                    header: "Status",
                    accessor: (row) => (
                      <span
                        className={
                          row.enabled
                            ? "text-green-600 dark:text-green-400"
                            : "text-gray-500 dark:text-gray-400"
                        }
                      >
                        {row.enabled ? "Enabled" : "Disabled"}
                      </span>
                    ),
                  },
                  {
                    header: "Created",
                    accessor: (row) =>
                      new Date(row.createdAt).toLocaleString(),
                  },
                ]}
                actions={(row) => [
                  {
                    title: row.enabled ? "Disable" : "Enable",
                    color: "blue" as const,
                    onClick: () =>
                      toggleEnabled.mutate({
                        id: row.id,
                        enabled: !row.enabled,
                      }),
                  },
                  {
                    title: "Delete",
                    color: "red" as const,
                    onClick: () => {
                      if (
                        confirm(
                          `Are you sure you want to delete TSIG key "${row.name}"?`
                        )
                      ) {
                        deleteKey.mutate(row.id);
                      }
                    },
                  },
                ]}
              />
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}

