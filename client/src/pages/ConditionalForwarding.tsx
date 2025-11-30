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
import { useToastContext } from "../contexts/ToastContext";

export function ConditionalForwarding() {
  const queryClient = useQueryClient();
  const toast = useToastContext();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [newUpstreamDNS, setNewUpstreamDNS] = useState("");
  const [newComment, setNewComment] = useState("");
  const [newPriority, setNewPriority] = useState("0");

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["conditional-forwarding"],
    queryFn: () => api.getConditionalForwarding(),
  });

  const createRule = useMutation({
    mutationFn: (data: {
      domain: string;
      upstreamDNS: string;
      comment?: string;
      priority?: number;
    }) => api.createConditionalForwarding(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conditional-forwarding"] });
      setShowAddForm(false);
      resetForm();
      toast.success("Conditional forwarding rule created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create rule");
    },
  });

  const updateRule = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: {
        domain: string;
        upstreamDNS: string;
        comment?: string;
        priority?: number;
      };
    }) => api.updateConditionalForwarding(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conditional-forwarding"] });
      setEditingId(null);
      resetForm();
      toast.success("Rule updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update rule");
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.updateConditionalForwardingEnabled(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conditional-forwarding"] });
      toast.success("Rule updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update rule");
    },
  });

  const deleteRule = useMutation({
    mutationFn: (id: number) => api.deleteConditionalForwarding(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conditional-forwarding"] });
      toast.success("Rule deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete rule");
    },
  });

  const resetForm = () => {
    setNewDomain("");
    setNewUpstreamDNS("");
    setNewComment("");
    setNewPriority("0");
  };

  const handleAdd = () => {
    if (newDomain.trim() && newUpstreamDNS.trim()) {
      createRule.mutate({
        domain: newDomain.trim(),
        upstreamDNS: newUpstreamDNS.trim(),
        comment: newComment.trim() || undefined,
        priority: parseInt(newPriority, 10) || 0,
      });
    }
  };

  const handleEdit = (rule: (typeof rules)[0]) => {
    setEditingId(rule.id);
    setNewDomain(rule.domain);
    setNewUpstreamDNS(rule.upstreamDNS);
    setNewComment(rule.comment || "");
    setNewPriority(rule.priority.toString());
    setShowAddForm(true);
  };

  const handleUpdate = () => {
    if (editingId && newDomain.trim() && newUpstreamDNS.trim()) {
      updateRule.mutate({
        id: editingId,
        data: {
          domain: newDomain.trim(),
          upstreamDNS: newUpstreamDNS.trim(),
          comment: newComment.trim() || undefined,
          priority: parseInt(newPriority, 10) || 0,
        },
      });
    }
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditingId(null);
    resetForm();
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Conditional Forwarding"
        description="Forward specific domains to different upstream DNS servers"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {showAddForm && (
            <Panel>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {editingId ? "Edit Rule" : "Add New Rule"}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Domain">
                  <Input
                    type="text"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="example.com or *.example.com"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Use wildcards (e.g., *.example.com) to match subdomains
                  </p>
                </FormField>
                <FormField label="Upstream DNS">
                  <Input
                    type="text"
                    value={newUpstreamDNS}
                    onChange={(e) => setNewUpstreamDNS(e.target.value)}
                    placeholder="1.1.1.1 or 1.1.1.1,8.8.8.8"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Comma-separated IP addresses or DoH/DoT URLs
                  </p>
                </FormField>
                <FormField label="Priority">
                  <Input
                    type="number"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    placeholder="0"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Higher priority rules are matched first
                  </p>
                </FormField>
                <FormField label="Comment (optional)">
                  <Input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Optional description"
                  />
                </FormField>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={editingId ? handleUpdate : handleAdd}
                  disabled={
                    (editingId ? updateRule.isPending : createRule.isPending) ||
                    !newDomain.trim() ||
                    !newUpstreamDNS.trim()
                  }
                >
                  {editingId ? "Update Rule" : "Add Rule"}
                </Button>
                <Button onClick={handleCancel} variant="outline">
                  Cancel
                </Button>
              </div>
            </Panel>
          )}

          {!showAddForm && (
            <div className="flex justify-end">
              <Button onClick={() => setShowAddForm(true)}>
                Add Conditional Forwarding Rule
              </Button>
            </div>
          )}

          <Panel>
            {rules.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                No conditional forwarding rules configured. Add one to forward
                specific domains to different upstream DNS servers.
              </p>
            ) : (
              <DataTable
                data={rules}
                getRowKey={(row) => row.id}
                columns={[
                  { header: "Domain", accessor: "domain" },
                  { header: "Upstream DNS", accessor: "upstreamDNS" },
                  { header: "Priority", accessor: "priority" },
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
                    header: "Comment",
                    accessor: (row) => row.comment || "-",
                  },
                ]}
                actions={(row) => [
                  {
                    title: "Edit",
                    color: "blue" as const,
                    onClick: () => handleEdit(row),
                  },
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
                          `Are you sure you want to delete the rule for "${row.domain}"?`
                        )
                      ) {
                        deleteRule.mutate(row.id);
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

