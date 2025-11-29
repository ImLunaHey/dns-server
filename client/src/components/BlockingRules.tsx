import { Panel } from "./Panel";
import { Toggle } from "./Toggle";
import { DomainListEditor } from "./DomainListEditor";

interface BlockingRulesProps {
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  allowlist: Array<{ id: number; domain: string; addedAt: number }>;
  blocklist: Array<{ id: number; domain: string; addedAt: number }>;
  onAddAllowlist: (domain: string) => void;
  onRemoveAllowlist: (domain: string) => void;
  onAddBlocklist: (domain: string) => void;
  onRemoveBlocklist: (domain: string) => void;
  isLoading?: boolean;
  title?: string;
}

export function BlockingRules({
  enabled,
  onToggleEnabled,
  allowlist,
  blocklist,
  onAddAllowlist,
  onRemoveAllowlist,
  onAddBlocklist,
  onRemoveBlocklist,
  isLoading = false,
  title = "Blocking Rules",
}: BlockingRulesProps) {
  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <Panel>
        <Toggle
          enabled={enabled}
          onChange={onToggleEnabled}
          disabled={isLoading}
          label={title}
          description={
            enabled
              ? "Blocking is enabled for this client/group"
              : "Blocking is disabled for this client/group"
          }
          enabledLabel="Disable Blocking"
          disabledLabel="Enable Blocking"
        />
      </Panel>

      {/* Allowlist */}
      <DomainListEditor
        title="Allowlist"
        description="Domains that should never be blocked for this client/group"
        domains={allowlist}
        onAdd={onAddAllowlist}
        onRemove={onRemoveAllowlist}
        isLoading={isLoading}
        emptyMessage="No domains in allowlist"
      />

      {/* Blocklist */}
      <DomainListEditor
        title="Blocklist"
        description="Domains that should always be blocked for this client/group (in addition to global blocklist)"
        domains={blocklist}
        onAdd={onAddBlocklist}
        onRemove={onRemoveBlocklist}
        isLoading={isLoading}
        emptyMessage="No domains in blocklist"
      />
    </div>
  );
}

