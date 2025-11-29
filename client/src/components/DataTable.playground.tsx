import { ComponentPlaygroundConfig } from "./playground.types";
import { DataTable } from "./Table";
import { cn } from "../lib/cn";

export const DataTablePlayground = {
  name: "DataTable" as const,
  controls: [
    {
      key: "showActions" as const,
      label: "Show Actions Column",
      type: "toggle" as const,
      defaultValue: true,
    },
    {
      key: "rowCount" as const,
      label: "Number of Rows",
      type: "number" as const,
      defaultValue: 5,
    },
    {
      key: "emptyMessage" as const,
      label: "Empty Message",
      type: "text" as const,
      defaultValue: "No data available",
    },
  ],
  render: (props) => {
    const sampleData = Array.from(
      { length: Number(props.rowCount) || 0 },
      (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        status: i % 2 === 0 ? "Active" : "Inactive",
        value: (i + 1) * 100,
      })
    );

    return (
      <DataTable
        columns={[
          {
            header: "ID",
            accessor: "id",
          },
          {
            header: "Name",
            accessor: "name",
          },
          {
            header: "Status",
            accessor: (row: { status: string; id: number; name: string; value: number }, _index: number) => (
              <span
                className={cn(
                  "px-2 py-1 text-xs rounded-full",
                  row.status === "Active"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300"
                )}
              >
                {row.status}
              </span>
            ),
          },
          {
            header: "Value",
            accessor: (row: { value: number; id: number; name: string; status: string }, _index: number) => `$${row.value.toLocaleString()}`,
          },
        ]}
        data={sampleData}
        actions={
          props.showActions
            ? (row: { name: string }) => [
                {
                  title: "Edit",
                  color: "blue" as const,
                  onClick: () => alert(`Edit ${row.name}`),
                },
                {
                  title: "Delete",
                  color: "red" as const,
                  onClick: () => alert(`Delete ${row.name}`),
                },
              ]
            : undefined
        }
        emptyMessage={props.emptyMessage as string}
        getRowKey={(row: { id: number }) => row.id}
      />
    );
  },
  codeGen: (props) => {
    return `<DataTable
  columns={[
    { header: "ID", accessor: "id" },
    { header: "Name", accessor: "name" },
    { header: "Status", accessor: (row) => row.status },
    { header: "Value", accessor: (row) => row.value },
  ]}
  data={data}
  ${
    props.showActions
      ? `actions={(row) => [
    { title: "Edit", color: "blue", onClick: () => {} },
    { title: "Delete", color: "red", onClick: () => {} },
  ]}`
      : ""
  }
  emptyMessage="${props.emptyMessage}"
  getRowKey={(row) => row.id}
/>`;
  },
} satisfies ComponentPlaygroundConfig;

