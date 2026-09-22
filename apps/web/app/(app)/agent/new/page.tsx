import { redirect } from "next/navigation";

/** Writing with AI starts from the box on the home screen. */
export default function NewAgentPage() {
  redirect("/home");
}
