import { createFileRoute } from "@tanstack/react-router";
import { ScheduledTasks } from "../pages/ScheduledTasks";

export const Route = createFileRoute("/scheduled-tasks")({
  component: ScheduledTasks,
});

