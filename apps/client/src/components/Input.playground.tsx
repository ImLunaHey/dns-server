import { ComponentPlaygroundConfig } from "./playground.types";
import { Input } from "./Input";

export const InputPlayground = {
  name: "Input" as const,
  controls: [
    {
      key: "type" as const,
      label: "Type",
      type: "select" as const,
      options: [
        { label: "Text", value: "text" as const },
        { label: "Email", value: "email" as const },
        { label: "Password", value: "password" as const },
        { label: "Number", value: "number" as const },
      ],
      defaultValue: "text" as const,
    },
    {
      key: "placeholder" as const,
      label: "Placeholder",
      type: "text" as const,
      defaultValue: "Enter text...",
    },
    {
      key: "disabled" as const,
      label: "Disabled",
      type: "toggle" as const,
      defaultValue: false,
    },
    {
      key: "error" as const,
      label: "Error Message",
      type: "text" as const,
      defaultValue: "",
    },
  ],
  render: (props) => (
    <Input
      type={props.type as string}
      placeholder={props.placeholder as string}
      disabled={props.disabled as boolean}
      error={(props.error as string) || undefined}
    />
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.type !== "text") parts.push(`type="${props.type}"`);
    if (props.placeholder) parts.push(`placeholder="${props.placeholder}"`);
    if (props.disabled) parts.push("disabled");
    if (props.error) parts.push(`error="${props.error}"`);
    return `<Input${parts.length ? " " + parts.join(" ") : ""} />`;
  },
} satisfies ComponentPlaygroundConfig;
