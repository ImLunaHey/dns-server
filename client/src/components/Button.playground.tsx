import { ComponentPlaygroundConfig } from "./playground.types";
import { Button } from "./Button";

export const ButtonPlayground = {
  name: "Button" as const,
  controls: [
    {
      key: "color" as const,
      label: "Color",
      type: "select" as const,
      options: [
        { label: "Blue", value: "blue" as const },
        { label: "Red", value: "red" as const },
        { label: "Green", value: "green" as const },
        { label: "Yellow", value: "yellow" as const },
        { label: "Purple", value: "purple" as const },
        { label: "Gray", value: "gray" as const },
      ],
      defaultValue: "blue" as const,
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
      key: "variant" as const,
      label: "Variant",
      type: "select" as const,
      options: [
        { label: "Solid", value: "solid" as const },
        { label: "Outline", value: "outline" as const },
        { label: "Ghost", value: "ghost" as const },
      ],
      defaultValue: "solid" as const,
    },
    {
      key: "disabled" as const,
      label: "Disabled",
      type: "toggle" as const,
      defaultValue: false,
    },
    {
      key: "children" as const,
      label: "Button Text",
      type: "text" as const,
      defaultValue: "Click me",
    },
  ],
  render: (props) => (
    <Button
      color={
        props.color as "blue" | "red" | "green" | "yellow" | "purple" | "gray"
      }
      size={props.size as "sm" | "md" | "lg"}
      variant={props.variant as "solid" | "outline" | "ghost"}
      disabled={props.disabled as boolean}
    >
      {props.children as string}
    </Button>
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.color !== "blue") parts.push(`color="${props.color}"`);
    if (props.size !== "md") parts.push(`size="${props.size}"`);
    if (props.variant !== "solid") parts.push(`variant="${props.variant}"`);
    if (props.disabled) parts.push("disabled");
    return `<Button${parts.length ? " " + parts.join(" ") : ""}>${
      props.children
    }</Button>`;
  },
} satisfies ComponentPlaygroundConfig;

