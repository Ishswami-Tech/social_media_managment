"use client";

import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserAdminActions({ id, role, banned }: { id: string; role: string; banned: boolean }) {
  const router = useRouter();
  const handle = async (p: Promise<{ error?: { message?: string } | null }>, ok: string) => {
    const { error } = await p;
    if (error) return toast.error(error.message ?? "Failed");
    toast.success(ok);
    router.refresh();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={async () => {
            const { error } = await authClient.admin.impersonateUser({ userId: id });
            if (error) return toast.error(error.message ?? "Failed");
            router.push("/select-organization");
            router.refresh();
          }}
        >
          Impersonate (support)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {role === "admin" ? (
          <DropdownMenuItem
            onClick={() => handle(authClient.admin.setRole({ userId: id, role: "user" }), "Demoted to user")}
          >
            Remove Super Admin
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => handle(authClient.admin.setRole({ userId: id, role: "admin" }), "Promoted to Super Admin")}
          >
            Make Super Admin
          </DropdownMenuItem>
        )}
        {banned ? (
          <DropdownMenuItem onClick={() => handle(authClient.admin.unbanUser({ userId: id }), "User unbanned")}>
            Unban
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              handle(
                authClient.admin.banUser({ userId: id, banReason: "Banned by platform administrator" }),
                "User banned",
              )
            }
          >
            Ban
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
