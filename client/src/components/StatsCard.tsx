import { cn } from "../lib/cn";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: "blue" | "green" | "red" | "purple" | "orange";
}

export function StatsCard({
  title,
  value,
  subtitle,
  color = "blue",
}: StatsCardProps) {
  const colors = {
    blue: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-200 border-blue-300 dark:border-blue-600/50",
    green: "bg-green-50 dark:bg-green-900/50 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700",
    red: "bg-red-50 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700",
    purple: "bg-purple-50 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700",
    orange: "bg-orange-50 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700",
  };

  return (
    <div className={cn("p-6 rounded-lg border-2", colors[color])}>
      <div className="text-sm font-medium opacity-80 mb-1">{title}</div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      {subtitle && <div className="text-sm opacity-70">{subtitle}</div>}
    </div>
  );
}
