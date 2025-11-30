import { createFileRoute } from "@tanstack/react-router";
import { TSIGKeys } from "../pages/TSIGKeys";

export const Route = createFileRoute("/tsig-keys")({
  component: TSIGKeys,
});
