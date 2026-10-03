import { test } from "node:test";
import assert from "node:assert/strict";
import { claveDificultad, diaSemana, fechasDelMes, planificar } from "../dist/planificador.js";

const mat = { asignatura: "mat", tema: "Fracciones", complejidad: "basico" };
const len = { asignatura: "len", tema: "Acentuación", complejidad: "medio" };
const ids = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i}`);

test("diaSemana: lunes = 1, domingo = 7", () => {
  assert.equal(diaSemana("2026-11-02"), 1);
  assert.equal(diaSemana("2026-11-08"), 7);
});

test("fechasDelMes respeta los días elegidos y la fecha 'desde'", () => {
  const lv = fechasDelMes("2026-11", [1, 2, 3, 4, 5]);
  assert.equal(lv.length, 21);
  assert.ok(lv.every((f) => diaSemana(f) <= 5));
  assert.deepEqual(fechasDelMes("2026-11", [3], "2026-11-12"), ["2026-11-18", "2026-11-25"]);
});

test("reparte 2 fichas por día en básico y 3 en medio", () => {
  const r = planificar({
    fechas: ["2026-11-02", "2026-11-03"],
    dificultades: [mat, len],
    candidatas: { [claveDificultad(mat)]: ids("m", 10), [claveDificultad(len)]: ids("l", 10) },
    excluir: new Set(),
  });
  const cuenta = (fecha, asig) => r.asignaciones.filter((a) => a.fecha === fecha && a.asignatura === asig).length;
  assert.equal(cuenta("2026-11-02", "mat"), 2);
  assert.equal(cuenta("2026-11-02", "len"), 3);
  assert.equal(cuenta("2026-11-03", "len"), 3);
  assert.deepEqual(r.avisos, []);
});

test("no repite fichas y excluye las ya impresas", () => {
  const r = planificar({
    fechas: ["2026-11-02", "2026-11-03"],
    dificultades: [mat],
    candidatas: { [claveDificultad(mat)]: ["a", "b", "a", "c", "d", "e"] },
    excluir: new Set(["b"]),
  });
  const usadas = r.asignaciones.map((a) => a.fichaId);
  assert.equal(new Set(usadas).size, usadas.length);
  assert.ok(!usadas.includes("b"));
  assert.deepEqual(usadas, ["a", "c", "d", "e"]);
});

test("recorta el plan si faltan fichas y avisa", () => {
  const r = planificar({
    fechas: ["2026-11-02", "2026-11-03", "2026-11-04"],
    dificultades: [mat],
    candidatas: { [claveDificultad(mat)]: ["a", "b", "c"] },
    excluir: new Set(),
    nombres: { mat: "Matemáticas" },
  });
  assert.deepEqual(r.asignaciones.map((a) => a.fecha), ["2026-11-02", "2026-11-02", "2026-11-03"]);
  assert.match(r.avisos[0], /Matemáticas.*hasta el 2026-11-03/);
});

test("sin fichas: plan vacío con aviso", () => {
  const r = planificar({ fechas: ["2026-11-02"], dificultades: [mat], candidatas: {}, excluir: new Set() });
  assert.equal(r.asignaciones.length, 0);
  assert.match(r.avisos[0], /No se encontraron fichas/);
});

test("es determinista", () => {
  const e = { fechas: ["2026-11-02", "2026-11-03"], dificultades: [mat, len], candidatas: { [claveDificultad(mat)]: ids("m", 5), [claveDificultad(len)]: ids("l", 5) }, excluir: new Set() };
  assert.deepEqual(planificar(e), planificar(e));
});
