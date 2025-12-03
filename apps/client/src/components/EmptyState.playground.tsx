import { ComponentPlaygroundConfig } from "./playground.types";
import { EmptyState } from "./EmptyState";

export const EmptyStatePlayground = {
  name: "EmptyState" as const,
  controls: [
    {
      key: "title" as const,
      label: "Title",
      type: "text" as const,
      defaultValue: "No data available",
    },
    {
      key: "description" as const,
      label: "Description",
      type: "text" as const,
      defaultValue: "There are no items to display at this time.",
    },
  ],
  render: (props) => (
    <EmptyState
      title={props.title as string}
      description={props.description as string}
    />
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.title !== "No data available") parts.push(`title="${props.title}"`);
    if (props.description) parts.push(`description="${props.description}"`);
    return `<EmptyState${parts.length ? " " + parts.join(" ") : ""} />`;
  },
} satisfies ComponentPlaygroundConfig;

