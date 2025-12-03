import { useState } from "react";
import { Panel } from "./Panel";
import { DataTable } from "./Table";
import { Input } from "./Input";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

interface DomainItem {
  id: number;
  domain: string;
  addedAt: number;
  comment?: string;
}

interface DomainListEditorProps {
  title: string;
  description?: string;
  domains: DomainItem[];
  onAdd: (domain: string) => void;
  onRemove: (domain: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  showDateColumn?: boolean;
}

export function DomainListEditor({
  title,
  description,
  domains,
  onAdd,
  onRemove,
  isLoading = false,
  placeholder = "example.com",
  emptyMessage = "No domains",
  showDateColumn = true,
}: DomainListEditorProps) {
  const [newDomain, setNewDomain] = useState("");

  const handleAdd = () => {
    if (newDomain.trim()) {
      onAdd(newDomain.trim());
      setNewDomain("");
    }
  };

  const columns = [
    {
      header: "Domain",
      accessor: (row: DomainItem) => (
        <span className="font-mono text-sm text-gray-900 dark:text-gray-200">
          {row.domain}
        </span>
      ),
    },
    ...(showDateColumn
      ? [
          {
            header: "Added",
            accessor: (row: DomainItem) =>
              new Date(row.addedAt).toLocaleDateString(),
            className: "text-gray-600 dark:text-gray-400",
          },
        ]
      : []),
  ];

  return (
    <Panel>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {description}
        </p>
      )}
      <div className="flex gap-2 mb-4">
        <Input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={placeholder}
        />
        <Button
          onClick={handleAdd}
          disabled={isLoading || !newDomain.trim()}
          color="green"
        >
          Add
        </Button>
      </div>
      {domains.length === 0 ? (
        <EmptyState title={emptyMessage} />
      ) : (
        <DataTable
          columns={columns}
          data={domains}
          actions={(row) => [
            {
              title: "Remove",
              color: "red" as const,
              onClick: () => onRemove(row.domain),
              disabled: isLoading,
            },
          ]}
          emptyMessage={emptyMessage}
          getRowKey={(row) => row.id}
        />
      )}
    </Panel>
  );
}

