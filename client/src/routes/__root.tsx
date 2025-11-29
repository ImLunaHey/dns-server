import { createRootRoute, Outlet, useRouter } from "@tanstack/react-router";
import type {
  ErrorComponentProps,
  NotFoundRouteProps,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { QueryClient } from "@tanstack/react-query";
import { NavigationSidebar } from "../components/NavigationSidebar";
import { useSession } from "../lib/auth";
import { Loading } from "../components/Loading";
import { ErrorPage } from "../components/ErrorPage";
import { ToastProvider } from "../contexts/ToastContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  return <ErrorPage error={error} reset={reset} />;
}

function NotFoundComponent({ isNotFound, routeId }: NotFoundRouteProps) {
  return (
    <ErrorPage
      error={{
        status: 404,
        message:
          isNotFound && routeId
            ? `Route "${routeId}" not found`
            : "Page not found",
      }}
    />
  );
}

function RootComponent() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const isAuthenticated = !!session?.user;
  const isLoginPage = router.state.location.pathname === "/login";
  const isSetupPage = router.state.location.pathname === "/setup";

  // Show loading while checking auth
  if (isPending) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Loading fullScreen />
        </ToastProvider>
      </QueryClientProvider>
    );
  }

  // Don't show sidebar on login or setup pages
  if (isLoginPage || isSetupPage) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Outlet />
          <ReactQueryDevtools initialIsOpen={false} />
        </ToastProvider>
      </QueryClientProvider>
    );
  }

  // Show sidebar only if authenticated
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <div className="min-h-screen bg-gray-50 dark:bg-black flex flex-col md:flex-row">
          {isAuthenticated && <NavigationSidebar />}
          <div
            className={`flex-1 w-full ${
              isAuthenticated ? "md:ml-64" : ""
            } min-w-0`}
          >
            <Outlet />
          </div>
        </div>
        <ReactQueryDevtools initialIsOpen={false} />
      </ToastProvider>
    </QueryClientProvider>
  );
}

export const Route = createRootRoute({
  errorComponent: ErrorComponent,
  notFoundComponent: NotFoundComponent,
  component: RootComponent,
});
