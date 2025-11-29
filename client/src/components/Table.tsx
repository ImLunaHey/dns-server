import { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "./Button";

export interface TableAction {
  title: string;
  color: 'blue' | 'red' | 'green' | 'yellow' | 'purple' | 'gray';
  onClick: () => void;
  disabled?: boolean;
}

export interface TableColumn<T> {
  header: string;
  accessor: keyof T | ((row: T, index: number) => ReactNode);
  render?: (value: unknown, row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  actions?: (row: T) => TableAction[];
  emptyMessage?: string;
  getRowKey: (row: T) => string | number;
  className?: string;
}

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full", className)}>{children}</table>
    </div>
  );
}

interface TableHeaderProps {
  children: ReactNode;
  className?: string;
}

export function TableHeader({ children, className }: TableHeaderProps) {
  return (
    <thead className={cn("bg-gray-50 dark:bg-black border-b border-gray-200 dark:border-gray-700", className)}>
      {children}
    </thead>
  );
}

interface TableBodyProps {
  children: ReactNode;
  className?: string;
}

export function TableBody({ children, className }: TableBodyProps) {
  return (
    <tbody className={cn("bg-white dark:bg-black divide-y divide-gray-200 dark:divide-gray-700", className)}>
      {children}
    </tbody>
  );
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function TableRow({ children, className, onClick }: TableRowProps) {
  return (
    <tr
      className={cn(
        "hover:bg-gray-100 dark:hover:bg-gray-900/50 transition-colors",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}

export function TableCell({ children, className, colSpan }: TableCellProps) {
  return (
    <td className={cn("px-3 md:px-6 py-4 text-sm text-gray-700 dark:text-gray-300", className)} colSpan={colSpan}>
      {children}
    </td>
  );
}

interface TableHeaderCellProps {
  children: ReactNode;
  className?: string;
}

export function TableHeaderCell({
  children,
  className,
}: TableHeaderCellProps) {
  return (
    <th
      className={cn(
        "px-3 md:px-6 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider",
        className
      )}
    >
      {children}
    </th>
  );
}

interface TableActionsCellProps {
  actions: TableAction[];
  className?: string;
}

export function TableActionsCell({ actions, className }: TableActionsCellProps) {
  if (actions.length === 0) {
    return <TableCell className={cn("whitespace-nowrap", className)}>-</TableCell>;
  }

  return (
    <TableCell className={cn("whitespace-nowrap", className)}>
      <div className="flex gap-2 flex-wrap">
        {actions.map((action, index) => (
          <Button
            key={index}
            onClick={action.onClick}
            disabled={action.disabled}
            color={action.color}
            size="sm"
            variant="solid"
          >
            {action.title}
          </Button>
        ))}
      </div>
    </TableCell>
  );
}

export function DataTable<T>({
  columns,
  data,
  actions,
  emptyMessage = "No data available",
  getRowKey,
  className,
}: DataTableProps<T>) {
  const getCellValue = (column: TableColumn<T>, row: T, rowIndex: number): ReactNode => {
    if (typeof column.accessor === 'function') {
      return column.accessor(row, rowIndex);
    }
    
    const value = row[column.accessor];
    
    if (column.render) {
      return column.render(value, row);
    }
    
    return value as ReactNode;
  };

  const hasActions = actions !== undefined;
  const totalColumns = columns.length + (hasActions ? 1 : 0);

  return (
    <Table className={className}>
      <TableHeader>
        <tr>
          {columns.map((column, index) => (
            <TableHeaderCell
              key={index}
              className={cn(column.hideOnMobile && "hidden sm:table-cell", column.className)}
            >
              {column.header}
            </TableHeaderCell>
          ))}
          {hasActions && <TableHeaderCell>Actions</TableHeaderCell>}
        </tr>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={totalColumns} className="py-8 text-center text-gray-600 dark:text-gray-400">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          data.map((row, rowIndex) => {
            const rowActions = actions ? actions(row) : [];
            return (
              <TableRow key={getRowKey(row)}>
                {columns.map((column, index) => (
                  <TableCell
                    key={index}
                    className={cn(column.hideOnMobile && "hidden sm:table-cell", column.className)}
                  >
                    {getCellValue(column, row, rowIndex)}
                  </TableCell>
                ))}
                {hasActions && <TableActionsCell actions={rowActions} />}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

