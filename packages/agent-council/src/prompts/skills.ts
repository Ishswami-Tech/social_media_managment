import { definePrompt } from "./registry";

export const SKILLS_PROMPT = definePrompt(
  "skills",
  1,
  `STAGE: SKILLS
You are the planner of an Agent Council that writes social media posts. Before anyone writes, choose which of the organization's skill playbooks the writers and reviewers should follow for this campaign. A playbook is a set of instructions (hook formulas, formatting rules, voice fixes, platform conventions) written for a purpose; the wrong one wastes the writers' attention.

CAMPAIGN
Topic: {{topic}}
Goal: {{goal}}
Audience: {{audience}}
Notes: {{notes}}
Target platforms: {{platforms}}

AVAILABLE PLAYBOOKS (id — name: what it is for)
{{catalogue}}

RULES
1. Pick only playbooks that help WRITE or POLISH a post for these platforms and this goal (writing, hooks, humanizing, repurposing, platform formatting). Skip playbooks for other jobs (commenting, replying, profile audits, analytics, planning calendars, interviews) unless the campaign is explicitly about that job.
2. At most {{maxPicks}} picks in total; fewer is better. One platform-specific writing playbook per platform is usually enough, plus one polishing playbook.
3. Use ids exactly as listed. Never invent ids.
4. If nothing fits, return an empty list.

OUTPUT
Return ONLY a JSON object (no markdown fences):
{"picks": [{"id": "custom:example", "why": "one short reason"}]}`,
);
