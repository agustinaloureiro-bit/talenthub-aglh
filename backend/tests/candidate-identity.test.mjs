import assert from "node:assert/strict";
import test from "node:test";

const identity = await import("../dist/services/candidateIdentity.js");

test("reconoce el mismo nombre con acentos, particulas y segundo apellido", () => {
  assert.equal(identity.namesLikelySame("José de los Santos", "Jose Santos"), true);
  assert.equal(identity.namesLikelySame("David Meneses", "David H. Meneses"), true);
});

test("no une personas distintas aunque compartan un contacto contaminado", () => {
  assert.equal(identity.namesLikelySame("Lucas Techera", "Ezequiel Sanz"), false);
  assert.equal(identity.namesLikelySame("Maria Garcia", "Maria Rodriguez"), false);
  assert.equal(identity.namesLikelySame("Maria", "Maria Garcia"), false);
});

test("normaliza telefonos uruguayos para comparar identidades", () => {
  assert.equal(identity.normalizePhoneIdentity("+598 99 123 456"), "099123456");
  assert.equal(identity.normalizePhoneIdentity("099 123 456"), "099123456");
});

test("elige emails relacionados con la persona y descarta contactos de otros CVs", () => {
  const selected = identity.selectCandidateEmails([
    "referencia@example.com",
    "lucas.techera@gmail.com",
    "otra.persona@example.com",
    "lucastechera@outlook.com"
  ], "Lucas Techera");

  assert.deepEqual(selected, ["lucas.techera@gmail.com", "lucastechera@outlook.com"]);
});

test("no conserva varios emails ajenos cuando ninguno coincide con el nombre", () => {
  const selected = identity.selectCandidateEmails([
    "referencia@example.com",
    "otra.persona@example.com"
  ], "Lucas Techera");

  assert.deepEqual(selected, ["referencia@example.com"]);
});
