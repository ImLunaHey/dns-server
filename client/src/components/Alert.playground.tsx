import { ComponentPlaygroundConfig } from "./playground.types";
import { Alert } from "./Alert";

export const AlertPlayground = {
  name: "Alert" as const,
  controls: [
    {
      key: "variant" as const,
      label: "Variant",
      type: "select" as const,
      options: [
        { label: "Error", value: "error" as const },
        { label: "Success", value: "success" as const },
        { label: "Warning", value: "warning" as const },
        { label: "Info", value: "info" as const },
      ],
      defaultValue: "info" as const,
    },
    {
      key: "children" as const,
      label: "Message",
      type: "text" as const,
      defaultValue: "This is an alert message",
    },
  ],
  render: (props) => (
    <Alert variant={props.variant as "error" | "success" | "warning" | "info"}>
      {props.children as string}
    </Alert>
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.variant !== "info") parts.push(`variant="${props.variant}"`);
    return `<Alert${parts.length ? " " + parts.join(" ") : ""}>${
      props.children
    }</Alert>`;
  },
} satisfies ComponentPlaygroundConfig;

