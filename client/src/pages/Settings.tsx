import { useForm } from "react-hook-form";
import { z } from "zod";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { cn } from "../lib/cn";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { Loading } from "../components/Loading";

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
  cacheTTL: z.number().int().min(60),
  blockPageEnabled: z.boolean(),
  blockPageIP: z.string().nullable(),
  blockPageIPv6: z.string().nullable(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export function Settings() {
  "use no memo";
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    setError,
  } = useForm<SettingsFormData>({
    defaultValues: {
      upstreamDNS: settings?.upstreamDNS || "1.1.1.1",
      queryRetentionDays: settings?.queryRetentionDays ?? 7,
      privacyMode: settings?.privacyMode ?? false,
      rateLimitEnabled: settings?.rateLimitEnabled ?? false,
      rateLimitMaxQueries: settings?.rateLimitMaxQueries ?? 1000,
      rateLimitWindowMs: settings?.rateLimitWindowMs ?? 60000,
      cacheEnabled: settings?.cacheEnabled ?? true,
      cacheTTL: settings?.cacheTTL ?? 300,
      blockPageEnabled: settings?.blockPageEnabled ?? false,
      blockPageIP: settings?.blockPageIP ?? null,
      blockPageIPv6: settings?.blockPageIPv6 ?? null,
    },
  });

  const rateLimitEnabled = watch("rateLimitEnabled");
  const cacheEnabled = watch("cacheEnabled");
  const blockPageEnabled = watch("blockPageEnabled");
  const upstreamDNS = watch("upstreamDNS");
  const rateLimitWindowMs = watch("rateLimitWindowMs");

  const onSubmit = async (data: SettingsFormData) => {
    const result = settingsSchema.safeParse(data);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const path = issue.path.join(".") as keyof SettingsFormData;
        setError(path, { message: issue.message });
      });
      return;
    }
    await updateSettings.mutateAsync(result.data);
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
                              setValue("upstreamDNS", provider.ipv4[0])
                            }
                            className={cn(
                              "w-full text-left px-2 py-1 text-xs rounded",
                              "bg-gray-600 hover:bg-gray-500 text-gray-200",
                              upstreamDNS === provider.ipv4[0] &&
                                "bg-blue-600 hover:bg-blue-700 text-white"
                            )}
                            title={`Primary: ${provider.ipv4[0]}, Secondary: ${provider.ipv4[1]}`}
                          >
                            IPv4: {provider.ipv4[0]}
                          </button>
                          {provider.ipv6 && (
                            <button
                              type="button"
                              onClick={() =>
                                setValue("upstreamDNS", provider.ipv6![0])
                              }
                              className={cn(
                                "w-full text-left px-2 py-1 text-xs rounded",
                                "bg-gray-600 hover:bg-gray-500 text-gray-200",
                                upstreamDNS === provider.ipv6[0] &&
                                  "bg-blue-600 hover:bg-blue-700 text-white"
                              )}
                              title={`Primary: ${provider.ipv6[0]}, Secondary: ${provider.ipv6[1]}`}
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
                  <input
                    type="text"
                    {...register("upstreamDNS", {
                      validate: (value) => {
                        const result =
                          settingsSchema.shape.upstreamDNS.safeParse(value);
                        return (
                          result.success || result.error.issues[0]?.message
                        );
                      },
                    })}
                    placeholder="1.1.1.1 or custom IP"
                    className={cn(
                      "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500",
                      errors.upstreamDNS && "border-red-500"
                    )}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    IP address of the upstream DNS server to forward queries to
                  </p>
                  {errors.upstreamDNS && (
                    <p className="text-red-400 text-sm mt-1">
                      {errors.upstreamDNS.message}
                    </p>
                  )}
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
                  {...register("privacyMode")}
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
                    {...register("rateLimitEnabled")}
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
                    {...register("cacheEnabled")}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {cacheEnabled && (
                <FormField
                  label="Cache TTL (seconds)"
                  error={errors.cacheTTL?.message}
                >
                  <input
                    type="number"
                    {...register("cacheTTL", {
                      valueAsNumber: true,
                      validate: (value) => {
                        const result =
                          settingsSchema.shape.cacheTTL.safeParse(value);
                        return (
                          result.success || result.error.issues[0]?.message
                        );
                      },
                    })}
                    min="60"
                    className={cn(
                      "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500",
                      errors.cacheTTL && "border-red-500"
                    )}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Time to live for cached DNS responses
                  </p>
                </FormField>
              )}

              {settings?.cacheSize !== undefined && (
                <div className="text-sm text-gray-400">
                  Current cache size: {settings.cacheSize} entries
                </div>
              )}
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
                    {...register("blockPageEnabled")}
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
            <Button type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </main>
    </>
  );
}
