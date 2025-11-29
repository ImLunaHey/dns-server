import { useState } from "react";
import { useRegexFilters, useAddRegexFilter, useRemoveRegexFilter, useToggleRegexFilter } from "../hooks/useRegexFilters";
import { useForm } from "@tanstack/react-form";
import { cn } from "../lib/cn";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/Table";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";

export function RegexFilters() {
  const { data: filters = [], isLoading } = useRegexFilters();
  const addFilter = useAddRegexFilter();
  const removeFilter = useRemoveRegexFilter();
  const toggleFilter = useToggleRegexFilter();
  const [testDomain, setTestDomain] = useState("");
  const [testResults, setTestResults] = useState<Record<number, boolean>>({});

  const form = useForm({
    defaultValues: {
      pattern: "",
      type: "block" as "block" | "allow",
      comment: "",
    },
    onSubmit: async ({ value }) => {
      await addFilter.mutateAsync({
        pattern: value.pattern,
        type: value.type,
        comment: value.comment || undefined,
      });
      form.reset();
    },
  });

  const testPattern = (pattern: string, domain: string): boolean => {
    try {
      const regex = new RegExp(pattern);
      return regex.test(domain);
    } catch {
      return false;
    }
  };

  const handleTestAll = () => {
    if (!testDomain) return;
    const results: Record<number, boolean> = {};
    filters.forEach((filter) => {
      results[filter.id] = testPattern(filter.pattern, testDomain);
    });
    setTestResults(results);
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  const blockFilters = filters.filter(f => f.type === 'block');
  const allowFilters = filters.filter(f => f.type === 'allow');

  return (
    <>
      <PageHeader
        title="Regex Filters"
        description="Block or allow domains matching regex patterns"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Add Filter Form */}
          <Panel>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Add Regex Filter
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
                name="pattern"
                validators={{
                  onChange: ({ value }) => {
                    if (!value) {
                      return "Pattern is required";
                    }
                    try {
                      new RegExp(value);
                    } catch {
                      return "Invalid regex pattern";
                    }
                    return undefined;
                  },
                }}
              >
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Regex Pattern
                    </label>
                    <input
                      type="text"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      className={cn(
                        "w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white font-mono text-sm",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        field.state.meta.errors.length > 0 && "border-red-500"
                      )}
                      placeholder=".*ad.*|^ads\\..*"
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-red-500 text-sm mt-1">{field.state.meta.errors[0]}</p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      JavaScript regex pattern (e.g., .*ad.* to match any domain containing "ad")
                    </p>
                  </div>
                )}
              </form.Field>

              <form.Field name="type">
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Type
                    </label>
                    <select
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value as "block" | "allow")}
                      className={cn(
                        "w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500"
                      )}
                    >
                      <option value="block">Block</option>
                      <option value="allow">Allow</option>
                    </select>
                  </div>
                )}
              </form.Field>

              <form.Field name="comment">
                {(field) => (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Comment (optional)
                    </label>
                    <input
                      type="text"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      className={cn(
                        "w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500"
                      )}
                      placeholder="Why this pattern is used"
                    />
                  </div>
                )}
              </form.Field>

              <form.Subscribe
                selector={(state) => [state.canSubmit, state.isSubmitting]}
              >
                {([canSubmit, isSubmitting]) => (
                  <button
                    type="submit"
                    disabled={!canSubmit || isSubmitting || addFilter.isPending}
                    className={cn(
                      "px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition-colors",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    {isSubmitting || addFilter.isPending ? "Adding..." : "Add Filter"}
                  </button>
                )}
              </form.Subscribe>
            </form>
          </Panel>

          {/* Test Pattern */}
          <Panel>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Test Patterns
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={testDomain}
                onChange={(e) => setTestDomain(e.target.value)}
                placeholder="example.com"
                className={cn(
                  "flex-1 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500"
                )}
              />
              <button
                onClick={handleTestAll}
                disabled={!testDomain}
                className={cn(
                  "px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                Test All
              </button>
            </div>
          </Panel>

          {/* Block Filters */}
          <Panel>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Block Filters ({blockFilters.length})
            </h2>
            {blockFilters.length === 0 ? (
              <div className="text-center py-8 text-gray-600 dark:text-gray-400">
                No block filters
              </div>
            ) : (
              <DataTable
                columns={[
                  {
                    header: "Pattern",
                    accessor: (row) => (
                      <code className="text-sm font-mono text-gray-800 dark:text-gray-200">
                        {row.pattern}
                      </code>
                    ),
                  },
                  {
                    header: "Comment",
                    accessor: (row) => row.comment || "-",
                  },
                  {
                    header: "Test Result",
                    accessor: (row) => {
                      if (!testDomain || testResults[row.id] === undefined) return null;
                      return (
                        <span
                          className={cn(
                            "text-sm font-medium",
                            testResults[row.id]
                              ? "text-red-600 dark:text-red-400"
                              : "text-gray-500"
                          )}
                        >
                          {testResults[row.id] ? "✓ Matches" : "✗ No match"}
                        </span>
                      );
                    },
                  },
                  {
                    header: "Status",
                    accessor: (row) => (
                      <span
                        className={cn(
                          "text-sm font-medium",
                          row.enabled
                            ? "text-green-600 dark:text-green-400"
                            : "text-gray-500"
                        )}
                      >
                        {row.enabled ? "Enabled" : "Disabled"}
                      </span>
                    ),
                  },
                ]}
                data={blockFilters}
                actions={(row) => [
                  {
                    title: row.enabled ? "Disable" : "Enable",
                    color: "blue" as const,
                    onClick: () => toggleFilter.mutate({ id: row.id, enabled: !row.enabled }),
                    disabled: toggleFilter.isPending,
                  },
                  {
                    title: "Remove",
                    color: "red" as const,
                    onClick: () => removeFilter.mutate(row.id),
                    disabled: removeFilter.isPending,
                  },
                ]}
                emptyMessage="No block filters"
                getRowKey={(row) => row.id}
              />
            )}
          </Panel>

          {/* Allow Filters */}
          <Panel>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Allow Filters ({allowFilters.length})
            </h2>
            {allowFilters.length === 0 ? (
              <div className="text-center py-8 text-gray-600 dark:text-gray-400">
                No allow filters
              </div>
            ) : (
              <DataTable
                columns={[
                  {
                    header: "Pattern",
                    accessor: (row) => (
                      <code className="text-sm font-mono text-gray-800 dark:text-gray-200">
                        {row.pattern}
                      </code>
                    ),
                  },
                  {
                    header: "Comment",
                    accessor: (row) => row.comment || "-",
                  },
                  {
                    header: "Test Result",
                    accessor: (row) => {
                      if (!testDomain || testResults[row.id] === undefined) return null;
                      return (
                        <span
                          className={cn(
                            "text-sm font-medium",
                            testResults[row.id]
                              ? "text-green-600 dark:text-green-400"
                              : "text-gray-500"
                          )}
                        >
                          {testResults[row.id] ? "✓ Matches" : "✗ No match"}
                        </span>
                      );
                    },
                  },
                  {
                    header: "Status",
                    accessor: (row) => (
                      <span
                        className={cn(
                          "text-sm font-medium",
                          row.enabled
                            ? "text-green-600 dark:text-green-400"
                            : "text-gray-500"
                        )}
                      >
                        {row.enabled ? "Enabled" : "Disabled"}
                      </span>
                    ),
                  },
                ]}
                data={allowFilters}
                actions={(row) => [
                  {
                    title: row.enabled ? "Disable" : "Enable",
                    color: "blue" as const,
                    onClick: () => toggleFilter.mutate({ id: row.id, enabled: !row.enabled }),
                    disabled: toggleFilter.isPending,
                  },
                  {
                    title: "Remove",
                    color: "red" as const,
                    onClick: () => removeFilter.mutate(row.id),
                    disabled: removeFilter.isPending,
                  },
                ]}
                emptyMessage="No allow filters"
                getRowKey={(row) => row.id}
              />
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}

