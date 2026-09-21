import type { Skill } from "./skills";

/**
 * Custom skills: Agent-Skills style playbooks (a `SKILL.md` with YAML
 * frontmatter plus optional `references/*.md`) that an organization imports
 * from a repository or writes by hand. The markdown becomes the system prompt
 * the model follows when the skill runs; the tool set is the standard research
 * kit so skills can read URLs, feeds and brand knowledge.
 */
export interface CustomSkillDefinition {
  slug: string;
  name: string;
  description: string;
  /** SKILL.md body followed by any reference documents. */
  instructions: string;
  /** Where the skill came from (repository or file URL), for display and re-import. */
  sourceUrl?: string;
}

export const CUSTOM_SKILL_PREFIX = "custom:";

/** Upper bounds keep a single skill from blowing the model's context. */
export const SKILL_MAX_CHARS = 120_000;
export const REFERENCE_MAX_CHARS = 24_000;

const OUTPUT = `Return ONLY a JSON object with this shape:
{"title": "...", "summary": "the main deliverable of the skill, in full", "keyPoints": ["..."], "angles": [{"hook": "...", "why": "..."}], "postIdeas": [{"platform": "LINKEDIN", "text": "ready-to-publish post text", "hashtags": ["#..."]}], "sources": [{"title": "...", "url": "...", "note": "..."}], "caveats": ["..."]}
Put the finished content the skill produces into postIdeas (one entry per post/platform) and a short explanation of your choices into summary. Never invent URLs, statistics or quotes; list sources you actually read.`;

/** Parses YAML-ish frontmatter (name, description) and returns the markdown body. */
export function parseSkillMarkdown(markdown: string): { name?: string; description?: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown.trim());
  if (!m) return { body: markdown.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2]!.trim();
    meta[kv[1]!] = raw.replace(/^(['"])([\s\S]*)\1$/, "$2").replace(/\\"/g, '"');
  }
  return { name: meta.name, description: meta.description, body: m[2]!.trim() };
}

export function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "skill";
}

/** Builds a runnable Skill from a stored definition. */
export function customSkill(def: CustomSkillDefinition, opts: { hasSearch: boolean }): Skill {
  const tools: Skill["tools"] = ["read_url", "read_feed", "brand_knowledge", "recent_posts_performance"];
  if (opts.hasSearch) tools.unshift("web_search");
  return {
    id: `${CUSTOM_SKILL_PREFIX}${def.slug}`,
    name: def.name,
    description: def.description,
    inputLabel: "Topic, brief or draft",
    inputPlaceholder: "What should this skill work on?",
    tools,
    needsSearch: false,
    maxSteps: 6,
    system: ({ brand, platforms }) =>
      [
        `You are running the skill "${def.name}" inside a social media publishing platform${brand ? ` for the brand "${brand}"` : ""}. Target platforms: ${platforms.join(", ")}.`,
        "Read the SKILL instructions below and follow them exactly: they define your role, process, formats and quality bar. Where the instructions mention files, scripts, commands or other agents that are not available here, use the equivalent tools you do have (web_search when present, read_url, read_feed, brand_knowledge, recent_posts_performance) or work from the input directly.",
        "",
        "===== SKILL INSTRUCTIONS =====",
        def.instructions.slice(0, SKILL_MAX_CHARS),
        "===== END SKILL INSTRUCTIONS =====",
        "",
        OUTPUT,
      ].join("\n"),
    user: (input, platforms) => `Platforms: ${platforms.join(", ")}\n\nInput:\n${input}`,
  };
}

// ---------------------------------------------------------------------------
// Import from GitHub (a repository, a folder inside it, or a single SKILL.md)
// ---------------------------------------------------------------------------

export interface GitHubSkillSource {
  owner: string;
  repo: string;
  ref?: string;
  /** Sub-path inside the repository ("" for the whole repo). */
  path: string;
  /** Set when the URL points at one markdown file. */
  file?: string;
}

/**
 * Accepts https://github.com/o/r, https://github.com/o/r/tree/main/skills,
 * https://github.com/o/r/blob/main/skills/x/SKILL.md and
 * https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md.
 */
export function parseGitHubUrl(input: string): GitHubSkillSource {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a full GitHub URL, e.g. https://github.com/owner/repo");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "raw.githubusercontent.com") {
    const [owner, repo, ref, ...rest] = parts;
    if (!owner || !repo || !ref || rest.length === 0) throw new Error("Unrecognised raw.githubusercontent.com URL");
    return { owner, repo, ref, path: rest.slice(0, -1).join("/"), file: rest.join("/") };
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com")
    throw new Error("Only GitHub URLs are supported for now (or paste the SKILL.md content directly)");
  const [owner, repo, kind, ref, ...rest] = parts;
  if (!owner || !repo) throw new Error("GitHub URL must include owner and repository");
  const cleanRepo = repo.replace(/\.git$/, "");
  if (kind === "blob" && ref) return { owner, repo: cleanRepo, ref, path: rest.slice(0, -1).join("/"), file: rest.join("/") };
  if (kind === "tree" && ref) return { owner, repo: cleanRepo, ref, path: rest.join("/") };
  return { owner, repo: cleanRepo, path: "" };
}

interface TreeEntry {
  path: string;
  type: string;
}

async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/vnd.github+json, text/plain" } });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status} for ${url}`);
  return res.text();
}

async function resolveRef(src: GitHubSkillSource): Promise<string> {
  if (src.ref) return src.ref;
  const meta = JSON.parse(await fetchText(`https://api.github.com/repos/${src.owner}/${src.repo}`)) as {
    default_branch?: string;
  };
  return meta.default_branch ?? "main";
}

function rawUrl(src: GitHubSkillSource, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${ref}/${path}`;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * Downloads every SKILL.md under the source (skipping dot-directories such as
 * `.claude`/`.codex-marketplace` copies), attaches the reference documents the
 * skill folder ships with or links to, and returns import-ready definitions.
 */
export async function fetchGitHubSkills(input: string): Promise<CustomSkillDefinition[]> {
  const src = parseGitHubUrl(input);
  const ref = await resolveRef(src);
  const tree = (
    JSON.parse(await fetchText(`https://api.github.com/repos/${src.owner}/${src.repo}/git/trees/${ref}?recursive=1`)) as {
      tree?: TreeEntry[];
    }
  ).tree ?? [];
  const files = new Set(tree.filter((t) => t.type === "blob").map((t) => t.path));
  const inScope = (p: string) => (src.path ? p === src.path || p.startsWith(`${src.path}/`) : true);
  const skillFiles = src.file
    ? [src.file]
    : [...files].filter((p) => /(^|\/)SKILL\.md$/i.test(p) && inScope(p) && !p.split("/").some((seg) => seg.startsWith(".")));
  if (skillFiles.length === 0) throw new Error("No SKILL.md files found at that location");

  const out: CustomSkillDefinition[] = [];
  for (const skillPath of skillFiles.slice(0, 40)) {
    const markdown = await fetchText(rawUrl(src, ref, skillPath));
    const parsed = parseSkillMarkdown(markdown);
    const dir = dirname(skillPath);
    const folderName = dir.split("/").pop() ?? "";
    const name = parsed.name ?? folderName ?? "Imported skill";
    // References: the skill's own references folder plus repo-level files it links to.
    const own = [...files].filter((p) => p.startsWith(`${dir ? `${dir}/` : ""}references/`) && /\.md$/i.test(p));
    const linked = [...markdown.matchAll(/\(([^)\s]*references\/[\w./-]+\.md)\)|`([^`]*references\/[\w./-]+\.md)`/g)]
      .map((m) => (m[1] ?? m[2] ?? "").replace(/^(\.\.\/)+/, "").replace(/^\.\//, ""))
      .filter((p) => files.has(p) && !own.includes(p));
    const references: string[] = [];
    let budget = SKILL_MAX_CHARS - parsed.body.length;
    for (const refPath of [...own, ...linked]) {
      if (budget <= 0) break;
      const text = (await fetchText(rawUrl(src, ref, refPath))).slice(0, REFERENCE_MAX_CHARS);
      references.push(`### ${refPath}\n\n${text}`);
      budget -= text.length;
    }
    const instructions = references.length ? `${parsed.body}\n\n## Reference documents\n\n${references.join("\n\n")}` : parsed.body;
    out.push({
      slug: slugifySkillName(name),
      name,
      description: parsed.description ?? parsed.body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 300) ?? "",
      instructions,
      sourceUrl: `https://github.com/${src.owner}/${src.repo}/blob/${ref}/${skillPath}`,
    });
  }
  return out;
}
