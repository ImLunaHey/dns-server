import { useEffect, ReactNode } from "react";
import { cn } from "../lib/cn";

interface ModalProps {
  id: string;
  children: ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnBackdrop?: boolean;
  zIndex?: number;
  isTopmost?: boolean;
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-full mx-4",
};

export function Modal({
  id,
  children,
  onClose,
  size = "md",
  closeOnBackdrop = true,
  zIndex = 50,
  isTopmost = false,
}: ModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmost) {
        onClose();
      }
    };

    if (isTopmost) {
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      if (isTopmost) {
        document.removeEventListener("keydown", handleEscape);
        document.body.style.overflow = "";
      }
    };
  }, [onClose, isTopmost]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 1000 + zIndex }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div
        className={cn(
          "relative bg-black border border-gray-800 rounded-lg shadow-xl",
          "w-full",
          sizeClasses[size],
          "max-h-[90vh] overflow-y-auto",
          "transform transition-all"
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`modal-title-${id}`}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className={cn(
            "absolute top-4 right-4 z-10",
            "p-2 rounded-lg",
            "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300",
            "hover:bg-gray-100 dark:hover:bg-gray-800",
            "transition-colors"
          )}
          aria-label="Close modal"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Content */}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
