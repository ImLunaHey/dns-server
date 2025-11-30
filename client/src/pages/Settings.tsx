import { useForm } from "react-hook-form";
import { z } from "zod";
import { useEffect } from "react";
import {
  useSettings,
  useUpdateSettings,
  useClearCache,
} from "../hooks/useSettings";
import { cn } from "../lib/cn";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { Loading } from "../components/Loading";
import { useToastContext } from "../contexts/ToastContext";

const KNOWN_DNS_PROVIDERS = [
  {
    name: "Cloudflare",
    ipv4: ["1.1.1.1", "1.0.0.1"],
    ipv6: ["2606:4700:4700::1111", "2606:4700:4700::1001"],
  },
  {
    name: "Google",
    ipv4: ["8.8.8.8", "8.8.4.4"],
    ipv6: ["2001:4860:4860::8888", "2001:4860:4860::8844"],
  },
  {
    name: "Quad9",
    ipv4: ["9.9.9.9", "149.112.112.112"],
    ipv6: ["2620:fe::fe", "2620:fe::9"],
  },
  {
    name: "OpenDNS",
    ipv4: ["208.67.222.222", "208.67.220.220"],
    ipv6: ["2620:119:35::35", "2620:119:53::53"],
  },
  {
    name: "DNS.WATCH",
    ipv4: ["84.200.69.80", "84.200.70.40"],
    ipv6: ["2001:1608:10:25::1c04:b12f", "2001:1608:10:25::9249:d69b"],
  },
  {
    name: "Level3",
    ipv4: ["4.2.2.1", "4.2.2.2"],
    ipv6: null,
  },
  {
    name: "Norton",
    ipv4: ["199.85.126.10", "199.85.127.10"],
    ipv6: null,
  },
  {
    name: "Comodo",
    ipv4: ["8.26.56.26", "8.20.247.20"],
    ipv6: null,
  },
];

const settingsSchema = z.object({
  upstreamDNS: z.string().min(1, "Upstream DNS is required"),
  queryRetentionDays: z.number().int().min(1).max(365),
  privacyMode: z.boolean(),
  rateLimitEnabled: z.boolean(),
  rateLimitMaxQueries: z.number().int().min(1),
  rateLimitWindowMs: z.number().int().min(1000),
  cacheEnabled: z.boolean(),
  blockPageEnabled: z.boolean(),
  blockPageIP: z.string().nullable(),
  blockPageIPv6: z.string().nullable(),
  dotEnabled: z.boolean().optional(),
  dotPort: z.number().int().min(1).max(65535).optional(),
  dotCertPath: z.string().optional(),
  dotKeyPath: z.string().optional(),
  doqEnabled: z.boolean().optional(),
  doqPort: z.number().int().min(1).max(65535).optional(),
  doqCertPath: z.string().optional(),
  doqKeyPath: z.string().optional(),
  dnssecValidation: z.boolean().optional(),
  dnssecChainValidation: z.boolean().optional(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export function Settings() {
  "use no memo";
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const clearCache = useClearCache();
  const toast = useToastContext();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    trigger,
    formState: { errors, isValid, isDirty },
  } = useForm<SettingsFormData>({
    mode: "onChange", // Validate on change to show errors immediately
    defaultValues: {
      upstreamDNS: settings?.upstreamDNS || settings?.upstreamDNSList?.join(",") || "1.1.1.1",
      queryRetentionDays: settings?.queryRetentionDays ?? 7,
      privacyMode: Boolean(settings?.privacyMode ?? false),
      rateLimitEnabled: Boolean(settings?.rateLimitEnabled ?? false),
      rateLimitMaxQueries: settings?.rateLimitMaxQueries ?? 1000,
      rateLimitWindowMs: settings?.rateLimitWindowMs ?? 60000,
      cacheEnabled: Boolean(settings?.cacheEnabled ?? true),
      blockPageEnabled: Boolean(settings?.blockPageEnabled ?? false),
      blockPageIP: settings?.blockPageIP ?? null,
      blockPageIPv6: settings?.blockPageIPv6 ?? null,
      dotEnabled: Boolean(settings?.dotEnabled ?? false),
      dotPort: settings?.dotPort ?? 853,
      dotCertPath: settings?.dotCertPath ?? "",
      dotKeyPath: settings?.dotKeyPath ?? "",
      dnssecValidation: Boolean(settings?.dnssecValidation ?? false),
      dnssecChainValidation: Boolean(settings?.dnssecChainValidation ?? false),
    },
  });

  // Reset form when settings are loaded or updated
  useEffect(() => {
    if (settings) {
      reset({
        upstreamDNS: settings.upstreamDNS || settings.upstreamDNSList?.join(",") || "1.1.1.1",
        queryRetentionDays: settings.queryRetentionDays ?? 7,
        privacyMode: Boolean(settings.privacyMode ?? false),
        rateLimitEnabled: Boolean(settings.rateLimitEnabled ?? false),
        rateLimitMaxQueries: settings.rateLimitMaxQueries ?? 1000,
        rateLimitWindowMs: settings.rateLimitWindowMs ?? 60000,
        cacheEnabled: Boolean(settings.cacheEnabled ?? true),
        blockPageEnabled: Boolean(settings.blockPageEnabled ?? false),
        blockPageIP: settings.blockPageIP ?? null,
        blockPageIPv6: settings.blockPageIPv6 ?? null,
        dotEnabled: Boolean(settings.dotEnabled ?? false),
        dotPort: settings.dotPort ?? 853,
        dotCertPath: settings.dotCertPath ?? "",
        dotKeyPath: settings.dotKeyPath ?? "",
        doqEnabled:
          Boolean(settings.doqEnabled ?? false) &&
          (settings.doqSupported ?? false),
        doqPort: settings.doqPort ?? 853,
        doqCertPath: settings.doqCertPath ?? settings.dotCertPath ?? "",
        doqKeyPath: settings.doqKeyPath ?? settings.dotKeyPath ?? "",
        dnssecValidation: Boolean(settings.dnssecValidation ?? false),
        dnssecChainValidation: Boolean(settings.dnssecChainValidation ?? false),
      });
    }
  }, [settings, reset]);

  const rateLimitEnabled = watch("rateLimitEnabled");
  const cacheEnabled = watch("cacheEnabled");
  const blockPageEnabled = watch("blockPageEnabled");
  const upstreamDNS = watch("upstreamDNS");
  const rateLimitWindowMs = watch("rateLimitWindowMs");
  const dotEnabled = watch("dotEnabled");
  const dnssecValidation = watch("dnssecValidation");

  // Re-validate DoT fields when dotEnabled changes
  useEffect(() => {
    if (dotEnabled !== undefined) {
      trigger(["dotCertPath", "dotKeyPath"]);
    }
  }, [dotEnabled, trigger]);

  const onSubmit = async (data: SettingsFormData) => {
    // Validate with zod schema
    const result = settingsSchema.safeParse(data);
    if (!result.success) {
      const errorMessages = result.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      toast.error(
        `Please fix ${result.error.issues.length} error${
          result.error.issues.length > 1 ? "s" : ""
        }: ${errorMessages.join(", ")}${
          result.error.issues.length > 3 ? "..." : ""
        }`
      );
      return;
    }

    try {
      // Convert null to undefined for API compatibility
      const settingsToSave = {
        ...result.data,
        blockPageIP: result.data.blockPageIP ?? undefined,
        blockPageIPv6: result.data.blockPageIPv6 ?? undefined,
      };
      await updateSettings.mutateAsync(settingsToSave);
      toast.success("Settings saved successfully");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Failed to save settings: ${error.message}`
          : "Failed to save settings"
      );
    }
  };

  if (isLoading || !settings) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure DNS server settings"
      />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* DNS Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              DNS Settings
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Upstream DNS Server
                </label>

                {/* Known DNS Providers */}
                <div className="mb-4">
                  <p className="text-xs text-gray-400 mb-3">
                    Predefined DNS Servers
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {KNOWN_DNS_PROVIDERS.map((provider) => (
                      <div
                        key={provider.name}
                        className="border border-gray-600 rounded-lg p-3 bg-gray-700/50 hover:bg-gray-700 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-white">
                            {provider.name}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <button
                            type="button"
                            onClick={() =>
                              setValue("upstreamDNS", provider.ipv4.join(","))
                            }
                            className={cn(
                              "w-full text-left px-2 py-1 text-xs rounded",
                              "bg-gray-600 hover:bg-gray-500 text-gray-200",
                              (upstreamDNS === provider.ipv4[0] || upstreamDNS === provider.ipv4.join(",")) &&
                                "bg-blue-600 hover:bg-blue-700 text-white"
                            )}
                            title={`Primary: ${provider.ipv4[0]}, Secondary: ${provider.ipv4[1]} (both will be set for failover)`}
                          >
                            IPv4: {provider.ipv4[0]}
                          </button>
                          {provider.ipv6 && (
                            <button
                              type="button"
                              onClick={() =>
                                setValue("upstreamDNS", provider.ipv6!.join(","))
                              }
                              className={cn(
                                "w-full text-left px-2 py-1 text-xs rounded",
                                "bg-gray-600 hover:bg-gray-500 text-gray-200",
                                (upstreamDNS === provider.ipv6[0] || upstreamDNS === provider.ipv6.join(",")) &&
                                  "bg-blue-600 hover:bg-blue-700 text-white"
                              )}
                              title={`Primary: ${provider.ipv6[0]}, Secondary: ${provider.ipv6[1]} (both will be set for failover)`}
                            >
                              IPv6: {provider.ipv6[0].substring(0, 20)}...
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Custom DNS Input */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">
                    Custom DNS Server
                  </label>
                  <FormField label="" error={errors.upstreamDNS?.message}>
                    <input
                      type="text"
                      {...register("upstreamDNS", {
                        required: "Upstream DNS is required",
                        validate: (value) => {
                          if (!value || value.trim() === "") {
                            return "Upstream DNS is required";
                          }
                          const result =
                            settingsSchema.shape.upstreamDNS.safeParse(value);
                          return (
                            result.success || result.error.issues[0]?.message
                          );
                        },
                      })}
                      placeholder="1.1.1.1 or 1.1.1.1,8.8.8.8,9.9.9.9 (comma-separated for failover)"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.upstreamDNS && "border-red-500"
                      )}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      IP address(es) of upstream DNS server(s). Multiple servers can be comma-separated for automatic failover (e.g., 1.1.1.1,8.8.8.8). Supports IP addresses, DoH (https://), and DoT (tls://) URLs.
                    </p>
                  </FormField>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  DNS Server Port
                </label>
                <input
                  type="text"
                  value={settings.dnsPort}
                  disabled
                  className={cn(
                    "w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded text-gray-400",
                    "cursor-not-allowed"
                  )}
                />
                <p className="text-xs text-gray-400 mt-1">
                  DNS server port (cannot be changed at runtime)
                </p>
              </div>
            </div>
          </Panel>

          {/* Privacy Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              Privacy Settings
            </h2>

            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Privacy Mode
                </label>
                <p className="text-xs text-gray-400">
                  Hide client IP addresses in query logs
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  {...register("privacyMode", {
                    onChange: (e) =>
                      setValue("privacyMode", Boolean(e.target.checked)),
                  })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </Panel>

          {/* Rate Limiting */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              Rate Limiting
            </h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Enable Rate Limiting
                  </label>
                  <p className="text-xs text-gray-400">
                    Limit queries per client to prevent abuse
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    {...register("rateLimitEnabled", {
                      onChange: (e) =>
                        setValue("rateLimitEnabled", Boolean(e.target.checked)),
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {rateLimitEnabled && (
                <>
                  <FormField
                    label="Max Queries per Window"
                    error={errors.rateLimitMaxQueries?.message}
                  >
                    <input
                      type="number"
                      {...register("rateLimitMaxQueries", {
                        valueAsNumber: true,
                        validate: (value) => {
                          const result =
                            settingsSchema.shape.rateLimitMaxQueries.safeParse(
                              value
                            );
                          return (
                            result.success || result.error.issues[0]?.message
                          );
                        },
                      })}
                      min="1"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.rateLimitMaxQueries && "border-red-500"
                      )}
                    />
                  </FormField>

                  <FormField
                    label="Time Window (milliseconds)"
                    error={errors.rateLimitWindowMs?.message}
                  >
                    <input
                      type="number"
                      {...register("rateLimitWindowMs", {
                        valueAsNumber: true,
                        validate: (value) => {
                          const result =
                            settingsSchema.shape.rateLimitWindowMs.safeParse(
                              value
                            );
                          return (
                            result.success || result.error.issues[0]?.message
                          );
                        },
                      })}
                      min="1000"
                      step="1000"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.rateLimitWindowMs && "border-red-500"
                      )}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      {rateLimitWindowMs / 1000} seconds
                    </p>
                  </FormField>
                </>
              )}
            </div>
          </Panel>

          {/* Cache Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              DNS Cache Settings
            </h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Enable DNS Caching
                  </label>
                  <p className="text-xs text-gray-400">
                    Cache DNS responses to reduce upstream queries
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    {...register("cacheEnabled", {
                      onChange: (e) =>
                        setValue("cacheEnabled", Boolean(e.target.checked)),
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {settings?.cacheSize !== undefined && (
                <div className="text-sm text-gray-400">
                  Current cache size: {settings.cacheSize} entries
                </div>
              )}

              <div className="pt-4 border-t border-gray-700">
                <Button
                  type="button"
                  onClick={() => {
                    clearCache.mutate(undefined, {
                      onSuccess: () => {
                        toast.success("Cache cleared successfully");
                      },
                      onError: (error) => {
                        toast.error(
                          error instanceof Error
                            ? `Failed to clear cache: ${error.message}`
                            : "Failed to clear cache"
                        );
                      },
                    });
                  }}
                  disabled={clearCache.isPending || !cacheEnabled}
                  color="orange"
                >
                  {clearCache.isPending ? "Clearing..." : "Clear Cache"}
                </Button>
                <p className="text-xs text-gray-400 mt-2">
                  Remove all cached DNS responses from memory
                </p>
              </div>
            </div>
          </Panel>

          {/* Block Page Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              Block Page Settings
            </h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Enable Block Page
                  </label>
                  <p className="text-xs text-gray-400">
                    Return IP address instead of NXDOMAIN for blocked domains
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    {...register("blockPageEnabled", {
                      onChange: (e) =>
                        setValue("blockPageEnabled", Boolean(e.target.checked)),
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {blockPageEnabled && (
                <>
                  <FormField
                    label="Block Page IPv4 Address"
                    error={errors.blockPageIP?.message}
                  >
                    <input
                      type="text"
                      {...register("blockPageIP", {
                        validate: (value) => {
                          const result =
                            settingsSchema.shape.blockPageIP.safeParse(value);
                          return (
                            result.success || result.error.issues[0]?.message
                          );
                        },
                      })}
                      placeholder="0.0.0.0"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.blockPageIP && "border-red-500"
                      )}
                    />
                  </FormField>

                  <FormField label="Block Page IPv6 Address">
                    <input
                      type="text"
                      {...register("blockPageIPv6", {
                        validate: (value) => {
                          const result =
                            settingsSchema.shape.blockPageIPv6.safeParse(value);
                          return (
                            result.success || result.error.issues[0]?.message
                          );
                        },
                      })}
                      placeholder="::"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500"
                      )}
                    />
                  </FormField>
                </>
              )}
            </div>
          </Panel>

          {/* DNS-over-TLS (DoT) Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              DNS-over-TLS (DoT) Settings
            </h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Enable DNS-over-TLS
                  </label>
                  <p className="text-xs text-gray-400">
                    Enable encrypted DNS over TLS on port 853
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    {...register("dotEnabled", {
                      onChange: (e) =>
                        setValue("dotEnabled", Boolean(e.target.checked)),
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {dotEnabled && (
                <>
                  <FormField label="DoT Port" error={errors.dotPort?.message}>
                    <input
                      type="number"
                      {...register("dotPort", {
                        valueAsNumber: true,
                      })}
                      min="1"
                      max="65535"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.dotPort && "border-red-500"
                      )}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Port for DNS-over-TLS (default: 853)
                    </p>
                  </FormField>

                  <FormField
                    label="Certificate Path"
                    error={errors.dotCertPath?.message}
                  >
                    <input
                      type="text"
                      {...register("dotCertPath", {
                        validate: (value) => {
                          if (dotEnabled && (!value || !value.trim())) {
                            return "Certificate path is required when DoT is enabled";
                          }
                          return true;
                        },
                      })}
                      placeholder="server/certs/dot.crt"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.dotCertPath && "border-red-500"
                      )}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Path to TLS certificate file (relative to project root or
                      absolute)
                    </p>
                  </FormField>

                  <FormField
                    label="Private Key Path"
                    error={errors.dotKeyPath?.message}
                  >
                    <input
                      type="text"
                      {...register("dotKeyPath", {
                        validate: (value) => {
                          if (dotEnabled && (!value || !value.trim())) {
                            return "Private key path is required when DoT is enabled";
                          }
                          return true;
                        },
                      })}
                      placeholder="server/certs/dot.key"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.dotKeyPath && "border-red-500"
                      )}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Path to TLS private key file (relative to project root or
                      absolute)
                    </p>
                  </FormField>

                  <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3">
                    <p className="text-xs text-blue-300">
                      <strong>Note:</strong> You need to generate TLS
                      certificates first. Run{" "}
                      <code className="bg-blue-900/50 px-1 rounded">
                        node generate-dot-certs.js
                      </code>{" "}
                      to create self-signed certificates for testing.
                    </p>
                  </div>
                </>
              )}
            </div>
          </Panel>

          {/* DNS-over-QUIC (DoQ) Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              DNS-over-QUIC (DoQ) Settings
            </h2>

            <div className="space-y-4">
              {!settings?.doqSupported && (
                <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 mb-4">
                  <p className="text-xs text-yellow-300">
                    <strong>DoQ not available:</strong> DoQ requires Node.js
                    25+.
                    {settings?.nodeVersion && (
                      <>
                        {" "}
                        Current version:{" "}
                        <code className="bg-yellow-900/50 px-1 rounded">
                          {settings.nodeVersion}
                        </code>
                      </>
                    )}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Enable DNS-over-QUIC
                  </label>
                  <p className="text-xs text-gray-400">
                    Enable encrypted DNS over QUIC protocol (RFC 9250)
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    {...register("doqEnabled", {
                      onChange: (e) =>
                        setValue("doqEnabled", Boolean(e.target.checked)),
                    })}
                    disabled={!settings?.doqSupported}
                    className="sr-only peer disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div
                    className={cn(
                      "w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600",
                      !settings?.doqSupported && "opacity-50 cursor-not-allowed"
                    )}
                  ></div>
                </label>
              </div>

              {watch("doqEnabled") && settings?.doqSupported && (
                <>
                  <FormField label="DoQ Port" error={errors.doqPort?.message}>
                    <input
                      type="number"
                      {...register("doqPort", {
                        valueAsNumber: true,
                      })}
                      min="1"
                      max="65535"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.doqPort && "border-red-500"
                      )}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Port for DNS-over-QUIC (default: 853, same as DoT)
                    </p>
                  </FormField>

                  <FormField
                    label="Certificate Path (optional)"
                    error={errors.doqCertPath?.message}
                  >
                    <input
                      type="text"
                      {...register("doqCertPath")}
                      placeholder="server/certs/doq.crt (or reuse DoT cert)"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.doqCertPath && "border-red-500"
                      )}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Path to TLS certificate file. If empty, DoT certificate
                      will be used.
                    </p>
                  </FormField>

                  <FormField
                    label="Private Key Path (optional)"
                    error={errors.doqKeyPath?.message}
                  >
                    <input
                      type="text"
                      {...register("doqKeyPath")}
                      placeholder="server/certs/doq.key (or reuse DoT key)"
                      className={cn(
                        "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500",
                        errors.doqKeyPath && "border-red-500"
                      )}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Path to TLS private key file. If empty, DoT key will be
                      used.
                    </p>
                  </FormField>

                  <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3">
                    <p className="text-xs text-blue-300">
                      <strong>Note:</strong> DoQ can reuse DoT certificates if
                      paths are left empty.
                    </p>
                  </div>
                </>
              )}
            </div>
          </Panel>

          {/* DNSSEC Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              DNSSEC Validation Settings
            </h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Enable DNSSEC Validation
                  </label>
                  <p className="text-xs text-gray-400">
                    Validate DNSSEC signatures in DNS responses
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    {...register("dnssecValidation", {
                      onChange: (e) =>
                        setValue("dnssecValidation", Boolean(e.target.checked)),
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {dnssecValidation && (
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Enable Chain of Trust Validation
                    </label>
                    <p className="text-xs text-gray-400">
                      Validate the complete chain from root to domain (requires
                      additional DNS queries)
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      {...register("dnssecChainValidation", {
                        onChange: (e) =>
                          setValue(
                            "dnssecChainValidation",
                            Boolean(e.target.checked)
                          ),
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              )}

              <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3">
                <p className="text-xs text-blue-300">
                  <strong>Note:</strong> DNSSEC validation requires responses
                  with RRSIG records. Some upstream DNS servers validate DNSSEC
                  but don't return raw DNSSEC records. Chain of trust validation
                  requires additional DNS queries and may slow down responses.
                </p>
              </div>
            </div>
          </Panel>

          {/* DNS-over-HTTPS (DoH) Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              DNS-over-HTTPS (DoH) Settings
            </h2>

            <div className="space-y-4">
              <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">
                    DoH Status
                  </span>
                  <span className="text-xs px-2 py-1 bg-green-600 text-white rounded">
                    Enabled
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  DNS-over-HTTPS is always enabled and available at:
                </p>
                <div className="mt-2 space-y-1">
                  <code className="block text-xs bg-gray-800 px-2 py-1 rounded text-gray-300">
                    http://localhost:3001/dns-query
                  </code>
                  <p className="text-xs text-gray-500 mt-1">
                    Supports both binary (RFC 8484) and JSON (Cloudflare-style)
                    formats
                  </p>
                </div>
              </div>

              <div className="text-xs text-gray-400">
                <p className="mb-2">
                  <strong>Binary format:</strong> Use{" "}
                  <code className="bg-gray-800 px-1 rounded">
                    application/dns-message
                  </code>{" "}
                  content type
                </p>
                <p>
                  <strong>JSON format:</strong> Use{" "}
                  <code className="bg-gray-800 px-1 rounded">
                    application/dns-json
                  </code>{" "}
                  content type
                </p>
              </div>
            </div>
          </Panel>

          {/* Data Settings */}
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              Data Settings
            </h2>

            <FormField
              label="Query Retention (Days)"
              error={errors.queryRetentionDays?.message}
            >
              <input
                type="number"
                {...register("queryRetentionDays", {
                  valueAsNumber: true,
                  validate: (value) => {
                    const result =
                      settingsSchema.shape.queryRetentionDays.safeParse(value);
                    return result.success || result.error.issues[0]?.message;
                  },
                })}
                min="1"
                max="365"
                className={cn(
                  "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500",
                  errors.queryRetentionDays && "border-red-500"
                )}
              />
              <p className="text-xs text-gray-400 mt-1">
                Number of days to keep query history (1-365)
              </p>
            </FormField>
          </Panel>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={updateSettings.isPending || (!isValid && isDirty)}
            >
              {updateSettings.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
          {!isValid && isDirty && (
            <div className="text-sm text-red-500 text-right">
              Please fix the errors above before saving
            </div>
          )}
        </form>
      </main>
    </>
  );
}
