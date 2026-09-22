import { redirect } from "next/navigation";

/** Brand voice now lives in Settings. */
export default function BrandPage() {
  redirect("/settings?tab=brand");
}
