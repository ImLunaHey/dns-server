import { ComponentPlaygroundConfig } from "./playground.types";
import { ToggleGroup } from "./ToggleGroup";

export const ToggleGroupPlayground = {
  name: "ToggleGroup" as const,
  controls: [
    {
      key: "value" as const,
      label: "Selected Value",
      type: "select" as const,
      options: [
        { label: "Option 1", value: "option1" as const },
        { label: "Option 2", value: "option2" as const },
        { label: "Option 3", value: "option3" as const },
      ],
      defaultValue: "option1" as const,
    },
  ],
  render: (props, helpers) => {
    return (
      <ToggleGroup
        value={props.value as string}
        options={[
          { value: "option1", label: "Option 1" },
          { value: "option2", label: "Option 2" },
          { value: "option3", label: "Option 3" },
        ]}
        onChange={(value) => {
          helpers?.setProps("value", value);
        }}
      />
    );
  },
  codeGen: (props) => {
    return `const [value, setValue] = useState("${props.value}");\n\n<ToggleGroup\n  value={value}\n  options={[\n    { value: "option1", label: "Option 1" },\n    { value: "option2", label: "Option 2" },\n    { value: "option3", label: "Option 3" },\n  ]}\n  onChange={setValue}\n/>`;
  },
} satisfies ComponentPlaygroundConfig;

