// Imagens do e-mail marketing: só formatos que Gmail e Outlook exibem, conferidos pelo conteúdo do arquivo.
export const EMAIL_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export function emailImageType(bytes: Uint8Array): { ext: "png" | "jpg" | "gif"; mime: string } | null {
  if (bytes.length < 8) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return { ext: "gif", mime: "image/gif" };
  return null;
}
