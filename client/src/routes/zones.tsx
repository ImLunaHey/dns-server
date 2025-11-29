import { createFileRoute } from "@tanstack/react-router";
import { Zones } from "../pages/Zones";

export const Route = createFileRoute("/zones")({
  component: Zones,
});

