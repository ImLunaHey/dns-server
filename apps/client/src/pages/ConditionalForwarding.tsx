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
import { useConfirmModal } from "../components/ConfirmModal";
import { useModalManager } from "../contexts/ModalContext";

export function ConditionalForwarding() {
  const queryClient = useQueryClient();
  const toast = useToastContext();
  const confirmModal = useConfirmModal();
  const modalManager = useModalManager();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["conditional-forwarding"],
    queryFn: () => api.getConditionalForwarding(),
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

  const handleAdd = () => {
    modalManager.add(
      "conditional-forwarding-form",
      () => <ConditionalForwardingFormModal />,
      { size: "lg" }
    );
  };

  const handleEdit = (rule: (typeof rules)[0]) => {
    modalManager.add(
      "conditional-forwarding-form",
      () => <ConditionalForwardingFormModal rule={rule} />,
      { size: "lg" }
    );
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
          <div className="flex justify-end">
            <Button onClick={handleAdd}>
              Add Conditional Forwarding Rule
            </Button>
          </div>

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
                      confirmModal(
                        `delete-rule-${row.id}`,
                        "Delete Rule",
                        `Are you sure you want to delete the rule for "${row.domain}"?`,
                        () => deleteRule.mutate(row.id),
                        { confirmLabel: "Delete", confirmColor: "red" }
                      );
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

function ConditionalForwardingFormModal({
  rule,
}: {
  rule?: {
    id: number;
    domain: string;
    upstreamDNS: string;
    comment?: string | null;
    priority: number;
  };
}) {
  const queryClient = useQueryClient();
  const toast = useToastContext();
  const modalManager = useModalManager();
  const [domain, setDomain] = useState(rule?.domain || "");
  const [upstreamDNS, setUpstreamDNS] = useState(rule?.upstreamDNS || "");
  const [comment, setComment] = useState(rule?.comment ?? "");
  const [priority, setPriority] = useState(rule?.priority.toString() || "0");

  const createRule = useMutation({
    mutationFn: (data: {
      domain: string;
      upstreamDNS: string;
      comment?: string;
      priority?: number;
    }) => api.createConditionalForwarding(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conditional-forwarding"] });
      modalManager.remove("conditional-forwarding-form");
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
      modalManager.remove("conditional-forwarding-form");
      toast.success("Rule updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update rule");
    },
  });

  const handleSubmit = () => {
    if (domain.trim() && upstreamDNS.trim()) {
      if (rule) {
        updateRule.mutate({
          id: rule.id,
          data: {
            domain: domain.trim(),
            upstreamDNS: upstreamDNS.trim(),
            comment: comment.trim() || undefined,
            priority: parseInt(priority, 10) || 0,
          },
        });
      } else {
        createRule.mutate({
          domain: domain.trim(),
          upstreamDNS: upstreamDNS.trim(),
          comment: comment.trim() || undefined,
          priority: parseInt(priority, 10) || 0,
        });
      }
    }
  };

  const handleCancel = () => {
    modalManager.remove("conditional-forwarding-form");
  };

  const isPending = rule ? updateRule.isPending : createRule.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {rule ? "Edit Rule" : "Add New Rule"}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configure conditional forwarding to forward specific domains to different upstream DNS servers
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Domain">
          <Input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com or *.example.com"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Use wildcards (e.g., *.example.com) to match subdomains
          </p>
        </FormField>
        <FormField label="Upstream DNS">
          <Input
            type="text"
            value={upstreamDNS}
            onChange={(e) => setUpstreamDNS(e.target.value)}
            placeholder="1.1.1.1 or 1.1.1.1,8.8.8.8"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Comma-separated IP addresses or DoH/DoT URLs
          </p>
        </FormField>
        <FormField label="Priority">
          <Input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            placeholder="0"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Higher priority rules are matched first
          </p>
        </FormField>
        <FormField label="Comment (optional)">
          <Input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional description"
          />
        </FormField>
      </div>
      <div className="flex gap-2 justify-end">
        <Button onClick={handleCancel} variant="outline" disabled={isPending}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isPending || !domain.trim() || !upstreamDNS.trim()}
        >
          {rule ? "Update Rule" : "Add Rule"}
        </Button>
      </div>
    </div>
  );
}

