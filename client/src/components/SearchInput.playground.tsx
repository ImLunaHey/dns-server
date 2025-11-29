import { ComponentPlaygroundConfig } from "./playground.types";
import { SearchInput } from "./SearchInput";

export const SearchInputPlayground = {
  name: "SearchInput" as const,
  controls: [
    {
      key: "value" as const,
      label: "Value",
      type: "text" as const,
      defaultValue: "",
    },
    {
      key: "placeholder" as const,
      label: "Placeholder",
      type: "text" as const,
      defaultValue: "Search...",
    },
  ],
  render: (props) => (
    <SearchInput
      value={props.value as string}
      onChange={() => {}}
      placeholder={props.placeholder as string}
    />
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    parts.push(`value={value}`);
    parts.push(`onChange={(value) => setValue(value)}`);
    if (props.placeholder !== "Search...")
      parts.push(`placeholder="${props.placeholder}"`);
    return `<SearchInput ${parts.join(" ")} />`;
  },
} satisfies ComponentPlaygroundConfig;

