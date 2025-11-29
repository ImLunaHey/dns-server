import { ComponentPlaygroundConfig } from "./playground.types";
import { FormField } from "./FormField";
import { Input } from "./Input";

export const FormFieldPlayground = {
  name: "FormField" as const,
  controls: [
    {
      key: "label" as const,
      label: "Label",
      type: "text" as const,
      defaultValue: "Field Label",
    },
    {
      key: "required" as const,
      label: "Required",
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
    <FormField
      label={props.label as string}
      required={props.required as boolean}
      error={(props.error as string) || undefined}
    >
      <Input placeholder="Enter value..." />
    </FormField>
  ),
  codeGen: (props) => {
    const parts: string[] = [`label="${props.label}"`];
    if (props.required) parts.push("required");
    if (props.error) parts.push(`error="${props.error}"`);
    return `<FormField ${parts.join(" ")}>\n  <Input placeholder="Enter value..." />\n</FormField>`;
  },
} satisfies ComponentPlaygroundConfig;

