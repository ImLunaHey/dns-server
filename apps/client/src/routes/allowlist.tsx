import { createFileRoute } from "@tanstack/react-router";
import { Allowlist } from "../pages/Allowlist";

export const Route = createFileRoute("/allowlist")({
  component: Allowlist,
});

