import { describe, it } from "node:test";
import assert from "node:assert/strict";
const expect = (v: unknown) => ({ toEqual: (e: unknown) => assert.deepEqual(v, e), toBe: (e: unknown) => assert.equal(v, e), toMatchObject: (e: Record<string, unknown>) => { for (const k in e) assert.deepEqual((v as any)[k], e[k]); } });
import { clientCardLinks } from "./client-card-links";

const client = (p: Partial<Parameters<typeof clientCardLinks>[0][0]> = {}) => ({ id: "c1", lead_id: null, trade_name: "Clínica Sorriso", contact_name: "Ana", phone: "", whatsapp: "(11) 99876-5432", email: "ana@sorriso.com", ...p });
const lead = (p: Partial<Parameters<typeof clientCardLinks>[1][0]> = {}) => ({ id: "l1", name: "Ana", company: "Outra", whatsapp: "", email: "", stage: "lead-novo", pipeline_id: null, ...p });

describe("clientCardLinks", () => {
  it("a client with a stored link shows that card", () => {
    const [r] = clientCardLinks([client({ lead_id: "l9" })], [lead({ id: "l9", whatsapp: "x" })]);
    expect(r).toMatchObject({ state: "linked", leadId: "l9" });
  });
  it("matching WhatsApp (with or without 55/ninth digit) is only a suggestion", () => {
    const [r] = clientCardLinks([client()], [lead({ whatsapp: "5511998765432" })]);
    expect(r.state).toBe("unlinked");
    expect(r.state === "unlinked" && r.candidates.map((c) => c.leadId)).toEqual(["l1"]);
  });
  it("cards already linked to another client are never suggested", () => {
    const res = clientCardLinks([client(), client({ id: "c2", lead_id: "l1" })], [lead({ email: "ana@sorriso.com" })]);
    expect(res[0].state === "unlinked" && res[0].candidates).toEqual([]);
  });
  it("same company name ignoring accents counts as a suggestion", () => {
    const [r] = clientCardLinks([client({ whatsapp: "", email: "" })], [lead({ company: "clinica sorriso" })]);
    expect(r.state === "unlinked" && r.candidates[0].reasons).toEqual(["mesma empresa"]);
  });
  it("no match means no candidates", () => {
    const [r] = clientCardLinks([client()], [lead()]);
    expect(r.state === "unlinked" && r.candidates).toEqual([]);
  });
});
