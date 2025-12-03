import { useForm } from "react-hook-form";
import { z } from "zod";
import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { FormField } from "./FormField";
import { Input } from "./Input";
import { Select } from "./Select";
import { Button } from "./Button";

// Shared IP validation function
const isValidIP = (value: string): boolean => {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex =
    /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^(?:[0-9a-fA-F]{1,4}:)*::(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^:(?:[0-9a-fA-F]{1,4}:){1,6}[0-9a-fA-F]{1,4}$/;
  return ipv4Regex.test(value) || ipv6Regex.test(value);
};

const lookupSchema = z
  .object({
    domain: z.string().min(1, "Domain or IP is required"),
    type: z.enum([
      "A",
      "AAAA",
      "PTR",
      "MX",
      "TXT",
      "CNAME",
      "NS",
      "SRV",
      "SOA",
    ]),
  })
  .refine(
    (data) => {
      if (data.type === "PTR") {
        return isValidIP(data.domain);
      }
      return true;
    },
    {
      message: "PTR queries require a valid IP address (IPv4 or IPv6)",
      path: ["domain"],
    }
  );

type LookupFormData = z.infer<typeof lookupSchema>;

export function DNSLookupForm() {
  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors, isValid },
    clearErrors,
  } = useForm<LookupFormData>({
    mode: "onChange",
    defaultValues: {
      domain: "",
      type: "A",
    },
  });

  const selectedType = watch("type");
  const domainValue = watch("domain");

  // Re-validate domain when type changes
  useEffect(() => {
    if (domainValue) {
      // Clear any existing errors first, then re-validate
      clearErrors("domain");
      trigger("domain");
    } else {
      // Clear errors if domain is empty when switching types
      clearErrors("domain");
    }
  }, [selectedType, trigger, domainValue, clearErrors]);

  const lookup = useMutation<
    Awaited<ReturnType<typeof api.lookupDNS>>,
    Error,
    LookupFormData
  >({
    mutationFn: (data: LookupFormData) => api.lookupDNS(data.domain, data.type),
  });

  const onSubmit = (data: LookupFormData) => {
    lookup.mutate(data);
  };

  return (
    <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        DNS Lookup
      </h2>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          label={selectedType === "PTR" ? "IP Address" : "Domain or IP"}
          required
          error={errors.domain?.message}
        >
          <div className="flex gap-2">
            <Input
              type="text"
              {...register("domain", {
                required:
                  selectedType === "PTR"
                    ? "IP address is required"
                    : "Domain or IP is required",
                validate: (value) => {
                  // Remove any whitespace
                  const trimmed = value.trim();
                  if (trimmed !== value) {
                    return "Domain/IP cannot contain spaces";
                  }

                  // Basic validation: no spaces, tabs, or other whitespace
                  if (/\s/.test(value)) {
                    return "Domain/IP cannot contain spaces";
                  }

                  if (selectedType === "PTR" && !isValidIP(trimmed)) {
                    return "PTR queries require a valid IP address (IPv4 or IPv6)";
                  }

                  return true;
                },
              })}
              onKeyDown={(e) => {
                // Prevent spaces from being entered
                if (e.key === " ") {
                  e.preventDefault();
                }
              }}
              onPaste={(e) => {
                // Remove spaces from pasted content
                const pastedText = e.clipboardData.getData("text");
                if (pastedText.includes(" ")) {
                  e.preventDefault();
                  const cleaned = pastedText.replace(/\s/g, "");
                  e.currentTarget.value = cleaned;
                  // Trigger validation after paste
                  setTimeout(() => {
                    trigger("domain");
                  }, 0);
                }
              }}
              placeholder={
                selectedType === "PTR"
                  ? "e.g., 8.8.8.8 or 2001:4860:4860::8888"
                  : "e.g., example.com or 8.8.8.8"
              }
              className={cn("flex-1", errors.domain && "border-red-500")}
            />
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
              <option value="PTR">PTR (Reverse)</option>
              <option value="SRV">SRV</option>
              <option value="SOA">SOA</option>
            </Select>
            <Button type="submit" disabled={!isValid || lookup.isPending}>
              {lookup.isPending ? "Looking up..." : "Lookup"}
            </Button>
          </div>
        </FormField>

        {lookup.isError && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded text-red-300">
            Error: {(lookup.error as Error).message}
          </div>
        )}

        {lookup.isSuccess && lookup.data && (
          <div className="p-4 bg-gray-100 dark:bg-gray-700/50 rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Results
            </h3>
            <div className="space-y-2 min-w-0">
              <div>
                <span className="text-gray-600 dark:text-gray-400">
                  Domain:
                </span>{" "}
                <span className="text-gray-900 dark:text-white font-mono">
                  {lookup.data.domain}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Type:</span>{" "}
                <span className="text-gray-900 dark:text-white">
                  {lookup.data.type}
                </span>
              </div>
              {lookup.data.answers && lookup.data.answers.length > 0 && (
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    Answers:
                  </span>
                  <div className="mt-1 space-y-1">
                    {lookup.data.answers.map(
                      (
                        answer: { name: string; type: number; data: string },
                        idx: number
                      ) => (
                        <div
                          key={idx}
                          className="text-gray-900 dark:text-white font-mono text-sm pl-4 break-words break-all"
                        >
                          • {answer.data}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
              {lookup.data.addresses && lookup.data.addresses.length > 0 && (
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    Addresses:
                  </span>
                  <div className="mt-1 space-y-1">
                    {lookup.data.addresses.map((addr: string, idx: number) => (
                      <div
                        key={idx}
                        className="text-gray-900 dark:text-white font-mono text-sm pl-4"
                      >
                        • {addr}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {lookup.data.hostnames && lookup.data.hostnames.length > 0 && (
                <div>
                  <span className="text-gray-600 dark:text-gray-400">
                    Hostnames:
                  </span>
                  <div className="mt-1 space-y-1">
                    {lookup.data.hostnames.map(
                      (hostname: string, idx: number) => (
                        <div
                          key={idx}
                          className="text-gray-900 dark:text-white font-mono text-sm pl-4"
                        >
                          • {hostname}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
