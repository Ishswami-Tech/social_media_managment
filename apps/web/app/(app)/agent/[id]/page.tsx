import { redirect } from "next/navigation";

/** Old detail links keep working; the review screen replaced this page. */
export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/review/${id}`);
}
