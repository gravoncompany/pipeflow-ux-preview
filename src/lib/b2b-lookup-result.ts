import type { CompanyData } from "./b2b-prospecting";

export type B2bLookupResult =
  | { ok: true; company: CompanyData | null }
  | { ok: false; code: string; message: string };

/** Only locally owned messages from known errors may cross the server boundary. */
export async function b2bLookupResult(
  work: () => Promise<CompanyData | null>,
  safeError: (error: unknown) => { code: string; message: string } | null,
): Promise<B2bLookupResult> {
  try {
    return { ok: true, company: await work() };
  } catch (error) {
    return {
      ok: false,
      ...(safeError(error) ?? {
        code: "lookup_unavailable",
        message: "Não foi possível confirmar a consulta. Confira o registro de consumo antes de repetir.",
      }),
    };
  }
}