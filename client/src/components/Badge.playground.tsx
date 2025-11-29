import { ComponentPlaygroundConfig } from "./playground.types";
import { Badge } from "./Badge";

export const BadgePlayground = {
  name: "Badge" as const,
  controls: [
    {
      key: "color" as const,
      label: "Color",
      type: "select" as const,
      options: [
        { label: "Red", value: "red" as const },
        { label: "Green", value: "green" as const },
        { label: "Blue", value: "blue" as const },
        { label: "Yellow", value: "yellow" as const },
        { label: "Gray", value: "gray" as const },
        { label: "Purple", value: "purple" as const },
      ],
      defaultValue: "gray" as const,
    },
    {
      key: "size" as const,
      label: "Size",
      type: "select" as const,
      options: [
        { label: "Small", value: "sm" as const },
        { label: "Medium", value: "md" as const },
      ],
      defaultValue: "sm" as const,
    },
    {
      key: "children" as const,
      label: "Text",
      type: "text" as const,
      defaultValue: "Badge",
    },
  ],
  render: (props) => (
    <Badge
      color={props.color as "red" | "green" | "blue" | "yellow" | "gray" | "purple"}
      size={props.size as "sm" | "md"}
    >
      {props.children as string}
    </Badge>
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.color !== "gray") parts.push(`color="${props.color}"`);
    if (props.size !== "sm") parts.push(`size="${props.size}"`);
    return `<Badge${parts.length ? " " + parts.join(" ") : ""}>${
      props.children
    }</Badge>`;
  },
} satisfies ComponentPlaygroundConfig;

