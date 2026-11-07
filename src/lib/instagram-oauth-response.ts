import { parse, isLosslessNumber } from "lossless-json";
import { z } from "zod";
import { instagramId } from "./instagram";

// Only the identity field is converted to decimal text; tokens are never inspected or logged.
export function parseInstagramOAuthResponse(text: string): unknown {
  return parse(text, (key, value) => {
    if (!isLosslessNumber(value)) return value;
    if (key === "user_id" && /^[1-9]\d{0,39}$/.test(value.value)) return value.value;
    return value.value === String(Number(value.value)) && Number.isSafeInteger(Number(value.value))
      ? Number(value.value)
      : NaN;
  });
}

export const instagramOAuthIdentity = z.union([
  instagramId,
  z.number().int().safe().positive().transform(String),
]);
export const instagramOAuthPermissions = z.union([
  z.array(z.string().min(1).max(100)).max(20),
  z
    .string()
    .min(1)
    .max(2048)
    .transform((value) => value.split(",").map((scope) => scope.trim()))
    .pipe(z.array(z.string().min(1).max(100)).max(20)),
]);
