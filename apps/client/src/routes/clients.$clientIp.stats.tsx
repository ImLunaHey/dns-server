import { createFileRoute } from "@tanstack/react-router";
import { ClientStats } from "../pages/ClientStats";

export const Route = createFileRoute("/clients/$clientIp/stats")({
  component: ClientStats,
});

