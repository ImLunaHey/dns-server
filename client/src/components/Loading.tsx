import { cn } from "../lib/cn";

interface LoadingProps {
  fullScreen?: boolean;
  size?: "sm" | "md" | "lg";
  text?: string;
  className?: string;
  variant?: "dots" | "spinner" | "pulse";
}

export function Loading({
  fullScreen = false,
  size = "md",
  text,
  className,
  variant = "dots",
}: LoadingProps) {
  const sizeClasses = {
    sm: {
      dot: "w-1.5 h-1.5",
      gap: "gap-1",
      spinner: "w-4 h-4 border-2",
      pulse: "w-4 h-4",
    },
    md: {
      dot: "w-2 h-2",
      gap: "gap-1.5",
      spinner: "w-8 h-8 border-2",
      pulse: "w-8 h-8",
    },
    lg: {
      dot: "w-3 h-3",
      gap: "gap-2",
      spinner: "w-12 h-12 border-[3px]",
      pulse: "w-12 h-12",
    },
  };

  const dots = (
    <div className={cn("flex items-center", sizeClasses[size].gap)}>
      <div
        className={cn(
          "bg-blue-600 rounded-full animate-bounce",
          sizeClasses[size].dot,
          "[animation-delay:-0.3s]"
        )}
      />
      <div
        className={cn(
          "bg-blue-600 rounded-full animate-bounce",
          sizeClasses[size].dot,
          "[animation-delay:-0.15s]"
        )}
      />
      <div
        className={cn(
          "bg-blue-600 rounded-full animate-bounce",
          sizeClasses[size].dot
        )}
      />
    </div>
  );

  const spinner = (
    <div
      className={cn(
        "border-blue-600 border-t-transparent rounded-full animate-spin",
        sizeClasses[size].spinner,
        className
      )}
    />
  );

  const pulse = (
    <div
      className={cn(
        "bg-blue-600 rounded-full animate-pulse",
        sizeClasses[size].pulse,
        className
      )}
    />
  );

  const indicator =
    variant === "dots" ? dots : variant === "spinner" ? spinner : pulse;

  const content = (
    <div className="flex flex-col items-center gap-3">
      {indicator}
      {text && (
        <p className="text-sm text-gray-600 dark:text-gray-400">{text}</p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-black">
        {content}
      </div>
    );
  }

  return content;
}
