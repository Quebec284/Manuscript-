import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Two entry pages: "/" (Author / Editor / Other user) and "/admin/" (administrators).
// base "./" lets the site work from any sub-path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./admin/index.html", import.meta.url))
      }
    }
  }
});
