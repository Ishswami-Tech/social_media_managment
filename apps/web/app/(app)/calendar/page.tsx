import { redirect } from "next/navigation";

/** The calendar now lives inside Posts. */
export default function CalendarPage() {
  redirect("/posts?view=calendar");
}
