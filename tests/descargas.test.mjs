import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { descargarPdf } from "../dist/descargas.js";
import { esIpPrivada } from "../dist/red.js";
import { buscarFichas, parsearDuckDuckGo, validarPdf } from "../dist/busqueda.js";
import { PDF, almacenTemporal, proveedorFalso, redFalsa, respuestaPdf } from "./ayudas.mjs";

test("IPs privadas detectadas", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.20.1.1", "192.168.1.1", "169.254.1.1", "::1", "fd00::1", "::ffff:192.168.0.1"]) assert.ok(esIpPrivada(ip), ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "2a00:1450::1"]) assert.ok(!esIpPrivada(ip), ip);
});

test("IPv6 que esconden una IPv4 privada también se bloquean", () => {
  // new URL normaliza [::ffff:127.0.0.1] a [::ffff:7f00:1]: el formato hexadecimal debe detectarse.
  for (const ip of ["::ffff:7f00:1", "::ffff:c0a8:101", "::ffff:127.0.0.1", "::127.0.0.1", "::", "0:0:0:0:0:0:0:1",
    "64:ff9b::7f00:1", "64:ff9b::192.168.0.1", "2002:c0a8:0101::1", "2001:0:4136:e378::1", "fe80::1%eth0", "ff02::1", "fc00::1"]) {
    assert.ok(esIpPrivada(ip), ip);
  }
  for (const ip of ["::ffff:5db8:d822", "64:ff9b::808:808", "2002:808:808::1", "2606:4700:4700::1111"]) assert.ok(!esIpPrivada(ip), ip);
});

test("descarga un PDF válido a datos/pdfs", async () => {
  const a = await almacenTemporal();
  const red = redFalsa({ "https://web.es/f.pdf": respuestaPdf() });
  const r = await descargarPdf("https://web.es/f.pdf", a.rutaPdfs, "0123456789abcdef", red);
  assert.deepEqual(r, { ok: true, bytes: PDF.length });
  assert.deepEqual(await readFile(join(a.rutaPdfs, "0123456789abcdef.pdf")), PDF);
});

test("rechaza archivos que no son PDF", async () => {
  const a = await almacenTemporal();
  const red = redFalsa({ "https://web.es/f.pdf": () => new Response("<html>", { status: 200 }) });
  const r = await descargarPdf("https://web.es/f.pdf", a.rutaPdfs, "0123456789abcdef", red);
  assert.deepEqual(r, { ok: false, motivo: "No es un PDF" });
});

test("rechaza archivos demasiado grandes", async () => {
  const a = await almacenTemporal();
  const red = redFalsa({ "https://web.es/f.pdf": () => new Response(PDF, { headers: { "content-length": String(50 * 1024 * 1024) } }) });
  const r = await descargarPdf("https://web.es/f.pdf", a.rutaPdfs, "0123456789abcdef", red);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /grande/);
});

test("bloquea IPs privadas, también tras una redirección", async () => {
  const a = await almacenTemporal();
  const red = redFalsa({
    "https://web.es/r.pdf": () => new Response(null, { status: 302, headers: { location: "http://nas.interno/x.pdf" } }),
    "http://nas.interno/x.pdf": respuestaPdf(),
  });
  const r1 = await descargarPdf("http://localhost/x.pdf", a.rutaPdfs, "0123456789abcdef", red);
  const r2 = await descargarPdf("https://web.es/r.pdf", a.rutaPdfs, "0123456789abcdef", red);
  assert.match(r1.motivo, /no permitida/);
  assert.match(r2.motivo, /no permitida/);
  assert.ok(!red.llamadas.some((l) => l.url.includes("interno")), "nunca llega a pedir la IP privada");
});

test("validarPdf usa HEAD y descarta lo que no es PDF", async () => {
  const red = redFalsa({
    "https://web.es/si.pdf": respuestaPdf(),
    "https://web.es/no.pdf": () => new Response(null, { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.equal(await validarPdf("https://web.es/si.pdf", red), true);
  assert.equal(await validarPdf("https://web.es/no.pdf", red), false);
  assert.equal(red.llamadas[0].metodo, "HEAD");
});

test("parsea los resultados HTML de DuckDuckGo", () => {
  const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fweb.es%2Ffracciones.pdf&amp;rut=x">Fichas de <b>fracciones</b></a>`;
  assert.deepEqual(parsearDuckDuckGo(html), [{ url: "https://web.es/fracciones.pdf", titulo: "Fichas de fracciones" }]);
});

test("buscarFichas solo devuelve PDF válidos y nunca inventa URLs", async () => {
  const red = redFalsa({ "https://web.es/a.pdf": respuestaPdf() });
  const prov = proveedorFalso([{ url: "https://web.es/a.pdf", titulo: "A" }, { url: "https://web.es/roto.pdf", titulo: "B" }]);
  const f = await buscarFichas({ grado: 4, asignatura: "mat", tema: "Fracciones", complejidad: "basico", dominios: [] }, prov, red);
  assert.deepEqual(f.map((x) => x.url), ["https://web.es/a.pdf"]);
  assert.match(prov.consultas[0], /Fracciones 4º primaria .*filetype:pdf/);
});
