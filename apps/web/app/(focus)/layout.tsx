import { requireOrg } from "@/lib/session";

/** Full-screen views that leave the sidebar behind (the Council Room). Same sign-in rules as the app. */
export const dynamic = "force-dynamic";

export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  await requireOrg();
  return <>{children}</>;
}
