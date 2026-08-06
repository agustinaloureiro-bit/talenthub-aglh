import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateDisplayLocation,
  candidateDisplayName
} from "../dist/services/candidatePresentation.js";

test("limpia nombres dañados sin alterar nombres normales", () => {
  assert.equal(candidateDisplayName("Florencia Perdomo Quiñon es"), "Florencia Perdomo Quiñones");
  assert.equal(candidateDisplayName("MariaFernanda Silva"), "Maria Fernanda Silva");
  assert.equal(candidateDisplayName("Carlos Bentancourt"), "Carlos Bentancourt");
});

test("presenta localidades y no confunde direcciones o contactos con ciudades", () => {
  assert.equal(candidateDisplayLocation("Carlos Nery 3342 esq Camino Maldonado"), null);
  assert.equal(candidateDisplayLocation("J. Requena 1848 y La Paz"), null);
  assert.equal(candidateDisplayLocation("Villa Nueva"), "Villa Nueva");
  assert.equal(candidateDisplayLocation("099 123 456"), null);
});
