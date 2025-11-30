import { createFileRoute } from "@tanstack/react-router";
import { QueryPatterns } from "../pages/QueryPatterns";

export const Route = createFileRoute("/query-patterns")({
  component: QueryPatterns,
});
