import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // Next.js marker module; a no-op outside the Next runtime.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
