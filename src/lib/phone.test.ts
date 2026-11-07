import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { phoneKey, phoneDigits } from "./phone";

describe("phoneKey", () => {
  it("matches form number with WhatsApp jid without the 9th digit", () => {
    assert.equal(phoneKey("(51) 99548-6303"), phoneKey("555195486303@s.whatsapp.net"));
  });
  it("matches with and without country code", () => {
    assert.equal(phoneKey("+55 11 99999-1234"), phoneKey("11999991234"));
  });
  it("different DDD do not match", () => {
    assert.notEqual(phoneKey("11999991234"), phoneKey("21999991234"));
  });
});

describe("phoneDigits", () => {
  it("adds 55 to local numbers", () => {
    assert.equal(phoneDigits("(51) 99548-6303"), "5551995486303");
  });
});
