import { test } from "node:test";
import assert from "node:assert/strict";
import { asignaturasDeGrado, temasDe, validarCatalogo } from "../dist/catalogo.js";
import { catalogo } from "./ayudas.mjs";

test("todos los grados de 1 a 6 tienen asignaturas y temas", () => {
  for (let g = 1; g <= 6; g++) {
    const asigs = asignaturasDeGrado(catalogo, g);
    assert.ok(asigs.length >= 5, `grado ${g}`);
    for (const a of asigs) assert.ok(temasDe(catalogo, g, a).length > 0, `${g}/${a}`);
  }
});

test("los temas dependen de la asignatura y del grado", () => {
  assert.notDeepEqual(temasDe(catalogo, 4, "mat"), temasDe(catalogo, 4, "len"));
  assert.notDeepEqual(temasDe(catalogo, 1, "mat"), temasDe(catalogo, 6, "mat"));
  assert.deepEqual(temasDe(catalogo, 4, "noexiste"), []);
});

test("rechaza un catálogo mal formado", () => {
  assert.throws(() => validarCatalogo({ asignaturas: { mat: "M" }, temas: { 9: {} } }), /grado inválido/);
  assert.throws(() => validarCatalogo({ asignaturas: { mat: "M" }, temas: { 1: { len: ["x"] } } }), /desconocida/);
});
