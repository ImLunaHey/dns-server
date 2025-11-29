import { ComponentPlaygroundConfig } from "./playground.types";
import { RankedList } from "./RankedList";

export const RankedListPlayground = {
  name: "RankedList" as const,
  controls: [
    {
      key: "title" as const,
      label: "Title",
      type: "text" as const,
      defaultValue: "Ranked List",
    },
    {
      key: "color" as const,
      label: "Color",
      type: "select" as const,
      options: [
        { label: "Blue", value: "blue" as const },
        { label: "Red", value: "red" as const },
      ],
      defaultValue: "blue" as const,
    },
    {
      key: "itemCount" as const,
      label: "Number of Items",
      type: "number" as const,
      defaultValue: 5,
    },
  ],
  render: (props) => {
    const sampleItems = Array.from(
      { length: Number(props.itemCount) || 0 },
      (_, i) => ({
        label: `Item ${i + 1}`,
        value: (Number(props.itemCount) - i) * 100,
      })
    );

    return (
      <RankedList
        title={props.title as string}
        items={sampleItems}
        color={props.color as "blue" | "red"}
      />
    );
  },
  codeGen: (props) => {
    const parts: string[] = [];
    parts.push(`title="${props.title}"`);
    if (props.color !== "blue") parts.push(`color="${props.color}"`);
    return `<RankedList${parts.length ? " " + parts.join(" ") : ""}
  items={[
    { label: "Item 1", value: 500 },
    { label: "Item 2", value: 400 },
    // ... more items
  ]}
/>`;
  },
} satisfies ComponentPlaygroundConfig;

