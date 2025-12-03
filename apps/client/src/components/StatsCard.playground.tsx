import { ComponentPlaygroundConfig } from "./playground.types";
import { StatsCard } from "./StatsCard";

export const StatsCardPlayground = {
  name: "StatsCard" as const,
  controls: [
    {
      key: "color" as const,
      label: "Color",
      type: "select" as const,
      options: [
        { label: "Blue", value: "blue" as const },
        { label: "Green", value: "green" as const },
        { label: "Red", value: "red" as const },
        { label: "Purple", value: "purple" as const },
      ],
      defaultValue: "blue" as const,
    },
    {
      key: "title" as const,
      label: "Title",
      type: "text" as const,
      defaultValue: "Total Queries",
    },
    {
      key: "value" as const,
      label: "Value",
      type: "text" as const,
      defaultValue: "1,234",
    },
    {
      key: "subtitle" as const,
      label: "Subtitle",
      type: "text" as const,
      defaultValue: "Last 24 hours",
    },
    {
      key: "showSubtitle" as const,
      label: "Show Subtitle",
      type: "toggle" as const,
      defaultValue: true,
    },
  ],
  render: (props) => (
    <StatsCard
      color={props.color as "blue" | "green" | "red" | "purple"}
      title={props.title as string}
      value={props.value as string}
      subtitle={props.showSubtitle ? (props.subtitle as string) : undefined}
    />
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.color !== "blue") parts.push(`color="${props.color}"`);
    parts.push(`title="${props.title}"`);
    parts.push(`value="${props.value}"`);
    if (props.showSubtitle && props.subtitle)
      parts.push(`subtitle="${props.subtitle}"`);
    return `<StatsCard ${parts.join(" ")} />`;
  },
} satisfies ComponentPlaygroundConfig;

