import base44 from "@base44/vite-plugin";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    base44({
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true,
    }),
    // No inspector: a restarted dev server would race the old one for port 9229 and crash.
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false }),
    tanstackStart({ srcDirectory: "src" }),
    react(),
  ],
});
