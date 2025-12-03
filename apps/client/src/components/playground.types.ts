import { ReactNode } from "react";

export type ControlType = "select" | "toggle" | "text" | "number";

export interface ComponentControl {
  key: string;
  label: string;
  type: ControlType;
  options?: Array<{ label: string; value: string }>;
  defaultValue: unknown;
}

export interface ComponentPlaygroundConfig {
  name: string;
  controls: ComponentControl[];
  render: (props: Record<string, unknown>, helpers?: { setProps: (key: string, value: unknown) => void }) => ReactNode;
  codeGen: (props: Record<string, unknown>) => string;
}

