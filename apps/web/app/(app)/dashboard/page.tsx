import { redirect } from "next/navigation";

/** The dashboard was replaced by the simpler home screen. */
export default function DashboardPage() {
  redirect("/home");
}
