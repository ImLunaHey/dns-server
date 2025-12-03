import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <header className="bg-white dark:bg-black shadow-lg border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto pl-16 md:pl-4 pr-4 sm:px-6 lg:px-8 py-4 md:py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{title}</h1>
            {description && (
              <p className="text-gray-600 dark:text-gray-400 mt-1">{description}</p>
            )}
          </div>
          {children}
        </div>
      </div>
    </header>
  );
}

