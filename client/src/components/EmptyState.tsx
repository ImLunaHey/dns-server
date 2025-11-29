import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface EmptyStateProps {
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({
  title = "No data available",
  description,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "text-center py-12 text-gray-600 dark:text-gray-400",
        className
      )}
    >
      {title && (
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {title}
        </h3>
      )}
      {description && <p className="mb-4">{description}</p>}
      {children}
    </div>
  );
}

