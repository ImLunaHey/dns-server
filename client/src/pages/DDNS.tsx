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
import { useConfirmModal } from "../components/ConfirmModal";
import { useModalManager } from "../contexts/ModalContext";

export function DDNS() {
  const queryClient = useQueryClient();
  const toast = useToastContext();
  const confirmModal = useConfirmModal();
  const modalManager = useModalManager();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAlgorithm, setNewAlgorithm] = useState("hmac-sha256");
  const [newSecret, setNewSecret] = useState("");

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["tsig-keys"],
    queryFn: () => api.getTSIGKeys(),
  });

  const { data: tokens = [], isLoading: tokensLoading } = useQuery({
    queryKey: ["ddns-tokens"],
    queryFn: () => api.getDDNSTokens(),
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

  const toggleTokenEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.updateDDNSTokenEnabled(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ddns-tokens"] });
      toast.success("DDNS token updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update DDNS token");
    },
  });

  const deleteToken = useMutation({
    mutationFn: (id: number) => api.deleteDDNSToken(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ddns-tokens"] });
      toast.success("DDNS token deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete DDNS token");
    },
  });

  const handleAddToken = () => {
    modalManager.add("ddns-token-form", () => <DDNSTokenFormModal />, {
      size: "md",
    });
  };

  const handleEditToken = (token: (typeof tokens)[0]) => {
    modalManager.add(
      "ddns-token-form",
      () => <DDNSTokenFormModal token={token} />,
      { size: "md" }
    );
  };

  if (isLoading || tokensLoading) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Dynamic DNS (DDNS)"
        description="Manage DDNS tokens and TSIG keys for automatic DNS record updates"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                TSIG Keys (RFC 2136/2845)
              </h2>
              {!showAddForm && (
                <Button onClick={() => setShowAddForm(true)} size="sm">
                  Add TSIG Key
                </Button>
              )}
            </div>
            {showAddForm && (
              <div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded">
                <h3 className="text-md font-medium text-gray-900 dark:text-white mb-4">
                  Add New TSIG Key
                </h3>
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
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Base64-encoded shared secret. Generate with:{" "}
                      <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                        openssl rand -base64 32
                      </code>
                    </p>
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
              </div>
            )}
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
                    accessor: (row) => new Date(row.createdAt).toLocaleString(),
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
                      confirmModal(
                        `delete-tsig-key-${row.id}`,
                        "Delete TSIG Key",
                        `Are you sure you want to delete the TSIG key "${row.name}"?`,
                        () => deleteKey.mutate(row.id),
                        { confirmLabel: "Delete", confirmColor: "red" }
                      );
                    },
                  },
                ]}
              />
            )}
          </Panel>

          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Simple HTTP-based DDNS Tokens
              </h2>
              <Button onClick={handleAddToken} size="sm">
                Add Token
              </Button>
            </div>
            {tokens.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                No DDNS tokens configured. Create one to enable simple
                HTTP-based IP updates.
              </p>
            ) : (
              <DataTable
                data={tokens}
                getRowKey={(row) => row.id}
                columns={[
                  { header: "Domain", accessor: "domain" },
                  { header: "Record Type", accessor: "recordType" },
                  {
                    header: "Update URL",
                    accessor: (row) => (
                      <code className="text-xs bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded block break-all font-mono">
                        {window.location.origin}/api/ddns/update?token=
                        {row.token}
                      </code>
                    ),
                  },
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
                ]}
                actions={(row) => [
                  {
                    title: "Edit",
                    color: "blue" as const,
                    onClick: () => handleEditToken(row),
                  },
                  {
                    title: row.enabled ? "Disable" : "Enable",
                    color: "blue" as const,
                    onClick: () =>
                      toggleTokenEnabled.mutate({
                        id: row.id,
                        enabled: !row.enabled,
                      }),
                  },
                  {
                    title: "Delete",
                    color: "red" as const,
                    onClick: () => {
                      confirmModal(
                        `delete-dns-token-${row.id}`,
                        "Delete DDNS Token",
                        `Are you sure you want to delete the DDNS token for "${row.domain}"?`,
                        () => deleteToken.mutate(row.id),
                        { confirmLabel: "Delete", confirmColor: "red" }
                      );
                    },
                  },
                ]}
              />
            )}
          </Panel>

          <Panel>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              About Dynamic DNS (DDNS) and TSIG Keys
            </h2>
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <p>
                <strong>Dynamic DNS (DDNS)</strong> allows clients to update DNS
                records dynamically when IP addresses change. This is useful
                for:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>
                  Automatically updating A/AAAA records when your IP address
                  changes
                </li>
                <li>
                  Remote management of DNS records via scripts or applications
                </li>
                <li>
                  Integrating with DHCP servers to update DNS automatically
                </li>
                <li>
                  Home server setups that need to stay accessible with changing
                  IPs
                </li>
              </ul>
              <p className="mt-4">
                <strong>Two Methods Available:</strong>
              </p>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>
                  <strong>
                    Simple HTTP-based DDNS (Recommended for most apps):
                  </strong>{" "}
                  Your app sends a GET request to a URL when your IP changes. No
                  special DNS knowledge required. Just use the token URL
                  provided above.
                </li>
                <li>
                  <strong>TSIG-based DDNS (RFC 2136/2845):</strong> Full DNS
                  UPDATE protocol support with TSIG authentication. Use this if
                  your client supports DNS UPDATE (e.g., nsupdate, ISC DHCP).
                </li>
              </ol>
              <p className="mt-4">
                <strong>TSIG (Transaction Signature)</strong> provides
                authentication for DNS UPDATE requests (RFC 2845). Each TSIG key
                consists of:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>
                  <strong>Name:</strong> A unique identifier for the key (e.g.,
                  "mykey" or "dhcp-key")
                </li>
                <li>
                  <strong>Algorithm:</strong> The HMAC algorithm used
                  (HMAC-SHA256 recommended)
                </li>
                <li>
                  <strong>Secret:</strong> A base64-encoded shared secret key
                  (both client and server must have the same secret)
                </li>
              </ul>
              <p>
                <strong>How it works:</strong>
              </p>
              <ol className="list-decimal list-inside space-y-1 ml-4">
                <li>
                  Create a TSIG key here with a name, algorithm, and
                  base64-encoded secret
                </li>
                <li>
                  Configure your client (e.g.,{" "}
                  <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                    nsupdate
                  </code>
                  , DHCP server, or custom script) with the same key name and
                  secret
                </li>
                <li>
                  The client sends DNS UPDATE requests signed with the TSIG key
                  to modify DNS records
                </li>
                <li>
                  The server verifies the TSIG signature and updates the records
                  if valid
                </li>
              </ol>
              <p>
                <strong>Generating a TSIG key secret:</strong> You can generate
                a base64-encoded secret using:
              </p>
              <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto">
                <code>
                  # Generate a random 32-byte secret and encode in base64{"\n"}
                  openssl rand -base64 32{"\n"}
                  {"\n"}# Or using Python:{"\n"}
                  python3 -c "import secrets, base64;
                  print(base64.b64encode(secrets.token_bytes(32)).decode())"
                </code>
              </pre>
              <p className="mt-4">
                <strong>Example usage with nsupdate:</strong>
              </p>
              <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto mt-2">
                <code>
                  # Update an A record using nsupdate{"\n"}
                  nsupdate -k keyfile.conf{"\n"}
                  {"\n"}# In nsupdate prompt:{"\n"}
                  server your-dns-server.com{"\n"}
                  zone example.com{"\n"}
                  update add www.example.com 3600 A 192.168.1.100{"\n"}
                  send{"\n"}
                  {"\n"}# keyfile.conf format:{"\n"}
                  key "key-name" {"{"}
                  {"\n"}
                  {"    "}algorithm hmac-sha256;{"\n"}
                  {"    "}secret "base64-secret-here";{"\n"}
                  {"}"};
                </code>
              </pre>
            </div>
          </Panel>
        </div>
      </main>
    </>
  );
}

function DDNSTokenFormModal({
  token,
}: {
  token?: {
    id: number;
    domain: string;
    recordType: string;
  };
}) {
  const queryClient = useQueryClient();
  const toast = useToastContext();
  const modalManager = useModalManager();
  const [domain, setDomain] = useState(token?.domain || "");
  const [recordType, setRecordType] = useState(token?.recordType || "A");

  const createToken = useMutation({
    mutationFn: (data: { domain: string; recordType?: string }) =>
      api.createDDNSToken(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ddns-tokens"] });
      modalManager.remove("ddns-token-form");
      toast.success(
        `DDNS token created! Use: ${window.location.origin}/api/ddns/update?token=${data.token}`
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create DDNS token");
    },
  });

  const updateToken = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { domain: string; recordType?: string };
    }) => api.updateDDNSToken(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ddns-tokens"] });
      modalManager.remove("ddns-token-form");
      toast.success("DDNS token updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update DDNS token");
    },
  });

  const handleSubmit = () => {
    if (domain.trim()) {
      if (token) {
        updateToken.mutate({
          id: token.id,
          data: {
            domain: domain.trim(),
            recordType,
          },
        });
      } else {
        createToken.mutate({
          domain: domain.trim(),
          recordType,
        });
      }
    }
  };

  const handleCancel = () => {
    modalManager.remove("ddns-token-form");
  };

  const isPending = token ? updateToken.isPending : createToken.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {token ? "Edit Token" : "Add New Token"}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create a simple HTTP-based DDNS token for automatic IP updates
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Domain">
          <Input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
          />
        </FormField>
        <FormField label="Record Type">
          <Select
            value={recordType}
            onChange={(e) => setRecordType(e.target.value)}
          >
            <option value="A">A (IPv4)</option>
            <option value="AAAA">AAAA (IPv6)</option>
          </Select>
        </FormField>
      </div>
      <div className="flex gap-2 justify-end">
        <Button onClick={handleCancel} variant="outline" disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isPending || !domain.trim()}>
          {token ? "Update Token" : "Create Token"}
        </Button>
      </div>
    </div>
  );
}
