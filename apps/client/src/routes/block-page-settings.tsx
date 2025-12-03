import { createFileRoute } from "@tanstack/react-router";
import { BlockPageSettings } from "../pages/BlockPageSettings";

export const Route = createFileRoute("/block-page-settings")({
  component: BlockPageSettings,
});

