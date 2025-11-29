import { Link } from "@tanstack/react-router";
import { PageHeader } from "./PageHeader";
import { Button } from "./Button";
import { Panel } from "./Panel";

interface ErrorPageProps {
  error?: unknown;
  reset?: () => void;
}

export function ErrorPage({ error, reset }: ErrorPageProps = {}) {
  const err = (error || {}) as Error & { status?: number; statusText?: string };
  const is404 = err?.status === 404 || err?.message?.includes("404");

  return (
    <>
      <PageHeader
        title={is404 ? "Page Not Found" : "Something Went Wrong"}
        description={
          is404
            ? "The page you're looking for doesn't exist."
            : "An unexpected error occurred. Please try again."
        }
      />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Panel>
          <div className="text-center py-12">
            <div className="mb-6">
              <div className="text-6xl font-bold text-gray-300 dark:text-gray-700 mb-4">
                {err?.status || "500"}
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
                {is404 ? "Page Not Found" : "Internal Server Error"}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-8">
                {is404
                  ? "The page you're looking for might have been moved or doesn't exist."
                  : err?.message ||
                    "Something unexpected happened. Please try again later."}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/">
                <Button>Go to Dashboard</Button>
              </Link>
              {reset && (
                <Button color="gray" variant="outline" onClick={reset}>
                  Try Again
                </Button>
              )}
            </div>

            {!is404 && err?.message && (
              <details className="mt-8 text-left">
                <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                  Error Details
                </summary>
                <pre className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded text-xs text-gray-800 dark:text-gray-200 overflow-auto">
                  {err.message}
                  {err.stack && `\n\n${err.stack}`}
                </pre>
              </details>
            )}
          </div>
        </Panel>
      </main>
    </>
  );
}
