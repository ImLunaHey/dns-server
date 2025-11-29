import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useStats } from "../hooks/useStats";
import {
  useGroupBlocking,
  useUpdateGroupBlocking,
  useAddGroupAllowlist,
  useRemoveGroupAllowlist,
  useAddGroupBlocklist,
  useRemoveGroupBlocklist,
} from "../hooks/useGroupBlocking";
import { cn } from "../lib/cn";
import { BlockingRules } from "../components/BlockingRules";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { Panel } from "../components/Panel";

export function Groups() {
  const queryClient = useQueryClient();
  const { data: stats } = useStats();
  const { data: groups, isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.getGroups(),
  });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [editingGroup, setEditingGroup] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);

  const createGroup = useMutation({
    mutationFn: () => api.createGroup(groupName, groupDescription),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setShowCreateForm(false);
      setGroupName("");
      setGroupDescription("");
    },
  });

  const deleteGroup = useMutation({
    mutationFn: (id: number) => api.deleteGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      if (selectedGroup === editingGroup) {
        setSelectedGroup(null);
        setEditingGroup(null);
      }
    },
  });

  const addMember = useMutation({
    mutationFn: ({ groupId, clientIp }: { groupId: number; clientIp: string }) =>
      api.addGroupMember(groupId, clientIp),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      if (selectedGroup) {
        queryClient.invalidateQueries({ queryKey: ["groupMembers", selectedGroup] });
      }
    },
  });

  const removeMember = useMutation({
    mutationFn: ({ groupId, clientIp }: { groupId: number; clientIp: string }) =>
      api.removeGroupMember(groupId, clientIp),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      if (selectedGroup) {
        queryClient.invalidateQueries({ queryKey: ["groupMembers", selectedGroup] });
      }
    },
  });

  const { data: members } = useQuery({
    queryKey: ["groupMembers", selectedGroup],
    queryFn: () => (selectedGroup ? api.getGroupMembers(selectedGroup) : Promise.resolve([])),
    enabled: !!selectedGroup,
  });

  const [newMemberIp, setNewMemberIp] = useState("");
  
  // Get available clients from stats (topClientsArray)
  const allClients = stats?.topClientsArray?.map((c) => c.clientIp) || [];
  const availableClients = allClients.filter((ip) => !members?.includes(ip));

  if (isLoading) {
    return <Loading fullScreen />;
  }

  return (
    <>
      <PageHeader
        title="Groups"
        description="Manage client groups"
      >
        <Button
          onClick={() => setShowCreateForm(true)}
        >
          Create Group
        </Button>
      </PageHeader>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {showCreateForm && (
          <Panel className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Create New Group</h2>
            <div className="space-y-4">
              <FormField label="Group Name" required>
                <Input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g., Home Devices"
                />
              </FormField>
              <FormField label="Description">
                <Input
                  type="text"
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </FormField>
              <div className="flex gap-2">
                <Button
                  onClick={() => createGroup.mutate()}
                  disabled={!groupName.trim() || createGroup.isPending}
                >
                  Create
                </Button>
                <Button
                  onClick={() => {
                    setShowCreateForm(false);
                    setGroupName("");
                    setGroupDescription("");
                  }}
                  color="gray"
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Panel>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Groups</h2>
            <div className="space-y-2">
              {groups && groups.length > 0 ? (
                groups.map((group: { id: number; name: string; description: string | null; memberCount: number }) => (
                  <div
                    key={group.id}
                    className={cn(
                      "p-4 rounded-lg border cursor-pointer transition-colors",
                      selectedGroup === group.id
                        ? "bg-slate-200 dark:bg-purple-900/50 border-slate-300 dark:border-purple-700"
                        : "bg-gray-100 dark:bg-gray-700/50 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700"
                    )}
                    onClick={() => setSelectedGroup(group.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-white">{group.name}</h3>
                        {group.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{group.description}</p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{group.memberCount} members</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteGroup.mutate(group.id);
                        }}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-400 text-center py-8">No groups yet. Create one to get started.</p>
              )}
            </div>
          </div>

          {selectedGroup && (
            <>
              <div className="bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Group Members</h2>
              <div className="space-y-2 mb-4">
                {members && members.length > 0 ? (
                  members.map((clientIp: string) => (
                    <div
                      key={clientIp}
                      className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700/50 rounded border border-gray-300 dark:border-gray-600"
                    >
                      <span className="text-gray-900 dark:text-white font-mono text-sm">{clientIp}</span>
                      <button
                        onClick={() => removeMember.mutate({ groupId: selectedGroup, clientIp })}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-600 dark:text-gray-400 text-center py-4">No members in this group</p>
                )}
              </div>

              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Add Client</h3>
                <div className="space-y-3">
                  {/* Manual IP Input */}
                  <FormField label="Enter Client IP Address">
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={newMemberIp}
                        onChange={(e) => setNewMemberIp(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newMemberIp.trim()) {
                            addMember.mutate({ groupId: selectedGroup, clientIp: newMemberIp.trim() });
                            setNewMemberIp("");
                          }
                        }}
                        placeholder="e.g., 192.168.1.100"
                        className="flex-1"
                      />
                      <Button
                        onClick={() => {
                          if (newMemberIp.trim()) {
                            addMember.mutate({ groupId: selectedGroup, clientIp: newMemberIp.trim() });
                            setNewMemberIp("");
                          }
                        }}
                        disabled={!newMemberIp.trim() || addMember.isPending}
                      >
                        Add
                      </Button>
                    </div>
                  </FormField>

                  {/* Dropdown for existing clients */}
                  {availableClients.length > 0 && (
                    <FormField label="Or select from active clients">
                      <Select
                        onChange={(e) => {
                          if (e.target.value) {
                            addMember.mutate({ groupId: selectedGroup, clientIp: e.target.value });
                            e.target.value = "";
                          }
                        }}
                        defaultValue=""
                      >
                        <option value="">Select a client...</option>
                        {availableClients.map((ip) => (
                          <option key={ip} value={ip}>
                            {ip}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  )}
                  
                  {availableClients.length === 0 && allClients.length > 0 && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      All active clients are already in this group
                    </p>
                  )}
                  
                  {allClients.length === 0 && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      No active clients found. Clients will appear here once they make DNS queries.
                    </p>
                  )}
                </div>
              </div>
              </div>

              {/* Blocking Rules for Selected Group */}
              <GroupBlockingRules groupId={selectedGroup} />
            </>
          )}
        </div>
      </main>
    </>
  );
}

function GroupBlockingRules({ groupId }: { groupId: number }) {
  const { data, isLoading } = useGroupBlocking(groupId);
  const updateBlocking = useUpdateGroupBlocking();
  const addAllowlist = useAddGroupAllowlist();
  const removeAllowlist = useRemoveGroupAllowlist();
  const addBlocklist = useAddGroupBlocklist();
  const removeBlocklist = useRemoveGroupBlocklist();

  if (isLoading || !data) {
    return (
      <div className="mt-6 bg-white dark:bg-black rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="text-center text-gray-600 dark:text-gray-400">Loading blocking rules...</div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <BlockingRules
        enabled={data.enabled}
        onToggleEnabled={(enabled) => updateBlocking.mutate({ groupId, enabled })}
        allowlist={data.allowlist}
        blocklist={data.blocklist}
        onAddAllowlist={(domain) => addAllowlist.mutate({ groupId, domain })}
        onRemoveAllowlist={(domain) => removeAllowlist.mutate({ groupId, domain })}
        onAddBlocklist={(domain) => addBlocklist.mutate({ groupId, domain })}
        onRemoveBlocklist={(domain) => removeBlocklist.mutate({ groupId, domain })}
        isLoading={
          updateBlocking.isPending ||
          addAllowlist.isPending ||
          removeAllowlist.isPending ||
          addBlocklist.isPending ||
          removeBlocklist.isPending
        }
        title={`Blocking Rules for Group`}
      />
    </div>
  );
}

