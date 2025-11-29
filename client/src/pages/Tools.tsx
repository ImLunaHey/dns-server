import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { PageHeader } from "../components/PageHeader";
import { Input } from "../components/Input";
import { Button } from "../components/Button";

export function Tools() {
  const [domain, setDomain] = useState("");
  const [type, setType] = useState<"A" | "AAAA" | "PTR">("A");

  const lookup = useMutation({
    mutationFn: () => api.lookupDNS(domain, type),
  });

  const handleLookup = () => {
    if (domain.trim()) {
      lookup.mutate();
    }
  };

  return (
    <>
      <PageHeader
        title="Tools"
        description="DNS utilities and diagnostics"
      />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">DNS Lookup</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Domain or IP</label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                  placeholder={type === "PTR" ? "e.g., 8.8.8.8" : "e.g., example.com"}
                  className="flex-1"
                />
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as "A" | "AAAA" | "PTR")}
                  className={cn(
                    "px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500"
                  )}
                >
                  <option value="A">A (IPv4)</option>
                  <option value="AAAA">AAAA (IPv6)</option>
                  <option value="PTR">PTR (Reverse)</option>
                </select>
                <Button
                  onClick={handleLookup}
                  disabled={!domain.trim() || lookup.isPending}
                >
                  {lookup.isPending ? "Looking up..." : "Lookup"}
                </Button>
              </div>
            </div>

            {lookup.isError && (
              <div className="p-4 bg-red-900/30 border border-red-700 rounded text-red-300">
                Error: {(lookup.error as Error).message}
              </div>
            )}

            {lookup.isSuccess && lookup.data && (
              <div className="p-4 bg-gray-100 dark:bg-gray-700/50 rounded border border-gray-300 dark:border-gray-600">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Results</h3>
                <div className="space-y-2">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Domain:</span>{" "}
                    <span className="text-gray-900 dark:text-white font-mono">{lookup.data.domain}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Type:</span>{" "}
                    <span className="text-gray-900 dark:text-white">{lookup.data.type}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">
                      {lookup.data.type === "PTR" ? "Hostnames:" : "Addresses:"}
                    </span>
                    <div className="mt-1 space-y-1">
                      {(lookup.data.addresses || lookup.data.hostnames || []).map(
                        (addr: string, idx: number) => (
                          <div key={idx} className="text-gray-900 dark:text-white font-mono text-sm pl-4">
                            • {addr}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">About DNS Lookup</h2>
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <p>
              <strong className="text-gray-900 dark:text-white">A Record:</strong> Resolves a domain name to an IPv4 address.
            </p>
            <p>
              <strong className="text-gray-900 dark:text-white">AAAA Record:</strong> Resolves a domain name to an IPv6 address.
            </p>
            <p>
              <strong className="text-gray-900 dark:text-white">PTR Record:</strong> Performs a reverse DNS lookup, resolving an IP
              address to a hostname.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

