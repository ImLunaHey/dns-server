import { createFileRoute } from "@tanstack/react-router";
import { RegexFilters } from "../pages/RegexFilters";

export const Route = createFileRoute("/regex-filters")({
  component: RegexFilters,
});

