import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface AlertProps {
  children: ReactNode;
  variant?: "error" | "success" | "warning" | "info";
  className?: string;
}

export function Alert({ children, variant = "info", className }: AlertProps) {
  const variantClasses = {
    error: "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300",
    success: "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300",
    warning: "bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300",
    info: "bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300",
  };

  return (
    <div
      className={cn(
        "p-3 border rounded text-sm",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </div>
  );
}

