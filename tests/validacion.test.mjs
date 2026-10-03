import { test } from "node:test";
import assert from "node:assert/strict";
import * as v from "../dist/validacion.js";

test("grado: solo enteros de 1 a 6", () => {
  for (const g of [1, 6]) assert.ok(v.esGrado(g));
  for (const g of [0, 7, 2.5, "3", null]) assert.ok(!v.esGrado(g));
});

test("complejidad: básico, medio o avanzado", () => {
  assert.ok(v.esComplejidad("medio"));
  assert.ok(!v.esComplejidad("dificil"));
});

test("URL de PDF: http/https y ruta .pdf", () => {
  assert.ok(v.esUrlPdf("https://ejemplo.es/fichas/a.PDF?x=1"));
  assert.ok(!v.esUrlPdf("https://ejemplo.es/fichas/a.html"));
  assert.ok(!v.esUrlPdf("ftp://ejemplo.es/a.pdf"));
  assert.ok(!v.esUrlPdf("no es url"));
});

test("fechas y meses inválidos", () => {
  assert.ok(v.esFecha("2026-02-28"));
  assert.ok(!v.esFecha("2026-02-30"));
  assert.ok(!v.esFecha("2026-2-3"));
  assert.ok(v.esMes("2026-11"));
  assert.ok(!v.esMes("2026-13"));
});

test("nombre del alumno", () => {
  assert.equal(v.validarNombre("  Ana   María "), "Ana María");
  assert.equal(v.validarNombre(""), null);
  assert.equal(v.validarNombre("x".repeat(41)), null);
  assert.equal(v.validarNombre("a\u0007b"), null);
});
