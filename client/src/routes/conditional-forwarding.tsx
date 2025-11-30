import { createFileRoute } from "@tanstack/react-router";
import { ConditionalForwarding } from "../pages/ConditionalForwarding";

export const Route = createFileRoute("/conditional-forwarding")({
  component: ConditionalForwarding,
});
