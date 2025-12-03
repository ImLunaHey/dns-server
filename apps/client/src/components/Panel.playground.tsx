import { ComponentPlaygroundConfig } from "./playground.types";
import { Panel } from "./Panel";

export const PanelPlayground = {
  name: "Panel" as const,
  controls: [
    {
      key: "padding" as const,
      label: "Padding",
      type: "select" as const,
      options: [
        { label: "None", value: "none" as const },
        { label: "Small", value: "sm" as const },
        { label: "Medium", value: "md" as const },
        { label: "Large", value: "lg" as const },
      ],
      defaultValue: "lg" as const,
    },
    {
      key: "noShadow" as const,
      label: "No Shadow",
      type: "toggle" as const,
      defaultValue: false,
    },
    {
      key: "children" as const,
      label: "Content",
      type: "text" as const,
      defaultValue: "Panel content goes here",
    },
  ],
  render: (props) => (
    <Panel
      padding={props.padding as "none" | "sm" | "md" | "lg"}
      noShadow={props.noShadow as boolean}
    >
      {props.children as string}
    </Panel>
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    if (props.padding !== "lg") parts.push(`padding="${props.padding}"`);
    if (props.noShadow) parts.push("noShadow");
    return `<Panel${parts.length ? " " + parts.join(" ") : ""}>${
      props.children
    }</Panel>`;
  },
} satisfies ComponentPlaygroundConfig;

