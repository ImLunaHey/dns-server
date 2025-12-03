import { ComponentPlaygroundConfig } from "./playground.types";
import { Select } from "./Select";

export const SelectPlayground = {
  name: "Select" as const,
  controls: [
    {
      key: "error" as const,
      label: "Error Message",
      type: "text" as const,
      defaultValue: "",
    },
    {
      key: "disabled" as const,
      label: "Disabled",
      type: "toggle" as const,
      defaultValue: false,
    },
  ],
  render: (props) => (
    <Select error={(props.error as string) || undefined} disabled={props.disabled as boolean}>
      <option value="">Select an option...</option>
      <option value="option1">Option 1</option>
      <option value="option2">Option 2</option>
      <option value="option3">Option 3</option>
    </Select>
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.error) parts.push(`error="${props.error}"`);
    if (props.disabled) parts.push("disabled");
    return `<Select${parts.length ? " " + parts.join(" ") : ""}>\n  <option value="">Select an option...</option>\n  <option value="option1">Option 1</option>\n  <option value="option2">Option 2</option>\n  <option value="option3">Option 3</option>\n</Select>`;
  },
} satisfies ComponentPlaygroundConfig;

