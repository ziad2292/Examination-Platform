import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({test:{include:["src/**/*.test.{ts,tsx}"],environment:"node",coverage:{provider:"v8",reporter:["text","html"]}},resolve:{alias:{"@":fileURLToPath(new URL("./src",import.meta.url))}}});
