import { useState } from "react";
import { useStats } from "../hooks/useStats";
import { useBlockDomain, useAllowDomain } from "../hooks/useBlocklistMutations";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/Table";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { ToggleGroup } from "../components/ToggleGroup";

export function Domains() {
  const { data: stats, isLoading } = useStats();
  const blockDomain = useBlockDomain();
  const allowDomain = useAllowDomain();
  const [searchTerm, setSearchTerm] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);

  if (isLoading) {
    return <Loading fullScreen />;
  }

  const domains = showBlocked
    ? stats?.topBlockedArray || []
    : stats?.topDomainsArray || [];

  const filteredDomains = searchTerm
    ? domains.filter((d) =>
        d.domain.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : domains;

  return (
    <>
      <PageHeader
        title="Domains"
        description="Manage domain blocklist"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex gap-4 items-center">
          <div className="flex-1">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search domains..."
            />
          </div>
          <ToggleGroup
            value={showBlocked ? "blocked" : "all"}
            options={[
              { value: "all", label: "All Domains" },
              { value: "blocked", label: "Blocked Only" },
            ]}
            onChange={(value) => setShowBlocked(value === "blocked")}
          />
        </div>

        <Panel className="overflow-hidden" padding="none">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-black">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {showBlocked ? "Blocked Domains" : "Top Queried Domains"}
            </h2>
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
                header: "Queries",
                accessor: (row) => row.count.toLocaleString(),
                className: "whitespace-nowrap",
              },
            ]}
            data={filteredDomains}
            actions={(row) => {
              const isBlocked =
                showBlocked ||
                stats?.topBlockedArray.some((d) => d.domain === row.domain);
              return [
                isBlocked
                  ? {
                      title: "Allow",
                      color: "green" as const,
                      onClick: () => allowDomain.mutate(row.domain),
                      disabled: allowDomain.isPending,
                    }
                  : {
                      title: "Block",
                      color: "red" as const,
                      onClick: () => blockDomain.mutate(row.domain),
                      disabled: blockDomain.isPending,
                    },
              ];
            }}
            emptyMessage={searchTerm ? "No domains found" : "No domains"}
            getRowKey={(row) => row.domain}
          />
        </Panel>
      </main>
    </>
  );
}
