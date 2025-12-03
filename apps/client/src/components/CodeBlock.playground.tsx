import { ComponentPlaygroundConfig } from "./playground.types";
import { CodeBlock } from "./CodeBlock";

export const CodeBlockPlayground = {
  name: "CodeBlock" as const,
  controls: [
    {
      key: "children" as const,
      label: "Code",
      type: "text" as const,
      defaultValue: "const example = 'Hello, World!';",
    },
    {
      key: "copyable" as const,
      label: "Show Copy Button",
      type: "toggle" as const,
      defaultValue: false,
    },
  ],
  render: (props) => (
    <CodeBlock copyable={props.copyable as boolean}>
      {props.children as string}
    </CodeBlock>
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.copyable) parts.push("copyable");
    return `<CodeBlock${parts.length ? " " + parts.join(" ") : ""}>${
      props.children
    }</CodeBlock>`;
  },
} satisfies ComponentPlaygroundConfig;

