import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Almacen } from "../dist/almacen.js";
import { almacenTemporal } from "./ayudas.mjs";

test("la escritura atómica no corrompe el JSON con escrituras en paralelo", async () => {
  const a = await almacenTemporal();
  await Promise.all(Array.from({ length: 40 }, (_, i) => a.crearAlumno(100, `Alumno ${i}`, 3)));
  await a.vaciarCola();
  const json = JSON.parse(await readFile(join(a.dir, "alumnos.json"), "utf8"));
  assert.equal(json.length, 40);
  const restos = (await readdir(a.dir)).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(restos, []);
});

test("los datos sobreviven a reabrir el almacén", async () => {
  const a = await almacenTemporal();
  const al = await a.crearAlumno(7, "Lucía", 4);
  const b = await Almacen.abrir(a.dir);
  assert.equal(b.alumnoPorToken(al.token)?.nombre, "Lucía");
});

test("desmarcar y regenerar token quedan en el registro", async () => {
  const a = await almacenTemporal();
  const al = await a.crearAlumno(7, "Lucía", 4);
  await a.crearPlan({ alumnoId: al.id, mes: "2026-11", dias: [1], dificultades: [] }, [{ fecha: "2026-11-02", fichaId: "0123456789abcdef", asignatura: "mat" }]);
  await a.marcarImpresa(al.id, "0123456789abcdef", "2026-11-02", true);
  await a.marcarImpresa(al.id, "0123456789abcdef", "2026-11-02", false);
  const viejo = al.token;
  await a.regenerarToken(al.id);
  assert.notEqual(a.alumno(al.id).token, viejo);
  const registro = JSON.parse(await readFile(join(a.dir, "registro.json"), "utf8"));
  assert.deepEqual(registro.map((r) => r.tipo), ["desmarcar-impresion", "regenerar-token"]);
});
