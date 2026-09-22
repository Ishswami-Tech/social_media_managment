"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface Props {
  organizations: { id: string; name: string; slug: string; role: string; status: string }[];
  invitations: { id: string; organizationName: string; role: string }[];
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export function OrganizationPicker({ organizations, invitations }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  async function select(organizationId: string) {
    setBusy(true);
    const { error } = await authClient.organization.setActive({ organizationId });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Could not switch organization");
    router.push("/home");
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await authClient.organization.create({ name, slug: slug || slugify(name) });
    if (error || !data) {
      setBusy(false);
      return toast.error(error?.message ?? "Could not create organization");
    }
    await authClient.organization.setActive({ organizationId: data.id });
    toast.success(`Created ${data.name}`);
    router.push("/home");
    router.refresh();
  }

  async function accept(invitationId: string) {
    setBusy(true);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Could not accept invitation");
    if (data) await select(data.member.organizationId);
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Choose an organization</CardTitle>
        <CardDescription>
          Each organization is an isolated workspace with its own accounts, content and team.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {organizations.length > 0 && (
          <div className="grid gap-2">
            {organizations.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy || o.status !== "ACTIVE"}
                onClick={() => select(o.id)}
                className="flex items-center justify-between rounded-md border p-3 text-left transition hover:bg-accent disabled:opacity-50"
              >
                <span className="flex items-center gap-3">
                  <Building2 className="size-4 text-muted-foreground" />
                  <span>
                    <span className="block font-medium">{o.name}</span>
                    <span className="block text-xs text-muted-foreground">/{o.slug}</span>
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {o.status !== "ACTIVE" && <Badge variant="destructive">{o.status}</Badge>}
                  <Badge variant="secondary">{o.role}</Badge>
                </span>
              </button>
            ))}
          </div>
        )}
        {invitations.length > 0 && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Pending invitations</p>
            {invitations.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-md border p-3">
                <span>
                  <span className="block font-medium">{i.organizationName}</span>
                  <span className="block text-xs text-muted-foreground">as {i.role}</span>
                </span>
                <Button size="sm" onClick={() => accept(i.id)} disabled={busy}>
                  Join
                </Button>
              </div>
            ))}
          </div>
        )}
        {(organizations.length > 0 || invitations.length > 0) && <Separator />}
        <form onSubmit={create} className="grid gap-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Plus className="size-4" /> Create a new organization
          </p>
          <div className="grid gap-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(slugify(e.target.value));
              }}
              required
              minLength={2}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="org-slug">Slug</Label>
            <Input
              id="org-slug"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              required
              minLength={2}
            />
          </div>
          <Button type="submit" disabled={busy || !name}>
            Create organization
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
