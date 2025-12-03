import { cn } from "../lib/cn";

interface BadgeProps {
  children: React.ReactNode;
  color?: "red" | "green" | "blue" | "yellow" | "gray" | "purple" | "orange";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({
  children,
  color = "gray",
  size = "sm",
  className,
}: BadgeProps) {
  const colorClasses = {
    red: "bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700",
    green: "bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-700",
    blue: "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700",
    yellow: "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700",
    gray: "bg-gray-100 dark:bg-gray-900/50 text-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700",
    purple: "bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-700",
    orange: "bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-300 border border-orange-300 dark:border-orange-700",
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-1.5 text-sm",
  };

  return (
    <span
      className={cn(
        "inline-flex leading-5 font-semibold rounded-full",
        colorClasses[color],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </span>
  );
}

