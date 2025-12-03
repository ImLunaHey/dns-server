import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface PanelProps {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  noShadow?: boolean;
}

export function Panel({
  children,
  className,
  padding = "lg",
  noShadow = false,
}: PanelProps) {
  const paddingClasses = {
    none: "",
    sm: "p-3",
    md: "p-4",
    lg: "p-6",
  };

  return (
    <div
        className={cn(
          "bg-white dark:bg-black rounded-lg border border-gray-200 dark:border-gray-700",
          !noShadow && "shadow-lg",
          paddingClasses[padding],
          className
        )}
    >
      {children}
    </div>
  );
}
