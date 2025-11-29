import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { FormField } from "../components/FormField";
import { Loading } from "../components/Loading";

export function BlockPageSettings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["blockPageSettings"],
    queryFn: () => api.getBlockPageSettings(),
  });

  const updateMutation = useMutation({
    mutationFn: (settings: {
      title?: string;
      message?: string;
      backgroundColor?: string;
      textColor?: string;
      logoUrl?: string;
    }) => api.updateBlockPageSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blockPageSettings"] });
    },
  });

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [textColor, setTextColor] = useState("#000000");
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    if (settings) {
      setTitle(settings.title || "");
      setMessage(settings.message || "");
      setBackgroundColor(settings.backgroundColor || "#ffffff");
      setTextColor(settings.textColor || "#000000");
      setLogoUrl(settings.logoUrl || "");
    }
  }, [settings]);

  const handleSave = () => {
    updateMutation.mutate({
      title: title || undefined,
      message: message || undefined,
      backgroundColor: backgroundColor || undefined,
      textColor: textColor || undefined,
      logoUrl: logoUrl || undefined,
    });
  };

  const hasChanges =
    title !== (settings?.title || "") ||
    message !== (settings?.message || "") ||
    backgroundColor !== (settings?.backgroundColor || "#ffffff") ||
    textColor !== (settings?.textColor || "#000000") ||
    logoUrl !== (settings?.logoUrl || "");

  if (isLoading || !settings) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Block Page Customization"
        description="Customize the appearance of the block page shown to users"
      />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              Block Page Content
            </h2>

            <div className="space-y-4">
              <FormField label="Title">
                <Input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Blocked"
                />
              </FormField>

              <FormField label="Message">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="This domain has been blocked by your DNS server."
                  rows={4}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Use {"{{domain}}"} to insert the blocked domain name
                </p>
              </FormField>
            </div>
          </Panel>

          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              Appearance
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Background Color">
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="w-20 h-10"
                    />
                    <Input
                      type="text"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      placeholder="#ffffff"
                    />
                  </div>
                </FormField>

                <FormField label="Text Color">
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-20 h-10"
                    />
                    <Input
                      type="text"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      placeholder="#000000"
                    />
                  </div>
                </FormField>
              </div>

              <FormField label="Logo URL (optional)">
                <Input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                />
                <p className="text-xs text-gray-400 mt-1">
                  URL to an image to display on the block page
                </p>
              </FormField>
            </div>
          </Panel>

          <Panel>
            <h2 className="text-xl font-semibold text-white mb-6">
              Preview
            </h2>

            <div
              className="p-8 rounded-lg border border-gray-600"
              style={{
                backgroundColor: backgroundColor || "#ffffff",
                color: textColor || "#000000",
              }}
            >
              <div className="text-center">
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="max-w-[200px] mx-auto mb-4"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <h1 className="text-3xl font-bold mb-4">
                  {title || "Blocked"}
                </h1>
                <p className="text-lg mb-2">
                  {(message || "This domain has been blocked by your DNS server.").replace(
                    "{{domain}}",
                    "example.com"
                  )}
                </p>
                <p className="font-mono font-bold">example.com</p>
              </div>
            </div>
          </Panel>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending || !hasChanges}
            >
              {updateMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}

