import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ComponentPlaygroundConfig } from "../components/playground.types";
import { Button } from "../components/Button";
import { Panel } from "../components/Panel";
import { cn } from "../lib/cn";
import { useSession } from "../lib/auth";
import { useNavigate, useSearch } from "@tanstack/react-router";

// Import playground configs
import { InputPlayground } from "../components/Input.playground";
import { FormFieldPlayground } from "../components/FormField.playground";
import { ToggleGroupPlayground } from "../components/ToggleGroup.playground";
import { SelectPlayground } from "../components/Select.playground";
import { LoadingPlayground } from "../components/Loading.playground";
import { ButtonPlayground } from "../components/Button.playground";
import { PanelPlayground } from "../components/Panel.playground";
import { StatsCardPlayground } from "../components/StatsCard.playground";
import { DataTablePlayground } from "../components/DataTable.playground";
import { ChartPlayground } from "../components/Chart.playground";
import { RankedListPlayground } from "../components/RankedList.playground";
import { PageHeaderPlayground } from "../components/PageHeader.playground";
import { SearchInputPlayground } from "../components/SearchInput.playground";
import { ErrorPagePlayground } from "../components/ErrorPage.playground";
import { BadgePlayground } from "../components/Badge.playground";
import { AlertPlayground } from "../components/Alert.playground";
import { CodeBlockPlayground } from "../components/CodeBlock.playground";
import { TogglePlayground } from "../components/Toggle.playground";
import { EmptyStatePlayground } from "../components/EmptyState.playground";

// Collect all playground configs
export const componentConfigs = [
  LoadingPlayground,
  ButtonPlayground,
  PanelPlayground,
  StatsCardPlayground,
  DataTablePlayground,
  ChartPlayground,
  RankedListPlayground,
  PageHeaderPlayground,
  InputPlayground,
  SearchInputPlayground,
  ErrorPagePlayground,
  FormFieldPlayground,
  ToggleGroupPlayground,
  SelectPlayground,
  BadgePlayground,
  AlertPlayground,
  CodeBlockPlayground,
  TogglePlayground,
  EmptyStatePlayground,
];

function ComponentPlayground({
  config,
}: {
  config: ComponentPlaygroundConfig;
}) {
  const defaultProps = Object.fromEntries(
    config.controls.map((control) => [control.key, control.defaultValue])
  );
  const [props, setProps] = useState<Record<string, unknown>>(defaultProps);

  const updateProp = (key: string, value: unknown) => {
    setProps((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Panel className="mb-8">
      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">
        {config.name} Component
      </h2>

      {/* Controls */}
      <div className="space-y-6 mb-8">
        {config.controls.map((control) => (
          <div key={control.key}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {control.label}
            </label>
            {control.type === "select" && control.options ? (
              <div className="flex gap-2 flex-wrap">
                {control.options.map((option) => (
                  <Button
                    key={option.value}
                    onClick={() => updateProp(control.key, option.value)}
                    color={
                      props[control.key] === option.value ? "blue" : "gray"
                    }
                    variant={
                      props[control.key] === option.value ? "solid" : "outline"
                    }
                    size="sm"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            ) : control.type === "toggle" ? (
              <Button
                onClick={() => updateProp(control.key, !props[control.key])}
                color={props[control.key] ? "blue" : "gray"}
                variant={props[control.key] ? "solid" : "outline"}
                size="sm"
              >
                {props[control.key] ? "Enabled" : "Disabled"}
              </Button>
            ) : (
              <div>
                <input
                  type={control.type}
                  value={(props[control.key] as string) || ""}
                  onChange={(e) =>
                    updateProp(
                      control.key,
                      control.type === "number"
                        ? Number(e.target.value)
                        : e.target.value
                    )
                  }
                  placeholder={control.label}
                  className={cn(
                    "w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500"
                  )}
                />
                {control.type === "text" && (
                  <button
                    onClick={() => updateProp(control.key, "")}
                    className="mt-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Preview */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Preview
        </h3>
        <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-8 flex items-center justify-center min-h-[200px] w-full overflow-x-auto">
          <div className="w-full max-w-full">
            {config.render(props, { setProps: updateProp })}
          </div>
        </div>
      </div>

      {/* Code Example */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Code
        </h3>
        <pre className="bg-gray-900 dark:bg-black rounded-lg p-4 overflow-x-auto">
          <code className="text-sm text-gray-300">{config.codeGen(props)}</code>
        </pre>
      </div>
    </Panel>
  );
}

export const Route = createFileRoute("/ui-components")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      component: (search.component as string) || undefined,
    };
  },
  component: () => {
    const { data: session } = useSession();
    const navigate = useNavigate();
    const search = useSearch({ from: "/ui-components" });
    const selectedComponent = search.component;

    // Only show in dev mode
    if (!import.meta.env.DEV) {
      return null;
    }

    // Require authentication
    if (!session?.user) {
      navigate({ to: "/login" });
      return null;
    }

    const filteredConfigs = selectedComponent
      ? componentConfigs.filter(
          (c) => c.name.toLowerCase() === selectedComponent.toLowerCase()
        )
      : componentConfigs;

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black">
        <header className="bg-white dark:bg-black shadow-lg border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              UI Components (Dev Only)
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Interactive component playground
            </p>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {filteredConfigs.map((config) => (
            <ComponentPlayground key={config.name} config={config} />
          ))}
        </main>
      </div>
    );
  },
});
