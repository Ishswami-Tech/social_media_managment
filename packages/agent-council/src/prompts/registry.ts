import { createHash } from "node:crypto";

/** A versioned prompt; `hash` identifies key+version+template for the PromptVersion table. */
export interface PromptDefinition {
  readonly key: string;
  readonly version: number;
  readonly template: string;
  readonly hash: string;
}

export type PromptVars = Readonly<Record<string, string | number | boolean | undefined | null>>;

const registry = new Map<string, PromptDefinition>();

export function promptHash(key: string, version: number, template: string): string {
  return createHash("sha256").update(`${key}\n${version}\n${template}`, "utf8").digest("hex");
}

/**
 * Registers a prompt. Re-registering the same key with an identical hash is a
 * no-op (module re-evaluation); a different template for the same key throws
 * so a version bump is forced.
 */
export function definePrompt(key: string, version: number, template: string): PromptDefinition {
  const definition: PromptDefinition = Object.freeze({
    key,
    version,
    template,
    hash: promptHash(key, version, template),
  });
  const existing = registry.get(key);
  if (existing && existing.hash !== definition.hash) {
    throw new Error(`Prompt "${key}" already defined with a different template; bump the version`);
  }
  registry.set(key, definition);
  return definition;
}

export function getPrompt(key: string): PromptDefinition {
  const definition = registry.get(key);
  if (!definition) throw new Error(`Unknown prompt "${key}"`);
  return definition;
}

/** `{{var}}` substitution; unknown variables render as an empty string. */
export function renderTemplate(template: string, vars: PromptVars): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function renderPrompt(key: string, vars: PromptVars = {}): string {
  return renderTemplate(getPrompt(key).template, vars);
}

/** All registered prompts (for persistence in the PromptVersion table). */
export function listPrompts(): PromptDefinition[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}
