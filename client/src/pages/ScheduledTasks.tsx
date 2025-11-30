import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Panel } from "../components/Panel";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { FormField } from "../components/FormField";
import { Select } from "../components/Select";
import { useToastContext } from "../contexts/ToastContext";
import { cn } from "../lib/cn";

export function ScheduledTasks() {
  const queryClient = useQueryClient();
  const toast = useToastContext();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTaskType, setNewTaskType] = useState("blocklist-update");
  const [newSchedule, setNewSchedule] = useState("daily");
  const [customCron, setCustomCron] = useState("0 2 * * *");
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);

  const { data: tasks = [] } = useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: () => api.getScheduledTasks(),
  });

  const createTask = useMutation({
    mutationFn: (data: { taskType: string; schedule: string }) =>
      api.createScheduledTask(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      setShowAddForm(false);
      setNewTaskType("blocklist-update");
      setNewSchedule("daily");
      setCustomCron("0 2 * * *");
      toast.success("Scheduled task created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create task");
    },
  });

  const updateTask = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { schedule?: string; enabled?: boolean };
    }) => api.updateScheduledTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      toast.success("Task updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update task");
    },
  });

  const deleteTask = useMutation({
    mutationFn: (id: number) => api.deleteScheduledTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      toast.success("Task deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete task");
    },
  });

  const runTask = useMutation({
    mutationFn: (id: number) => api.runScheduledTask(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      toast.success(data.message || "Task started successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to run task");
    },
  });

  const handleAdd = () => {
    const schedule =
      newSchedule === "custom" ? customCron : newSchedule;
    createTask.mutate({
      taskType: newTaskType,
      schedule,
    });
  };

  const formatSchedule = (schedule: string): string => {
    if (schedule === "hourly") return "Every hour";
    if (schedule === "daily") return "Daily at 2:00 AM";
    if (schedule === "weekly") return "Weekly on Sunday at 2:00 AM";
    // Cron format: "0 2 * * *" = daily at 2 AM
    const cronMatch = schedule.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
    if (cronMatch) {
      const minute = cronMatch[1].padStart(2, "0");
      const hour = cronMatch[2];
      return `Daily at ${hour}:${minute}`;
    }
    return schedule;
  };

  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return "Never";
    return new Date(timestamp).toLocaleString();
  };

  return (
    <>
      <PageHeader
        title="Scheduled Tasks"
        description="Manage automated tasks that run on a schedule"
      >
        {!showAddForm && (
          <Button onClick={() => setShowAddForm(true)}>Add Task</Button>
        )}
      </PageHeader>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Panel>
          {showAddForm && (
            <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded">
              <h3 className="text-md font-medium text-gray-900 dark:text-white mb-4">
                Add New Scheduled Task
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Task Type">
                  <Select
                    value={newTaskType}
                    onChange={(e) => setNewTaskType(e.target.value)}
                  >
                    <option value="blocklist-update">Blocklist Update</option>
                  </Select>
                </FormField>
                <FormField label="Schedule">
                  <Select
                    value={newSchedule}
                    onChange={(e) => setNewSchedule(e.target.value)}
                  >
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Custom (Cron)</option>
                  </Select>
                </FormField>
                {newSchedule === "custom" && (
                  <FormField label="Cron Expression" className="md:col-span-2">
                    <Input
                      type="text"
                      value={customCron}
                      onChange={(e) => setCustomCron(e.target.value)}
                      placeholder="0 2 * * * (daily at 2 AM)"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Format: minute hour * * * (e.g., "0 2 * * *" for daily at 2 AM)
                    </p>
                  </FormField>
                )}
                <div className="md:col-span-2 flex gap-2">
                  <Button
                    onClick={handleAdd}
                    disabled={createTask.isPending || !newTaskType || !newSchedule}
                  >
                    Create Task
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewTaskType("blocklist-update");
                      setNewSchedule("daily");
                      setCustomCron("0 2 * * *");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          {tasks.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">
              No scheduled tasks configured
            </p>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                >
                  <div className="p-4 bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Task Type
                          </div>
                          <div className="font-medium text-gray-900 dark:text-white">
                            {task.taskType}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Schedule
                          </div>
                          <div className="font-medium text-gray-900 dark:text-white truncate">
                            {formatSchedule(task.schedule)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Status
                          </div>
                          <div
                            className={cn(
                              "font-medium",
                              task.enabled
                                ? "text-green-600 dark:text-green-400"
                                : "text-gray-500 dark:text-gray-400"
                            )}
                          >
                            {task.enabled ? "Enabled" : "Disabled"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Last Run
                          </div>
                          <div className="font-medium text-gray-900 dark:text-white text-xs">
                            {formatDate(task.lastRun)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setExpandedTaskId(
                              expandedTaskId === task.id ? null : task.id
                            );
                          }}
                        >
                          {expandedTaskId === task.id ? "Hide Logs" : "View Logs"}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            runTask.mutate(task.id);
                          }}
                          disabled={runTask.isPending}
                        >
                          Run Now
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateTask.mutate({
                              id: task.id,
                              data: { enabled: !task.enabled },
                            })
                          }
                        >
                          {task.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (
                              confirm(
                                `Are you sure you want to delete the scheduled task "${task.taskType}"?`
                              )
                            ) {
                              deleteTask.mutate(task.id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                  {expandedTaskId === task.id && (
                    <TaskLogs taskId={task.id} taskType={task.taskType} />
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </main>
    </>
  );
}

function TaskLogs({ taskId, taskType }: { taskId: number; taskType: string }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["scheduled-task-logs", taskId],
    queryFn: () => api.getScheduledTaskLogs(taskId, 20),
    enabled: taskType === "blocklist-update",
  });

  if (taskType !== "blocklist-update") {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
        No logs available for this task type
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4">
        <Loading />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
        No execution logs yet
      </div>
    );
  }

  return (
    <div className="p-4 border-t border-gray-200 dark:border-gray-700">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
        Execution History
      </h4>
      <div className="space-y-2">
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex items-center justify-between p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-sm"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium",
                    log.status === "completed"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      : log.status === "failed"
                      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                  )}
                >
                  {log.status}
                </span>
                <span className="text-gray-600 dark:text-gray-400">
                  {new Date(log.startedAt).toLocaleString()}
                </span>
              </div>
              {log.status === "completed" && (
                <div className="text-gray-600 dark:text-gray-400">
                  Added {log.domainsAdded.toLocaleString()} domains
                </div>
              )}
              {log.status === "failed" && log.error && (
                <div className="text-red-600 dark:text-red-400">
                  Error: {log.error}
                </div>
              )}
              {log.status === "running" && (
                <div className="text-gray-600 dark:text-gray-400">
                  Update in progress...
                </div>
              )}
            </div>
            {log.completedAt && (
              <div className="text-xs text-gray-500 dark:text-gray-400 ml-4">
                Duration:{" "}
                {Math.round((log.completedAt - log.startedAt) / 1000)}s
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

