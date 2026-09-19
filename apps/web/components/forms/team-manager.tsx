"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  currentUserId: string;
  canManage: boolean;
  assignableRoles: readonly string[];
  members: { id: string; userId: string; name: string; email: string; role: string; status: string }[];
  invitations: { id: string; email: string; role: string; expiresAt: string | null }[];
}

const ROLE_HELP: Record<string, string> = {
  OWNER: "Full control, billing, ownership transfer",
  ADMIN: "Members, accounts, settings, publishing",
  MANAGER: "Approve, schedule, manage assigned content",
  EDITOR: "Create drafts, use AI, submit for approval",
  APPROVER: "Review and approve/reject content",
  MEMBER: "Limited creation according to org settings",
  VIEWER: "Read-only dashboards and analytics",
};

export function TeamManager({ currentUserId, canManage, assignableRoles, members, invitations }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(assignableRoles.includes("EDITOR") ? "EDITOR" : (assignableRoles[0] ?? "VIEWER"));
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await authClient.organization.inviteMember({ email, role: role as never });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Invitation failed");
    toast.success(`Invited ${email}`);
    setEmail("");
    router.refresh();
  }

  async function changeRole(memberId: string, newRole: string) {
    const { error } = await authClient.organization.updateMemberRole({ memberId, role: newRole as never });
    if (error) return toast.error(error.message ?? "Role change failed");
    toast.success("Role updated");
    router.refresh();
  }

  async function remove(memberIdOrEmail: string) {
    if (!confirm("Remove this member from the organization?")) return;
    const { error } = await authClient.organization.removeMember({ memberIdOrEmail });
    if (error) return toast.error(error.message ?? "Removal failed");
    router.refresh();
  }

  async function cancelInvite(invitationId: string) {
    const { error } = await authClient.organization.cancelInvitation({ invitationId });
    if (error) return toast.error(error.message ?? "Failed");
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <span className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{initials(m.name)}</AvatarFallback>
                        </Avatar>
                        <span>
                          <span className="block font-medium">
                            {m.name}{" "}
                            {m.userId === currentUserId && <span className="text-xs text-muted-foreground">(you)</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground">{m.email}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      {canManage && m.userId !== currentUserId && m.role !== "OWNER" ? (
                        <Select value={m.role} onValueChange={(v) => changeRole(m.id, v)}>
                          <SelectTrigger size="sm" className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {assignableRoles.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{m.role}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.status === "ACTIVE" ? "success" : "destructive"}>
                        {m.status.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && m.userId !== currentUserId && m.role !== "OWNER" && (
                        <Button size="sm" variant="ghost" onClick={() => remove(m.id)}>
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {invitations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {invitations.map((i) => (
                <div key={i.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span>
                    {i.email} <Badge variant="outline">{i.role}</Badge>
                  </span>
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => cancelInvite(i.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      {canManage && (
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Invite</CardTitle>
            <CardDescription>The invitee joins with the selected role.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={invite} className="grid gap-3">
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
              <Button type="submit" disabled={busy || !email}>
                Send invitation
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
