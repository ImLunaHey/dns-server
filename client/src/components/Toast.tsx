import { useEffect } from "react";
import { cn } from "../lib/cn";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration?: number;
}

interface ToastProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

export function ToastItem({ toast, onRemove }: ToastProps) {
  useEffect(() => {
    const duration = toast.duration ?? 3000;
    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  const typeStyles = {
    success: "bg-green-600 border-green-500 text-white",
    error: "bg-red-600 border-red-500 text-white",
    warning: "bg-yellow-600 border-yellow-500 text-white",
    info: "bg-blue-600 border-blue-500 text-white",
  };

  const icons = {
    success: "✓",
    error: "✗",
    warning: "⚠",
    info: "ℹ",
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg",
        "min-w-[300px] max-w-md",
        "transform transition-all duration-300 ease-out",
        typeStyles[toast.type]
      )}
      role="alert"
      style={{
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <span className="text-lg font-semibold">{icons[toast.type]}</span>
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="text-white/80 hover:text-white transition-colors"
        aria-label="Close"
      >
        <span className="text-lg">×</span>
      </button>
    </div>
  );
}

