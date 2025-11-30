import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Panel } from "../components/Panel";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { FormField } from "../components/FormField";
import { DataTable } from "../components/Table";
import { Select } from "../components/Select";
import { useToastContext } from "../contexts/ToastContext";

export function Zones() {
  const queryClient = useQueryClient();
  const toast = useToastContext();
  const [showCreateZone, setShowCreateZone] = useState(false);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [newSoaMname, setNewSoaMname] = useState("ns1.example.com");
  const [newSoaRname, setNewSoaRname] = useState("admin.example.com");

  // Record form state
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [newRecordName, setNewRecordName] = useState("");
  const [newRecordType, setNewRecordType] = useState<
    | "A"
    | "AAAA"
    | "MX"
    | "TXT"
    | "NS"
    | "CNAME"
    | "NAPTR"
    | "SSHFP"
    | "TLSA"
    | "SVCB"
    | "HTTPS"
  >("A");
  const [newRecordTTL, setNewRecordTTL] = useState("3600");
  const [newRecordData, setNewRecordData] = useState("");
  const [newRecordPriority, setNewRecordPriority] = useState("");

  const { data: zones = [], isLoading } = useQuery({
    queryKey: ["zones"],
    queryFn: () => api.getZones(),
  });

  const { data: records = [], isLoading: recordsLoading } = useQuery({
    queryKey: ["zoneRecords", selectedZone],
    queryFn: () => api.getZoneRecords(selectedZone!),
    enabled: selectedZone !== null,
  });

  const createZone = useMutation({
    mutationFn: (data: {
      domain: string;
      soaMname: string;
      soaRname: string;
    }) => api.createZone(data.domain, data.soaMname, data.soaRname),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      setShowCreateZone(false);
      setNewDomain("");
      setNewSoaMname("ns1.example.com");
      setNewSoaRname("admin.example.com");
      toast.success("Zone created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteZone = useMutation({
    mutationFn: (id: number) => api.deleteZone(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      if (selectedZone) setSelectedZone(null);
      toast.success("Zone deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const createRecord = useMutation({
    mutationFn: (data: {
      zoneId: number;
      name: string;
      type: string;
      ttl: number;
      data: string;
      priority?: number;
    }) =>
      api.createZoneRecord(
        data.zoneId,
        data.name,
        data.type,
        data.ttl,
        data.data,
        data.priority
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["zoneRecords", selectedZone],
      });
      setShowAddRecord(false);
      setNewRecordName("");
      setNewRecordType("A");
      setNewRecordTTL("3600");
      setNewRecordData("");
      setNewRecordPriority("");
      toast.success("Record created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteRecord = useMutation({
    mutationFn: (id: number) => api.deleteZoneRecord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["zoneRecords", selectedZone],
      });
      toast.success("Record deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleCreateZone = () => {
    if (newDomain.trim() && newSoaMname.trim() && newSoaRname.trim()) {
      createZone.mutate({
        domain: newDomain.trim(),
        soaMname: newSoaMname.trim(),
        soaRname: newSoaRname.trim(),
      });
    }
  };

  const handleCreateRecord = () => {
    if (!selectedZone) return;
    if (newRecordName.trim() && newRecordData.trim() && newRecordTTL.trim()) {
      const ttl = parseInt(newRecordTTL, 10);
      const priority = newRecordPriority.trim()
        ? parseInt(newRecordPriority, 10)
        : undefined;
      createRecord.mutate({
        zoneId: selectedZone,
        name: newRecordName.trim(),
        type: newRecordType,
        ttl,
        data: newRecordData.trim(),
        priority,
      });
    }
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Authoritative DNS Zones"
        description="Manage authoritative DNS zones and records"
      >
        <Button onClick={() => setShowCreateZone(!showCreateZone)}>
          {showCreateZone ? "Cancel" : "Create Zone"}
        </Button>
      </PageHeader>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {showCreateZone && (
          <Panel className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Create New Zone
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Domain">
                <Input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="example.com"
                />
              </FormField>
              <FormField label="SOA MNAME (Primary NS)">
                <Input
                  type="text"
                  value={newSoaMname}
                  onChange={(e) => setNewSoaMname(e.target.value)}
                  placeholder="ns1.example.com"
                />
              </FormField>
              <FormField label="SOA RNAME (Admin Email)">
                <Input
                  type="text"
                  value={newSoaRname}
                  onChange={(e) => setNewSoaRname(e.target.value)}
                  placeholder="admin.example.com"
                />
              </FormField>
            </div>
            <div className="mt-4">
              <Button
                onClick={handleCreateZone}
                disabled={
                  createZone.isPending ||
                  !newDomain.trim() ||
                  !newSoaMname.trim() ||
                  !newSoaRname.trim()
                }
              >
                Create Zone
              </Button>
            </div>
          </Panel>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Zones
            </h2>
            {zones.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                No zones configured
              </p>
            ) : (
              <div className="space-y-2">
                {zones.map((zone) => (
                  <div
                    key={zone.id}
                    className={`p-3 rounded border cursor-pointer ${
                      selectedZone === zone.id
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                        : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                    onClick={() => setSelectedZone(zone.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {zone.domain}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Serial: {zone.soa_serial} •{" "}
                          {zone.enabled ? "Enabled" : "Disabled"}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete zone ${zone.domain}?`)) {
                            deleteZone.mutate(zone.id);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Zone Records
              </h2>
              {selectedZone !== null && (
                <Button
                  size="sm"
                  onClick={() => setShowAddRecord(!showAddRecord)}
                >
                  {showAddRecord ? "Cancel" : "Add Record"}
                </Button>
              )}
            </div>

            {selectedZone === null ? (
              <p className="text-gray-500 dark:text-gray-400">
                Select a zone to view records
              </p>
            ) : (
              <>
                {showAddRecord && (
                  <div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                      Add New Record
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField label="Name">
                        <Input
                          type="text"
                          value={newRecordName}
                          onChange={(e) => setNewRecordName(e.target.value)}
                          placeholder="@ or www (use @ for zone root)"
                        />
                      </FormField>
                      <FormField label="Type">
                        <Select
                          value={newRecordType}
                          onChange={(e) =>
                            setNewRecordType(
                              e.target.value as typeof newRecordType
                            )
                          }
                        >
                          <option value="A">A (IPv4)</option>
                          <option value="AAAA">AAAA (IPv6)</option>
                          <option value="MX">MX (Mail Exchange)</option>
                          <option value="TXT">TXT (Text)</option>
                          <option value="NS">NS (Name Server)</option>
                          <option value="CNAME">CNAME (Canonical Name)</option>
                          <option value="NAPTR">
                            NAPTR (Name Authority Pointer)
                          </option>
                          <option value="SSHFP">SSHFP (SSH Fingerprint)</option>
                          <option value="TLSA">
                            TLSA (DANE/TLS Authentication)
                          </option>
                          <option value="SVCB">SVCB (Service Binding)</option>
                          <option value="HTTPS">
                            HTTPS (HTTPS Service Binding)
                          </option>
                        </Select>
                      </FormField>
                      <FormField label="TTL">
                        <Input
                          type="number"
                          value={newRecordTTL}
                          onChange={(e) => setNewRecordTTL(e.target.value)}
                          placeholder="3600"
                        />
                      </FormField>
                      {newRecordType === "MX" && (
                        <FormField label="Priority">
                          <Input
                            type="number"
                            value={newRecordPriority}
                            onChange={(e) =>
                              setNewRecordPriority(e.target.value)
                            }
                            placeholder="10"
                          />
                        </FormField>
                      )}
                      <FormField
                        label="Data"
                        className={
                          newRecordType === "MX" ||
                          newRecordType === "NAPTR" ||
                          newRecordType === "SVCB" ||
                          newRecordType === "HTTPS"
                            ? "md:col-span-2"
                            : ""
                        }
                      >
                        <Input
                          type="text"
                          value={newRecordData}
                          onChange={(e) => setNewRecordData(e.target.value)}
                          placeholder={
                            newRecordType === "A"
                              ? "192.168.1.100"
                              : newRecordType === "AAAA"
                              ? "2001:db8::1"
                              : newRecordType === "MX"
                              ? "mail.example.com"
                              : newRecordType === "TXT"
                              ? "text content"
                              : newRecordType === "NS"
                              ? "ns1.example.com"
                              : newRecordType === "CNAME"
                              ? "example.com"
                              : newRecordType === "NAPTR"
                              ? '10 10 "u" "sip+E2U" "!^.*$!sip:customer@example.com!" .'
                              : newRecordType === "SSHFP"
                              ? "1 1 abc123def456..."
                              : newRecordType === "TLSA"
                              ? "3 1 1 abc123def456..."
                              : newRecordType === "SVCB"
                              ? "1 . alpn=h2,h3"
                              : newRecordType === "HTTPS"
                              ? "1 . alpn=h2,h3 ipv4hint=1.2.3.4"
                              : "record data"
                          }
                        />
                      </FormField>
                    </div>
                    <div className="mt-4">
                      <Button
                        onClick={handleCreateRecord}
                        disabled={
                          createRecord.isPending ||
                          !newRecordName.trim() ||
                          !newRecordData.trim() ||
                          !newRecordTTL.trim()
                        }
                      >
                        Add Record
                      </Button>
                    </div>
                  </div>
                )}

                {recordsLoading ? (
                  <Loading />
                ) : records.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">
                    No records in this zone
                  </p>
                ) : (
                  <DataTable
                    data={records}
                    columns={[
                      { header: "Name", accessor: "name" },
                      { header: "Type", accessor: "type" },
                      { header: "TTL", accessor: "ttl" },
                      { header: "Data", accessor: "data" },
                      ...(records.some((r) => r.priority !== null)
                        ? [
                            {
                              header: "Priority",
                              accessor: "priority" as const,
                            },
                          ]
                        : []),
                    ]}
                    actions={(row) => [
                      {
                        title: "Delete",
                        color: "red" as const,
                        onClick: () => {
                          if (
                            confirm(`Delete record ${row.name} (${row.type})?`)
                          ) {
                            deleteRecord.mutate(row.id);
                          }
                        },
                        disabled: deleteRecord.isPending,
                      },
                    ]}
                    getRowKey={(row) => row.id}
                  />
                )}
              </>
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}
