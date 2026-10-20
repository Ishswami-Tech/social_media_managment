#!/usr/bin/env node
/**
 * Project-local Claude/Cursor hook handler.
 * Cursor expects a single line of valid JSON; text like "[OK] Command validated" is rejected.
 * Always allow. CLAUDE_PROJECT_DIR resolves this path before the global handler.
 */
process.stdout.write(JSON.stringify({ permission: "allow", continue: true }) + "\n");
process.exit(0);
