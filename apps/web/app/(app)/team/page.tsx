import { redirect } from "next/navigation";

/** The team list now lives in Settings. */
export default function TeamPage() {
  redirect("/settings?tab=team");
}
