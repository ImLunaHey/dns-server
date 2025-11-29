import { Button } from "./Button";
import { cn } from "../lib/cn";

interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleGroupProps<T extends string> {
  value: T;
  options: ToggleOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  className,
}: ToggleGroupProps<T>) {
  return (
    <div
      className={cn(
        "flex gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg p-1",
        className
      )}
    >
      {options.map((option) => (
        <Button
          key={option.value}
          onClick={() => onChange(option.value)}
          color={value === option.value ? "blue" : "gray"}
          variant={value === option.value ? "solid" : "ghost"}
          size="sm"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

