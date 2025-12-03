import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface CodeBlockProps {
  children: ReactNode;
  className?: string;
  copyable?: boolean;
}

export function CodeBlock({ children, className, copyable }: CodeBlockProps) {
  const handleCopy = () => {
    if (typeof children === "string") {
      navigator.clipboard.writeText(children);
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 p-3 rounded font-mono text-xs overflow-x-auto text-gray-900 dark:text-gray-100",
          className
        )}
      >
        {children}
      </div>
      {copyable && typeof children === "string" && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          title="Copy to clipboard"
        >
          Copy
        </button>
      )}
    </div>
  );
}

