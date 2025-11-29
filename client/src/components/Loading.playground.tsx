import { ComponentPlaygroundConfig } from "./playground.types";
import { Loading } from "./Loading";

export const LoadingPlayground = {
  name: "Loading" as const,
  controls: [
    {
      key: "variant" as const,
      label: "Variant",
      type: "select" as const,
      options: [
        { label: "Dots", value: "dots" as const },
        { label: "Spinner", value: "spinner" as const },
        { label: "Pulse", value: "pulse" as const },
      ],
      defaultValue: "dots" as const,
    },
    {
      key: "size" as const,
      label: "Size",
      type: "select" as const,
      options: [
        { label: "Small", value: "sm" as const },
        { label: "Medium", value: "md" as const },
        { label: "Large", value: "lg" as const },
      ],
      defaultValue: "md" as const,
    },
    {
      key: "fullScreen" as const,
      label: "Full Screen",
      type: "toggle" as const,
      defaultValue: false,
    },
    {
      key: "text" as const,
      label: "Text (optional)",
      type: "text" as const,
      defaultValue: "Loading...",
    },
  ],
  render: (props) => (
    <Loading
      variant={props.variant as "dots" | "spinner" | "pulse"}
      size={props.size as "sm" | "md" | "lg"}
      fullScreen={props.fullScreen as boolean}
      text={props.text as string | undefined}
    />
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.variant !== "dots") parts.push(`variant="${props.variant}"`);
    if (props.size !== "md") parts.push(`size="${props.size}"`);
    if (props.fullScreen) parts.push("fullScreen");
    if (props.text) parts.push(`text="${props.text}"`);
    return `<Loading${parts.length ? " " + parts.join(" ") : ""} />`;
  },
} satisfies ComponentPlaygroundConfig;
