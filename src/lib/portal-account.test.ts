import { it } from "node:test";
import { strict as assert } from "node:assert";
import { canDisclosePortalIdentity } from "./portal-account";

const channels = [{ instance: "fictitious-personal-channel", canonical_phone: "551198765432" }];
it("no login or only shared password cannot disclose Portal subjects", () => {
  assert.equal(
    canDisclosePortalIdentity(false, [], channels, "fictitious-personal-channel", "551198765432"),
    false,
  );
  assert.equal(
    canDisclosePortalIdentity(
      false,
      ["admin"],
      channels,
      "fictitious-personal-channel",
      "551198765432",
    ),
    false,
  );
});
it("verified common account cannot disclose Portal subjects", () => {
  assert.equal(
    canDisclosePortalIdentity(true, [], channels, "fictitious-personal-channel", "551198765432"),
    false,
  );
  assert.equal(
    canDisclosePortalIdentity(
      true,
      ["team"],
      channels,
      "fictitious-personal-channel",
      "551198765432",
    ),
    false,
  );
});
it("verified admin needs exact approved channel and full normalized phone", () => {
  assert.equal(
    canDisclosePortalIdentity(
      true,
      ["admin"],
      channels,
      "fictitious-personal-channel",
      "551198765432",
    ),
    true,
  );
  assert.equal(
    canDisclosePortalIdentity(true, ["admin"], channels, "other-channel", "551198765432"),
    false,
  );
  assert.equal(
    canDisclosePortalIdentity(
      true,
      ["admin"],
      channels,
      "fictitious-personal-channel",
      "552198765432",
    ),
    false,
  );
  assert.equal(
    canDisclosePortalIdentity(true, ["admin"], [], "fictitious-personal-channel", "551198765432"),
    false,
  );
});
