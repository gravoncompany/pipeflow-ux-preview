// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import { resolvePublicCloudDefines } from "./config/public-cloud-env";
import { cloudPublicBinding } from "./config/cloud-public-binding";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  vite: {
    plugins: [{
      name: "crm-public-cloud-configuration",
      config(_config, { mode }) {
        const env = loadEnv(mode, process.cwd(), ["VITE_SUPABASE_", "SUPABASE_", "VITE_UX_DEMO"]);
        // Versão experimental: no modo demonstração sem banco configurado, usa um endereço
        // fictício (.invalid) só para o build iniciar; os dados vêm do interceptador do navegador.
        const demo = env.VITE_UX_DEMO === "1" && !env.VITE_SUPABASE_URL && !env.SUPABASE_URL;
        const binding = demo ? { VITE_SUPABASE_URL: "https://demo.pipeflow.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo_only" } : cloudPublicBinding;
        return { define: resolvePublicCloudDefines(demo ? {} : env, binding) };
      },
    }],
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
