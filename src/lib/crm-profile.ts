import { z } from "zod";
// Perfil do cabeçalho (validação compartilhada). Foto: data URL de imagem já reduzida no navegador.
export const PHOTO_MAX_LENGTH = 400_000;
export const photoDataUrl = z.string().max(PHOTO_MAX_LENGTH).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Imagem inválida.");
export const profileInput = z.object({
  displayName: z.string().trim().max(80),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]),
  photo: photoDataUrl.nullable(),
  revision: z.number().int().min(0),
}).strict();
export type CrmProfile = { available: boolean; displayName: string; email: string; photo: string | null; revision: number };
export const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "G";
