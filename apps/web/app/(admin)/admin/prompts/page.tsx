import { requireSuperAdmin } from "@/lib/session";
import { labPrompts, labRuns } from "@/lib/agent/lab";
import { PageHeader } from "@/components/app/page-header";
import { PromptLab } from "@/components/admin/prompt-lab";

export const metadata = { title: "Prompt lab" };

/** Try a stage prompt from a real campaign against several models and compare, without touching the campaign. */
export default async function AdminPromptLabPage() {
  await requireSuperAdmin();
  const [prompts, runs] = await Promise.all([labPrompts(), labRuns()]);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Prompt lab"
        description="Pick a stage prompt and a real campaign, run it on up to four models, and compare the answers with the pipeline's own checks and reach estimate. Nothing is written to the campaign."
      />
      <PromptLab prompts={prompts} runs={runs} />
    </div>
  );
}
