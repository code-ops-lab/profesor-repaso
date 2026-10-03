import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorBusqueda, buscarFichas } from "../dist/busqueda.js";
import { claveCache, generarPlan, obtenerFichas } from "../dist/servicio.js";
import { almacenTemporal, catalogo, proveedorFalso, redFalsa, respuestaPdf } from "./ayudas.mjs";

const D = { asignatura: "mat", tema: "Fracciones", complejidad: "basico" };
const URL_PDF = "https://web.es/a.pdf";

const proveedorRoto = () => ({ nombre: "roto", async buscar() { throw new Error("respondió 202"); } });

async function contexto(proveedor) {
  return {
    almacen: await almacenTemporal(), catalogo, proveedor, dominios: [],
    red: redFalsa({ [URL_PDF]: respuestaPdf() }),
    hoy: () => "2026-10-02",
  };
}

test("buscarFichas lanza ErrorBusqueda si el buscador no responde", async () => {
  const p = { grado: 4, ...D, dominios: [] };
  await assert.rejects(buscarFichas(p, proveedorRoto(), redFalsa({})), ErrorBusqueda);
});

test("una búsqueda sin resultados no se guarda en caché", async () => {
  const ctx = await contexto(proveedorFalso([]));
  assert.deepEqual(await obtenerFichas(ctx, 4, D), []);
  assert.equal(ctx.almacen.cache(claveCache(4, D)), undefined);
  await obtenerFichas(ctx, 4, D);
  assert.equal(ctx.proveedor.consultas.length, 2, "la segunda vez vuelve a buscar");
});

test("una entrada de caché vacía se ignora y se vuelve a buscar", async () => {
  const ctx = await contexto(proveedorFalso([{ url: URL_PDF, titulo: "A" }]));
  await ctx.almacen.guardarCache(claveCache(4, D), []);
  const fichas = await obtenerFichas(ctx, 4, D);
  assert.deepEqual(fichas.map((f) => f.url), [URL_PDF]);
  assert.equal(ctx.almacen.cache(claveCache(4, D)).fichaIds.length, 1);
});

test("una búsqueda con resultados sí se guarda y no se repite", async () => {
  const ctx = await contexto(proveedorFalso([{ url: URL_PDF, titulo: "A" }]));
  await obtenerFichas(ctx, 4, D);
  await obtenerFichas(ctx, 4, D);
  assert.equal(ctx.proveedor.consultas.length, 1);
});

test("si el buscador falla, el plan avisa y no se guarda nada en caché", async () => {
  const ctx = await contexto(proveedorRoto());
  const alumno = await ctx.almacen.crearAlumno(1, "Lucía", 4);
  const r = await generarPlan(ctx, alumno, [D], "2026-11", [1, 2, 3, 4, 5]);
  assert.equal(r.plan, undefined);
  assert.match(r.avisos[0], /buscador no ha respondido/);
  assert.equal(ctx.almacen.cache(claveCache(4, D)), undefined);
});
