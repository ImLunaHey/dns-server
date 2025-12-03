import { useState } from "react";
import { useAllowlist, useAddToAllowlist, useRemoveFromAllowlist } from "../hooks/useAllowlist";
import { useForm } from "@tanstack/react-form";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/Table";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Input } from "../components/Input";
import { SearchInput } from "../components/SearchInput";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { EmptyState } from "../components/EmptyState";

export function Allowlist() {
  const { data: allowlist = [], isLoading } = useAllowlist();
  const addToAllowlist = useAddToAllowlist();
  const removeFromAllowlist = useRemoveFromAllowlist();
  const [searchTerm, setSearchTerm] = useState("");

  const form = useForm({
    defaultValues: {
      domain: "",
      comment: "",
    },
    onSubmit: async ({ value }) => {
      await addToAllowlist.mutateAsync({
        domain: value.domain,
        comment: value.comment || undefined,
      });
      form.reset();
    },
  });

  const filteredAllowlist = searchTerm
    ? allowlist.filter((entry) =>
        entry.domain.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.comment?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : allowlist;

  if (isLoading) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Allowlist"
        description="Domains that should never be blocked"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Add Domain Form */}
          <Panel>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Add Domain to Allowlist
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="space-y-4"
            >
              <form.Field
                name="domain"
                validators={{
                  onChange: ({ value }) => {
                    if (!value) {
                      return "Domain is required";
                    }
                    return undefined;
                  },
                }}
              >
                {(field) => (
                  <FormField
                    label="Domain"
                    required
                    error={field.state.meta.errors[0]}
                  >
                    <Input
                      type="text"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="example.com"
                    />
                  </FormField>
                )}
              </form.Field>

              <form.Field name="comment">
                {(field) => (
                  <FormField label="Comment (optional)">
                    <Input
                      type="text"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Why this domain is allowed"
                    />
                  </FormField>
                )}
              </form.Field>

              <form.Subscribe
                selector={(state) => [state.canSubmit, state.isSubmitting]}
              >
                {([canSubmit, isSubmitting]) => (
                  <Button
                    type="submit"
                    disabled={!canSubmit || isSubmitting || addToAllowlist.isPending}
                  >
                    {isSubmitting || addToAllowlist.isPending ? "Adding..." : "Add to Allowlist"}
                  </Button>
                )}
              </form.Subscribe>
            </form>
          </Panel>

          {/* Allowlist Table */}
          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Allowlisted Domains ({allowlist.length})
              </h2>
              <div className="w-64">
                <SearchInput
                  value={searchTerm}
                  onChange={setSearchTerm}
                  placeholder="Search domains..."
                />
              </div>
            </div>

            {filteredAllowlist.length === 0 ? (
              <EmptyState
                title={searchTerm ? "No domains found" : "No domains in allowlist"}
                description={searchTerm ? "Try adjusting your search term" : undefined}
              />
            ) : (
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
                    header: "Comment",
                    accessor: (row) => row.comment || "-",
                  },
                  {
                    header: "Added",
                    accessor: (row) => new Date(row.addedAt).toLocaleDateString(),
                  },
                ]}
                data={filteredAllowlist}
                actions={(row) => [
                  {
                    title: "Remove",
                    color: "red" as const,
                    onClick: () => removeFromAllowlist.mutate(row.domain),
                    disabled: removeFromAllowlist.isPending,
                  },
                ]}
                emptyMessage="No domains in allowlist"
                getRowKey={(row) => row.id}
              />
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}

