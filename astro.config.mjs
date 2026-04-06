// @ts-check
import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  site: "https://rss-builder-9tz.pages.dev/",
  adapter: cloudflare(),
});
