import { cn } from "../lib/cn";
import { Panel } from "./Panel";

interface RankedListItem {
  label: string;
  value: number;
}

interface RankedListProps {
  title: string;
  items: RankedListItem[];
  color?: "blue" | "red";
}

export function RankedList({
  title,
  items,
  color = "blue",
}: RankedListProps) {
  const maxValue = items[0]?.value || 1;

  const barColor = color === "blue" ? "bg-blue-500" : "bg-red-500";
  const textColor = color === "blue" ? "text-blue-300" : "text-red-300";

  return (
    <Panel>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">{title}</h2>
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="text-gray-600 dark:text-gray-400 text-center py-8">No data yet</div>
        ) : (
          items.map(({ label, value }) => (
            <div key={label}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate max-w-xs">
                  {label}
                </span>
                <span className={cn("text-sm font-semibold", textColor)}>
                  {value}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className={cn(
                    barColor,
                    "h-2 rounded-full transition-all duration-300"
                  )}
                  style={{ width: `${(value / maxValue) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

