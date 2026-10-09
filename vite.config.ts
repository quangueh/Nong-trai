import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      output: {
        /*
         * The single 470KB chunk becomes three cached files. They are still
         * loaded up front (the router renders screens synchronously), but Pages
         * serves /assets/* immutable for a year — so a deploy now revalidates
         * only the chunks that actually changed, and the service worker's
         * stale-while-revalidate refresh lands the same split for free.
         */
        manualChunks(id) {
          if (id.includes("src/battle/")) return "battle";
          if (id.includes("src/render/")) return "render";
          if (
            id.includes("src/config/species") ||
            id.includes("src/config/traits") ||
            id.includes("src/config/skills") ||
            id.includes("src/config/genePackages") ||
            id.includes("src/quests/generated")
          )
            return "data";
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
