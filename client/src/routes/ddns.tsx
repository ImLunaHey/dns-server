import { createFileRoute } from "@tanstack/react-router";
import { DDNS } from "../pages/DDNS";

export const Route = createFileRoute("/ddns")({
  component: DDNS,
});
