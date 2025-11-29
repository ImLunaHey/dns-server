import { ComponentPlaygroundConfig } from "./playground.types";
import { PageHeader } from "./PageHeader";

export const PageHeaderPlayground = {
  name: "PageHeader" as const,
  controls: [
    {
      key: "title" as const,
      label: "Title",
      type: "text" as const,
      defaultValue: "Page Title",
    },
    {
      key: "description" as const,
      label: "Description",
      type: "text" as const,
      defaultValue: "Page description goes here",
    },
    {
      key: "showDescription" as const,
      label: "Show Description",
      type: "toggle" as const,
      defaultValue: true,
    },
  ],
  render: (props) => (
    <PageHeader
      title={props.title as string}
      description={
        props.showDescription ? (props.description as string) : undefined
      }
    />
  ),
  codeGen: (props) => {
    const parts: string[] = [];
    parts.push(`title="${props.title}"`);
    if (props.showDescription && props.description)
      parts.push(`description="${props.description}"`);
    return `<PageHeader ${parts.join(" ")} />`;
  },
} satisfies ComponentPlaygroundConfig;

