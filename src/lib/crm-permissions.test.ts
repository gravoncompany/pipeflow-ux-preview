import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_STAGES } from "./crm-types";
import { canAccessLead, canAdminister, canDeleteLead, canMoveLead, TEAM_STAGE_IDS, type CrmPrincipal } from "./crm-permissions";

const admin: CrmPrincipal = { role: "admin", active: true };
const team: CrmPrincipal = { role: "team", active: true };
const allowed = ["tentando-contato", "contato-realizado", "primeira-ligacao", "segunda-ligacao", "terceira-ligacao"];

describe("individual CRM permission contract (not yet deployed)", () => {
  it("denies anonymous lead access", () => {
    for (const stage of DEFAULT_STAGES) assert.equal(canAccessLead(null, stage.id), false);
  });
  it("allows exactly the five approved team stages", () => {
    assert.deepEqual([...TEAM_STAGE_IDS], allowed);
    for (const stage of allowed) assert.equal(canAccessLead(team, stage), true);
  });
  it("denies every other existing stage and newly added stages to team", () => {
    const denied = DEFAULT_STAGES.filter(stage => !allowed.includes(stage.id));
    assert.ok(denied.length > 0);
    for (const stage of denied) assert.equal(canAccessLead(team, stage.id), false);
    assert.equal(canAccessLead(team, "custom-new-stage"), false);
  });
  it("denies moves from or into hidden stages", () => {
    assert.equal(canMoveLead(team, "tentando-contato", "contato-realizado"), true);
    assert.equal(canMoveLead(team, "tentando-contato", "fechado"), false);
    assert.equal(canMoveLead(team, "lead-novo", "tentando-contato"), false);
  });
  it("permits deletion only for an active administrator", () => {
    assert.equal(canDeleteLead(admin), true);
    assert.equal(canDeleteLead(team), false);
    assert.equal(canDeleteLead(null), false);
    assert.equal(canDeleteLead({ role: "admin", active: false }), false);
  });
  it("restricts privileged areas to active administrators", () => {
    assert.equal(canAdminister(admin), true);
    assert.equal(canAdminister(team), false);
    assert.equal(canAdminister(null), false);
  });
  it("revokes access for inactive users despite a known role", () => {
    for (const role of ["admin", "team"] as const) {
      assert.equal(canAccessLead({ role, active: false }, "tentando-contato"), false);
      assert.equal(canAdminister({ role, active: false }), false);
    }
  });
  it("allows administrator access to all existing stages", () => {
    for (const stage of DEFAULT_STAGES) assert.equal(canAccessLead(admin, stage.id), true);
  });
});