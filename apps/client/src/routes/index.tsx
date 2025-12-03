import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Dashboard } from "../pages/Dashboard";
import { PublicDashboard } from "../pages/PublicDashboard";
import { useSession } from "../lib/auth";
import { useQuery } from "@tanstack/react-query";

async function checkHasUsers() {
  const response = await fetch("/api/setup/check");
  const data = await response.json();
  return data.hasUsers;
}

export const Route = createFileRoute("/")({
  component: () => {
    const { data: session } = useSession();
    const router = useRouter();
    const isAuthenticated = !!session?.user;

    const { data: hasUsers, isPending } = useQuery({
      queryKey: ["setup", "check"],
      queryFn: checkHasUsers,
    });

    // Redirect to setup if no users exist
    if (!isPending && !hasUsers && !isAuthenticated) {
      router.navigate({ to: "/setup" });
      return null;
    }

    return isAuthenticated ? <Dashboard /> : <PublicDashboard />;
  },
});
