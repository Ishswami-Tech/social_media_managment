import { redirect } from "next/navigation";

/** The media library now lives in Settings. */
export default function MediaPage() {
  redirect("/settings?tab=media");
}
