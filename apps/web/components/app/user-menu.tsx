"use client";

import { useRouter } from "next/navigation";
import { Building2, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  user: { name: string; email: string; image?: string | null };
  role?: string;
  impersonatedBy: string | null;
}

export function UserMenu({ user, role, impersonatedBy }: Props) {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  async function stopImpersonating() {
    const { error } = await authClient.admin.stopImpersonating();
    if (error) return toast.error(error.message ?? "Failed");
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {impersonatedBy && (
        <Button variant="destructive" size="sm" onClick={stopImpersonating}>
          Stop impersonating
        </Button>
      )}
      {role && <Badge variant="secondary">{role}</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded-full outline-none focus-visible:ring-2">
            <Avatar>
              <AvatarImage src={user.image ?? undefined} alt={user.name} />
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <span className="block font-medium">{user.name}</span>
            <span className="block text-xs font-normal text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/select-organization")}>
            <Building2 /> Switch organization
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/settings")}>
            <UserRound /> Profile & settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={signOut}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
