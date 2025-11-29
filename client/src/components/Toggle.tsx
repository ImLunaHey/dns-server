import { cn } from "../lib/cn";

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  enabledLabel?: string;
  disabledLabel?: string;
  className?: string;
}

export function Toggle({
  enabled,
  onChange,
  disabled = false,
  label,
  description,
  enabledLabel = "Enabled",
  disabledLabel = "Disabled",
  className,
}: ToggleProps) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      {(label || description) && (
        <div>
          {label && (
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              {label}
            </h3>
          )}
          {description && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
      )}
      <button
        onClick={() => onChange(!enabled)}
        disabled={disabled}
        className={cn(
          "px-4 py-2 rounded font-medium transition-colors",
          enabled
            ? "bg-red-600 hover:bg-red-700 text-white"
            : "bg-green-600 hover:bg-green-700 text-white",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        {enabled ? enabledLabel : disabledLabel}
      </button>
    </div>
  );
}

