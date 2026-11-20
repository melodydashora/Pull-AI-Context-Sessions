import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// One command runs every test in web/: `npm test`.
// Tests run in Node. The app's components are rendered to a string, so no browser is needed.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["core/src/**/*.test.ts", "server/src/**/*.test.ts", "app/src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
    __BUILD_ID__: JSON.stringify("test"),
  },
});
