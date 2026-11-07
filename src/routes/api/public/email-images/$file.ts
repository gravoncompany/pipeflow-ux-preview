import { createFileRoute } from "@tanstack/react-router";

// Imagens inseridas nos e-mails de campanha precisam ser lidas pelo Gmail/Outlook sem login.
// Só serve arquivos da pasta de imagens de e-mail pelo nome aleatório exato; nada é listado.
export const Route = createFileRoute("/api/public/email-images/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { readEmailImage } = await import("@/lib/email-images.server");
        const img = await readEmailImage(params.file);
        if (!img) return new Response("Not found", { status: 404 });
        return new Response(img.bytes, {
          headers: {
            "content-type": img.mime,
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'",
          },
        });
      },
    },
  },
});
