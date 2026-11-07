import { EMAIL_IMAGE_ROUTE, EMAIL_PUBLIC_ORIGIN } from "./email-content";
import { emailImageType, EMAIL_IMAGE_MAX_BYTES } from "./email-images";

const BUCKET = "email-images";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Recebe a imagem já autorizada (acesso completo ao CRM) e devolve o endereço público para o e-mail. */
export async function storeEmailImage(base64: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (!bytes.length || bytes.length > EMAIL_IMAGE_MAX_BYTES) throw new Error("A imagem precisa ter até 2 MB.");
  const type = emailImageType(bytes);
  if (!type) throw new Error("Use uma imagem JPG, PNG ou GIF (formatos exibidos pelo Gmail e pelo Outlook).");
  const name = `${crypto.randomUUID()}.${type.ext}`;
  const up = await (await admin()).storage.from(BUCKET).upload(name, bytes, { contentType: type.mime, upsert: false });
  if (up.error) throw new Error("Não foi possível guardar a imagem. Tente novamente.");
  return { url: `${EMAIL_PUBLIC_ORIGIN}${EMAIL_IMAGE_ROUTE}${name}` };
}

/** Leitura pública apenas de arquivos desta pasta, pelo nome aleatório exato. */
export async function readEmailImage(file: string) {
  const m = /^([0-9a-f-]{36})\.(png|jpg|gif)$/.exec(file);
  if (!m) return null;
  const res = await (await admin()).storage.from(BUCKET).download(file);
  if (res.error || !res.data) return null;
  const bytes = new Uint8Array(await res.data.arrayBuffer());
  const type = emailImageType(bytes);
  if (!type || type.ext !== m[2]) return null;
  return { bytes, mime: type.mime };
}
