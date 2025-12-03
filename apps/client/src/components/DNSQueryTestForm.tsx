import { useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { api } from "../lib/api";
import { FormField } from "./FormField";
import { Input } from "./Input";
import { Select } from "./Select";
import { Button } from "./Button";
import { Panel } from "./Panel";

const queryTestSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
  type: z.enum(["A", "AAAA", "MX", "TXT", "CNAME", "NS", "PTR", "SRV", "SOA"]),
  dnssec: z.boolean(),
});

type QueryTestFormData = z.infer<typeof queryTestSchema>;

export function DNSQueryTestForm() {
  const search = useSearch({ from: "/tools" });
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isValid },
    setError,
    clearErrors,
  } = useForm<QueryTestFormData>({
    mode: "onChange",
    defaultValues: {
      domain: search.domain || "",
      type: (search.type as QueryTestFormData["type"]) || "A",
      dnssec: false,
    },
  });

  // Update form when search params change
  useEffect(() => {
    if (search.domain) {
      setValue("domain", search.domain);
    }
    if (search.type) {
      setValue("type", search.type as QueryTestFormData["type"]);
    }
  }, [search.domain, search.type, setValue]);

  const testQuery = useMutation({
    mutationFn: (data: QueryTestFormData) =>
      api.testDNSQuery(data.domain, data.type, data.dnssec),
  });

  const onSubmit = (data: QueryTestFormData) => {
    const result = queryTestSchema.safeParse(data);
    if (!result.success) {
      result.error.issues.forEach((err) => {
        const field = err.path[0] as keyof QueryTestFormData;
        setError(field, { message: err.message });
      });
      return;
    }
    clearErrors();
    testQuery.mutate(result.data);
  };

  return (
    <Panel className="mt-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        DNS Query Test
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Test DNS queries through the DNS server (with blocking, caching, and
        forwarding applied)
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <FormField label="Domain" required error={errors.domain?.message}>
          <Input
            type="text"
            {...register("domain", {
              required: "Domain is required",
              validate: (value) => {
                const result = z.string().min(1).safeParse(value);
                return result.success || "Domain is required";
              },
            })}
            placeholder="e.g., example.com"
            className="w-full"
            error={errors.domain?.message}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Query Type" required error={errors.type?.message}>
            <Select
              {...register("type", {
                required: "Query type is required",
              })}
              error={errors.type?.message}
            >
              <option value="A">A (IPv4)</option>
              <option value="AAAA">AAAA (IPv6)</option>
              <option value="MX">MX</option>
              <option value="TXT">TXT</option>
              <option value="CNAME">CNAME</option>
              <option value="NS">NS</option>
              <option value="PTR">PTR</option>
              <option value="SRV">SRV</option>
              <option value="SOA">SOA</option>
            </Select>
          </FormField>

          <FormField label="Options">
            <div className="flex items-center h-10">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  {...register("dnssec", {
                    setValueAs: (value) => Boolean(value),
                  })}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Request DNSSEC
                </span>
              </label>
            </div>
          </FormField>
        </div>

        <Button type="submit" disabled={!isValid || testQuery.isPending}>
          {testQuery.isPending ? "Testing..." : "Test Query"}
        </Button>

        {testQuery.isError && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded text-red-300">
            <strong>Error:</strong> {(testQuery.error as Error).message}
          </div>
        )}

        {testQuery.isSuccess && testQuery.data && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-100 dark:bg-gray-700/50 rounded border border-gray-300 dark:border-gray-600">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Query Results
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 dark:text-gray-400">
                    Domain:
                  </span>
                  <span className="text-gray-900 dark:text-white font-mono">
                    {testQuery.data.domain}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 dark:text-gray-400">
                    Type:
                  </span>
                  <span className="text-gray-900 dark:text-white">
                    {testQuery.data.type}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 dark:text-gray-400">
                    Response Time:
                  </span>
                  <span className="text-gray-900 dark:text-white">
                    {testQuery.data.responseTime}ms
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-100 dark:bg-gray-700/50 rounded border border-gray-300 dark:border-gray-600">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                DNS Response
              </h3>
              <pre className="text-xs bg-gray-900 dark:bg-black text-gray-100 p-3 rounded overflow-x-auto">
                {JSON.stringify(testQuery.data.response, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </form>
    </Panel>
  );
}
