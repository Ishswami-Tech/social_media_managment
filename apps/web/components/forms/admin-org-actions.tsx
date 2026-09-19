"use client";

import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function OrganizationAdminActions({
  id,
  status,
  planSlug,
  plans,
}: {
  id: string;
  status: string;
  planSlug: string | null;
  plans: { slug: string; name: string }[];
}) {
  const router = useRouter();
  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/organizations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return toast.error("Update failed");
    toast.success("Organization updated");
    router.refresh();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        {["ACTIVE", "SUSPENDED", "ARCHIVED"]
          .filter((s) => s !== status)
          .map((s) => (
            <DropdownMenuItem key={s} onClick={() => patch({ status: s })}>
              Set {s.toLowerCase()}
            </DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Plan</DropdownMenuLabel>
        {plans.map((p) => (
          <DropdownMenuItem key={p.slug} disabled={p.slug === planSlug} onClick={() => patch({ planSlug: p.slug })}>
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
