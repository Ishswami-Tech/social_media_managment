import { redirect } from "next/navigation";

/** Everything AI-written now starts and lands on the home screen. */
export default function AgentIndexPage() {
  redirect("/home");
}
