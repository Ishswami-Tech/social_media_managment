"use client";

import { useRouter } from "next/navigation";
import { Building2, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
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
  /** "rail": the name row at the foot of the dark sidebar. */
  variant?: "header" | "rail";
}

export function UserMenu({ user, role, impersonatedBy, variant = "header" }: Props) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

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
    <div className={cn("flex items-center gap-2", variant === "rail" && "grid")}>
      {impersonatedBy && (
        <Button variant="destructive" size="sm" onClick={stopImpersonating}>
          Stop impersonating
        </Button>
      )}
      {role && variant === "header" && <Badge variant="secondary">{role}</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "rail" ? (
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-signal/60"
            >
              <Avatar className="size-8">
                <AvatarImage src={user.image ?? undefined} alt={user.name} />
                <AvatarFallback className="bg-white/15 text-[12px] font-semibold text-white">{initials(user.name).slice(0, 1)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-[14px] leading-tight font-semibold text-white">{user.name.split(" ")[0]}</span>
                {role && <span className="block truncate text-[12px] text-sidebar-muted capitalize">{role.toLowerCase()}</span>}
              </span>
            </button>
          ) : (
            <button className="rounded-full outline-none focus-visible:ring-2">
              <Avatar>
                <AvatarImage src={user.image ?? undefined} alt={user.name} />
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={variant === "rail" ? "start" : "end"} side={variant === "rail" ? "top" : "bottom"} className="w-56">
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
          <DropdownMenuItem onClick={() => setTheme(dark ? "light" : "dark")}>
            {dark ? <Sun /> : <Moon />} {dark ? "Light theme" : "Dark theme"}
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
