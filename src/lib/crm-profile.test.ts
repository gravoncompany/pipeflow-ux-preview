import { test } from "node:test";
import assert from "node:assert/strict";
import { profileInput, initials, PHOTO_MAX_LENGTH } from "./crm-profile";
const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
test("perfil: aceita foto JPEG/PNG/WebP em data URL; recusa SVG, scripts, tamanho excessivo e e-mail inválido", () => {
  assert.equal(profileInput.safeParse({ displayName: "Wilian", email: "w@gravon.com.br", photo: jpeg, revision: 0 }).success, true);
  assert.equal(profileInput.safeParse({ displayName: "", email: "", photo: null, revision: 3 }).success, true);
  for (const photo of ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "data:image/png;base64,abc<script>", "data:image/jpeg;base64," + "A".repeat(PHOTO_MAX_LENGTH)])
    assert.equal(profileInput.safeParse({ displayName: "x", email: "", photo, revision: 0 }).success, false, photo.slice(0, 30));
  assert.equal(profileInput.safeParse({ displayName: "x", email: "nao-e-email", photo: null, revision: 0 }).success, false);
  assert.equal(profileInput.safeParse({ displayName: "x".repeat(81), email: "", photo: null, revision: 0 }).success, false);
});
test("iniciais para quando não há foto", () => { assert.equal(initials("Wilian Souza Gravon"), "WS"); assert.equal(initials(""), "G"); });
