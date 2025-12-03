import { ComponentPlaygroundConfig } from "./playground.types";
import { Toggle } from "./Toggle";

export const TogglePlayground = {
  name: "Toggle" as const,
  controls: [
    {
      key: "enabled" as const,
      label: "Enabled",
      type: "toggle" as const,
      defaultValue: false,
    },
    {
      key: "label" as const,
      label: "Label",
      type: "text" as const,
      defaultValue: "Feature Toggle",
    },
    {
      key: "description" as const,
      label: "Description",
      type: "text" as const,
      defaultValue: "Enable or disable this feature",
    },
    {
      key: "enabledLabel" as const,
      label: "Enabled Label",
      type: "text" as const,
      defaultValue: "Disable",
    },
    {
      key: "disabledLabel" as const,
      label: "Disabled Label",
      type: "text" as const,
      defaultValue: "Enable",
    },
  ],
  render: (props, helpers) => (
    <Toggle
      enabled={props.enabled as boolean}
      onChange={(value) => helpers?.setProps("enabled", value)}
      label={props.label as string}
      description={props.description as string}
      enabledLabel={props.enabledLabel as string}
      disabledLabel={props.disabledLabel as string}
    />
  ),
  codeGen: (props) => {
    const parts: string[] = [`enabled={${props.enabled}}`];
    parts.push(`onChange={(value) => setEnabled(value)}`);
    if (props.label) parts.push(`label="${props.label}"`);
    if (props.description) parts.push(`description="${props.description}"`);
    if (props.enabledLabel !== "Disable")
      parts.push(`enabledLabel="${props.enabledLabel}"`);
    if (props.disabledLabel !== "Enable")
      parts.push(`disabledLabel="${props.disabledLabel}"`);
    return `<Toggle ${parts.join(" ")} />`;
  },
} satisfies ComponentPlaygroundConfig;

