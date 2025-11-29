import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type ButtonColor = "blue" | "red" | "green" | "yellow" | "purple" | "gray";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  color?: ButtonColor;
  size?: ButtonSize;
  variant?: "solid" | "outline" | "ghost";
}

const colorClasses: Record<ButtonColor, { solid: string; outline: string; ghost: string }> = {
  blue: {
    solid: "bg-blue-600 hover:bg-blue-700 text-white",
    outline: "border border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20",
    ghost: "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
  },
  red: {
    solid: "bg-red-600 hover:bg-red-700 text-white",
    outline: "border border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20",
    ghost: "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20",
  },
  green: {
    solid: "bg-green-600 hover:bg-green-700 text-white",
    outline: "border border-green-600 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20",
    ghost: "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20",
  },
  yellow: {
    solid: "bg-yellow-600 hover:bg-yellow-700 text-white",
    outline: "border border-yellow-600 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20",
    ghost: "text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20",
  },
  purple: {
    solid: "bg-purple-600 hover:bg-purple-700 text-white",
    outline: "border border-purple-600 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20",
    ghost: "text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20",
  },
  gray: {
    solid: "bg-gray-600 hover:bg-gray-700 text-white",
    outline: "border border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900/20",
    ghost: "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900/20",
  },
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  children,
  color = "blue",
  size = "md",
  variant = "solid",
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "font-medium rounded transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        colorClasses[color][variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

