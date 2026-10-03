import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crearServidor, esPeticionLocal } from "../dist/servidor.js";
import { PDF, almacenTemporal, catalogo, proveedorFalso, redFalsa } from "./ayudas.mjs";

const ID = "0123456789abcdef";
let servidor, base, alumno, almacen;

before(async () => {
  almacen = await almacenTemporal();
  alumno = await almacen.crearAlumno(1, "Lucía", 4);
  await almacen.guardarFichas([{ id: ID, url: "https://web.es/f.pdf", titulo: "Fracciones 1", grado: 4, asignatura: "mat", tema: "Fracciones", complejidad: "basico", descargada: true }]);
  await writeFile(join(almacen.rutaPdfs, `${ID}.pdf`), PDF);
  await almacen.crearPlan({ alumnoId: alumno.id, mes: "2026-11", dias: [1], dificultades: [{ asignatura: "mat", tema: "Fracciones", complejidad: "basico" }] },
    [{ fecha: "2026-11-02", fichaId: ID, asignatura: "mat" }]);
  const ctx = { almacen, catalogo, proveedor: proveedorFalso([]), red: redFalsa({}), dominios: [], hoy: () => "2026-11-02" };
  servidor = crearServidor({ ctx, estadoTelegram: { conectado: true } });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const get = (r) => fetch(base + r);
const post = (cuerpo, headers = {}) => fetch(`${base}/api/alumno/${alumno.token}/impresa`, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
});

test("GET /api/salud", async () => {
  const j = await (await get("/api/salud")).json();
  assert.equal(j.ok, true);
  assert.equal(j.datos.telegram.conectado, true);
});

test("GET /api/alumno/:token: feliz y errores", async () => {
  const j = await (await get(`/api/alumno/${alumno.token}`)).json();
  assert.equal(j.datos.nombre, "Lucía");
  assert.deepEqual(j.datos.progreso, { impresas: 0, total: 1 });
  assert.equal((await get("/api/alumno/corto")).status, 400);
  assert.equal((await get(`/api/alumno/${"x".repeat(32)}`)).status, 404);
});

test("GET /api/alumno/:token/mes/:mes", async () => {
  const j = await (await get(`/api/alumno/${alumno.token}/mes/2026-11`)).json();
  assert.equal(j.datos.dias[0].fecha, "2026-11-02");
  assert.equal(j.datos.dias[0].fichas[0].asignatura, "Matemáticas");
  assert.equal((await get(`/api/alumno/${alumno.token}/mes/2026-13`)).status, 400);
});

test("POST impresa: marca, valida y comprueba el origen", async () => {
  const r = await post({ fichaId: ID, fecha: "2026-11-02", impresa: true });
  const j = await r.json();
  assert.equal(j.datos.impresa, true);
  assert.ok(j.datos.fechaImpresion);
  assert.equal((await post("{roto")).status, 400);
  assert.equal((await post({ fichaId: ID, fecha: "2026-11-02", impresa: "si" })).status, 400);
  assert.equal((await post({ fichaId: "ffffffffffffffff", fecha: "2026-11-02", impresa: true })).status, 404);
  assert.equal((await post({ fichaId: ID, fecha: "2026-11-02", impresa: true }, { Origin: "https://malo.example" })).status, 403);
  const progreso = (await (await get(`/api/alumno/${alumno.token}`)).json()).datos.progreso;
  assert.deepEqual(progreso, { impresas: 1, total: 1 });
});

test("GET /pdf/:token/:fichaId sirve solo PDF del alumno", async () => {
  const r = await get(`/pdf/${alumno.token}/${ID}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PDF);
  assert.equal((await get(`/pdf/${alumno.token}/ffffffffffffffff`)).status, 404);
  assert.equal((await get(`/pdf/${alumno.token}/..%2f..%2fdatos`)).status, 400);
});

test("configurar: página y API solo en local, y solo mientras falte el bot", async () => {
  const llamadas = [];
  let pendiente = true;
  const configuracion = {
    pendiente: () => pendiente,
    abrirBotFather: () => llamadas.push("botfather"),
    async guardarToken(t) {
      llamadas.push(t);
      if (t !== "bueno") return { ok: false, error: "no válido" };
      pendiente = false;
      return { ok: true, usuarioBot: "mi_bot" };
    },
  };
  const s = crearServidor({ ctx: { almacen, catalogo, proveedor: proveedorFalso([]), red: redFalsa({}), dominios: [], hoy: () => "2026-11-02" }, estadoTelegram: { conectado: false }, configuracion });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s.address().port}`;
  const enviar = (ruta, cuerpo, headers = {}) => fetch(b + ruta, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(cuerpo ?? {}) });
  try {
    const pagina = await fetch(`${b}/configurar`);
    assert.equal(pagina.status, 200);
    assert.match(await pagina.text(), /BotFather/);
    assert.equal((await (await fetch(`${b}/api/configurar`)).json()).datos.pendiente, true);

    assert.equal((await enviar("/api/configurar/botfather")).status, 200);
    const malo = await enviar("/api/configurar", { token: " malo " });
    assert.equal(malo.status, 400);
    assert.equal((await malo.json()).error, "no válido");
    assert.equal((await enviar("/api/configurar", { token: "bueno" }, { Origin: "https://malo.example" })).status, 403);

    const bueno = await enviar("/api/configurar", { token: "bueno" });
    assert.equal((await bueno.json()).datos.usuarioBot, "mi_bot");
    assert.deepEqual(llamadas, ["botfather", "malo", "bueno"], "el token llega sin espacios y el de otro origen no llega");

    assert.equal((await enviar("/api/configurar", { token: "otro" })).status, 409, "ya configurado: no se puede cambiar");
    assert.equal((await enviar("/api/configurar/botfather")).status, 409);
  } finally {
    s.close();
  }
});

test("esPeticionLocal: solo loopback con Host local", () => {
  const req = (ip, host) => ({ socket: { remoteAddress: ip }, headers: { host } });
  assert.ok(esPeticionLocal(req("127.0.0.1", "localhost:3000")));
  assert.ok(esPeticionLocal(req("::1", "127.0.0.1:3000")));
  assert.ok(esPeticionLocal(req("::ffff:127.0.0.1", "127.0.0.1.nip.io:3000")));
  assert.ok(!esPeticionLocal(req("192.168.1.30", "localhost:3000")), "desde otro equipo de la wifi");
  assert.ok(!esPeticionLocal(req("127.0.0.1", "malo.example:3000")), "dominio externo apuntado a 127.0.0.1");
  assert.ok(!esPeticionLocal(req("127.0.0.1", "192.168.1.20.nip.io:3000")));
});

test("sirve la web con CSP y no expone archivos de datos", async () => {
  const r = await get(`/a/${alumno.token}`);
  assert.match(await r.text(), /Profesor de repaso/);
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal((await get("/alumnos.json")).status, 404);
  assert.equal((await get("/%2e%2e%2fdatos%2falumnos.json")).status, 404);
});
