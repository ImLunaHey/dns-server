import { useState } from "react";
import { useLocalDNS, useAddLocalDNS, useRemoveLocalDNS, useSetLocalDNSEnabled } from "../hooks/useLocalDNS";
import { cn } from "../lib/cn";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/Table";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";

export function LocalDNS() {
  const { data: records = [], isLoading } = useLocalDNS();
  const addRecord = useAddLocalDNS();
  const removeRecord = useRemoveLocalDNS();
  const setEnabled = useSetLocalDNSEnabled();

  const [newDomain, setNewDomain] = useState("");
  const [newIp, setNewIp] = useState("");
  const [newType, setNewType] = useState<"A" | "AAAA">("A");

  const handleAdd = () => {
    if (newDomain.trim() && newIp.trim()) {
      addRecord.mutate({ domain: newDomain.trim(), ip: newIp.trim(), type: newType });
      setNewDomain("");
      setNewIp("");
    }
  };

  const validateIP = (ip: string, type: "A" | "AAAA"): boolean => {
    if (type === "A") {
      const parts = ip.split(".");
      return parts.length === 4 && parts.every(p => {
        const num = parseInt(p, 10);
        return !isNaN(num) && num >= 0 && num <= 255;
      });
    } else {
      // Basic IPv6 validation
      return ip.includes(":") && ip.split(":").length <= 8;
    }
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Local DNS"
        description="Manage custom DNS records"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Panel className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add New DNS Record</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <FormField label="Domain">
              <Input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="example.local"
              />
            </FormField>
            <FormField 
              label="IP Address" 
              error={newIp && !validateIP(newIp, newType) ? `Invalid ${newType === "A" ? "IPv4" : "IPv6"} address` : undefined}
            >
              <Input
                type="text"
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder={newType === "A" ? "192.168.1.1" : "2001:db8::1"}
              />
            </FormField>
            <FormField label="Type">
              <Select
                value={newType}
                onChange={(e) => setNewType(e.target.value as "A" | "AAAA")}
              >
                <option value="A">A (IPv4)</option>
                <option value="AAAA">AAAA (IPv6)</option>
              </Select>
            </FormField>
            <div className="flex items-end">
              <Button
                onClick={handleAdd}
                disabled={addRecord.isPending || !newDomain.trim() || !newIp.trim() || !validateIP(newIp, newType)}
                className="w-full"
              >
                Add
              </Button>
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden" padding="none">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-black">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">DNS Records</h2>
          </div>
          <DataTable
            columns={[
              {
                header: "Domain",
                accessor: (row) => (
                  <div className="text-sm font-mono text-gray-800 dark:text-gray-200">
                    {row.domain}
                  </div>
                ),
              },
              {
                header: "IP Address",
                accessor: (row) => (
                  <div className="text-sm font-mono text-gray-700 dark:text-gray-300">
                    {row.ip}
                  </div>
                ),
              },
              {
                header: "Type",
                accessor: "type",
                className: "whitespace-nowrap",
              },
              {
                header: "Status",
                accessor: (row) => (
                  <button
                    onClick={() => setEnabled.mutate({ domain: row.domain, enabled: !row.enabled })}
                    disabled={setEnabled.isPending}
                    className={cn(
                      "px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full transition-colors",
                      row.enabled
                        ? "bg-green-900/50 text-green-300 border border-green-700 hover:bg-green-900/70"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-300 dark:hover:bg-gray-600",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    {row.enabled ? "Enabled" : "Disabled"}
                  </button>
                ),
                className: "whitespace-nowrap",
              },
            ]}
            data={records}
            actions={(row) => [
              {
                title: "Delete",
                color: "red" as const,
                onClick: () => removeRecord.mutate(row.domain),
                disabled: removeRecord.isPending,
              },
            ]}
            emptyMessage="No DNS records configured"
            getRowKey={(row) => row.id}
          />
        </Panel>
      </main>
    </>
  );
}

