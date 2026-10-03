import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot, boton, trocear, urlParaEnlaces } from "../dist/telegram.js";
import { asignaturasDeGrado, temasDe } from "../dist/catalogo.js";
import { almacenTemporal, catalogo, proveedorFalso, redFalsa, respuestaPdf } from "./ayudas.mjs";

function apiFalsa() {
  const llamadas = [];
  return { llamadas, async llamar(metodo, params) { llamadas.push({ metodo, params }); return { message_id: 10 }; } };
}

const msg = (chatId, text) => ({ update_id: 1, message: { chat: { id: chatId, type: "private" }, text } });
const cb = (chatId, data) => ({ update_id: 1, callback_query: { id: "q", data, message: { message_id: 10, chat: { id: chatId, type: "private" } } } });
const ultimo = (api) => [...api.llamadas].reverse().find((l) => l.metodo !== "answerCallbackQuery");
const datosBotones = (l) => (l.params.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data ?? b.url);

async function preparar(nUrls = 50) {
  const urls = Array.from({ length: nUrls }, (_, i) => `https://web.es/ficha-${i}.pdf`);
  const red = redFalsa(Object.fromEntries(urls.map((u) => [u, respuestaPdf()])));
  const ctx = {
    almacen: await almacenTemporal(), catalogo, red, dominios: [],
    proveedor: proveedorFalso(urls.map((url, i) => ({ url, titulo: `Ficha ${i}` }))),
    hoy: () => "2026-10-02",
  };
  const api = apiFalsa();
  return { ctx, api, bot: new Bot(ctx, api, "http://localhost:3000") };
}

test("callback_data nunca supera 64 bytes", async () => {
  assert.throws(() => boton("x", "a".repeat(65)), /demasiado largo/);
  const { bot } = await preparar(0);
  const alumno = { id: "abcd1234", chatId: 1, nombre: "A", grado: 1, token: "t", creado: "" };
  for (let g = 1; g <= 6; g++) {
    alumno.grado = g;
    for (const p of [bot.listaAsignaturas(alumno), ...asignaturasDeGrado(catalogo, g).map((a) => bot.listaTemas(alumno, a))]) {
      for (const b of p.teclado.flat()) if ("callback_data" in b) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
    }
  }
});

test("flujo completo: alumno → grado → asignatura → tema → complejidad → mes → plan", async () => {
  const { ctx, api, bot } = await preparar();
  await bot.manejar(msg(1, "/start"));
  assert.deepEqual(datosBotones(ultimo(api)), ["na", "ma", "ay"]);

  await bot.manejar(cb(1, "na"));
  await bot.manejar(msg(1, "Lucía"));
  assert.match(ultimo(api).params.text, /grado está Lucía/);

  await bot.manejar(cb(1, "g:4"));
  const [alumno] = ctx.almacen.alumnosDe(1);
  assert.equal(alumno.grado, 4);

  await bot.manejar(cb(1, "nd"));
  assert.ok(datosBotones(ultimo(api)).includes("as:mat"));

  await bot.manejar(cb(1, "as:mat"));
  const temas = ultimo(api).params.reply_markup.inline_keyboard.flat().map((b) => b.text).slice(0, -1);
  assert.deepEqual(temas, temasDe(catalogo, 4, "mat"), "los temas son los de esa asignatura y grado");

  await bot.manejar(cb(1, "te:3"));
  assert.match(ultimo(api).params.text, /Fracciones/);
  await bot.manejar(cb(1, "cx:b"));
  await bot.manejar(cb(1, "gp"));
  await bot.manejar(cb(1, "me:1"));
  assert.match(ultimo(api).params.text, /noviembre 2026/);

  await bot.manejar(cb(1, "ok"));
  const final = ultimo(api).params.text;
  assert.match(final, /Plan de noviembre 2026 listo para Lucía/);
  assert.match(final, new RegExp(`http://localhost:3000/a/${alumno.token}`));

  const asignaciones = ctx.almacen.asignacionesDe(alumno.id);
  assert.equal(asignaciones.length, 42, "21 días laborables × 2 fichas (básico)");
  assert.ok(asignaciones.every((a) => ctx.almacen.ficha(a.fichaId).descargada));
});

test("/start muestra las normas de uso antes del menú; /cancelar no", async () => {
  const { api, bot } = await preparar(0);
  await bot.manejar(msg(1, "/start"));
  const enviados = api.llamadas.filter((l) => l.metodo === "sendMessage");
  assert.equal(enviados.length, 2);
  assert.match(enviados[0].params.text, /Normas de uso/);
  assert.match(enviados[0].params.text, /muchos planes seguidos/);
  assert.deepEqual(datosBotones(enviados[1]), ["na", "ma", "ay"]);

  await bot.manejar(msg(1, "/cancelar"));
  assert.equal(api.llamadas.filter((l) => l.metodo === "sendMessage").length, 3);
  assert.match(ultimo(api).params.text, /Cancelado/);

  await bot.manejar(cb(1, "ay"));
  assert.ok(datosBotones(ultimo(api)).includes("nu"));
  await bot.manejar(cb(1, "nu"));
  assert.match(ultimo(api).params.text, /Normas de uso/);
});

test("los temas cambian al cambiar de asignatura", async () => {
  const { ctx, api, bot } = await preparar(0);
  const a = await ctx.almacen.crearAlumno(1, "Pau", 3);
  await bot.manejar(cb(1, `al:${a.id}`));
  await bot.manejar(cb(1, "as:mat"));
  const t1 = ultimo(api).params.text;
  await bot.manejar(cb(1, "as:len"));
  assert.notEqual(ultimo(api).params.text, t1);
});

test("un usuario no puede usar alumnos de otro", async () => {
  const { ctx, api, bot } = await preparar(0);
  const ajeno = await ctx.almacen.crearAlumno(1, "Ajeno", 2);
  await bot.manejar(cb(2, `al:${ajeno.id}`));
  assert.match(ultimo(api).params.text, /Todavía no tienes alumnos/);
  await bot.manejar(cb(2, "vp"));
  assert.ok(!JSON.stringify(api.llamadas).includes("Ajeno"));
});

test("eliminar alumno pide confirmación y borra sus planes y su enlace", async () => {
  const { ctx, api, bot } = await preparar();
  const a = await ctx.almacen.crearAlumno(1, "Lucía", 4);
  const otro = await ctx.almacen.crearAlumno(1, "Pau", 3);
  await bot.manejar(cb(1, `al:${a.id}`));
  for (const d of ["nd", "as:mat", "te:3", "cx:b", "gp", "me:1", "ok"]) await bot.manejar(cb(1, d));
  assert.ok(ctx.almacen.asignacionesDe(a.id).length > 0);

  await bot.manejar(cb(1, "ea"));
  assert.match(ultimo(api).params.text, /¿Eliminar a Lucía/);
  assert.deepEqual(datosBotones(ultimo(api)), [`ec:${a.id}`, "v:al"]);
  assert.ok(ctx.almacen.alumno(a.id), "sin confirmar no se borra");

  await bot.manejar(cb(1, `ec:${a.id}`));
  assert.match(ultimo(api).params.text, /Alumno eliminado: Lucía/);
  assert.equal(ctx.almacen.alumno(a.id), undefined);
  assert.equal(ctx.almacen.alumnoPorToken(a.token), undefined);
  assert.equal(ctx.almacen.asignacionesDe(a.id).length, 0);
  assert.equal(ctx.almacen.planesDe(a.id).length, 0);
  assert.ok(ctx.almacen.alumno(otro.id), "los demás alumnos siguen");
});

test("una confirmación de borrado antigua o ajena no elimina a nadie", async () => {
  const { ctx, bot } = await preparar(0);
  const a = await ctx.almacen.crearAlumno(1, "Lucía", 4);
  const b = await ctx.almacen.crearAlumno(1, "Pau", 3);
  await bot.manejar(cb(1, `al:${b.id}`));
  await bot.manejar(cb(1, `ec:${a.id}`)); // botón viejo de otro alumno
  await bot.manejar(cb(2, `ec:${a.id}`)); // otro usuario
  assert.ok(ctx.almacen.alumno(a.id));
  assert.ok(ctx.almacen.alumno(b.id));
});

test("Ver plan lista las fichas por día con sus enlaces", async () => {
  const { ctx, api, bot } = await preparar();
  const a = await ctx.almacen.crearAlumno(1, "Lucía", 4);
  await bot.manejar(cb(1, `al:${a.id}`));
  for (const d of ["nd", "as:mat", "te:3", "cx:b", "gp", "me:1", "ok", "vp"]) await bot.manejar(cb(1, d));
  const texto = api.llamadas.filter((l) => l.metodo === "sendMessage").map((l) => l.params.text).join("\n");
  assert.match(texto, /2026-11-02\nMatemáticas · Ficha \d+\nhttps:\/\/web\.es\/ficha-\d+\.pdf/);
});

test("urlParaEnlaces convierte localhost e IPs en un dominio que Telegram acepta", () => {
  assert.equal(urlParaEnlaces("http://localhost:3000"), "http://127.0.0.1.nip.io:3000");
  assert.equal(urlParaEnlaces("http://192.168.1.20:3000"), "http://192.168.1.20.nip.io:3000");
  assert.equal(urlParaEnlaces("https://fichas.ejemplo.es"), "https://fichas.ejemplo.es");
  assert.equal(urlParaEnlaces("no es una url"), "no es una url");
});

test("trocear respeta el límite de longitud", () => {
  const partes = trocear(Array.from({ length: 200 }, (_, i) => `línea ${i}`).join("\n"), 100);
  assert.ok(partes.every((p) => p.length <= 100));
  assert.equal(partes.join("\n").split("\n").length, 200);
});

test("la ficha del alumno se abre con un botón de enlace directo", async () => {
  const { ctx, api, bot } = await preparar(0);
  const a = await ctx.almacen.crearAlumno(1, "Lucía", 4);
  await bot.manejar(cb(1, `al:${a.id}`));
  const botones = ultimo(api).params.reply_markup.inline_keyboard.flat();
  const web = botones.find((b) => b.url);
  assert.equal(web.text, "Abrir ficha del alumno");
  assert.equal(web.url, `http://localhost:3000/a/${a.token}`);
});

test("si Telegram rechaza el enlace, se envía como texto con el botón 'lw'", async () => {
  const { ctx, bot } = await preparar(0);
  const llamadas = [];
  const api = { async llamar(metodo, params) {
    llamadas.push({ metodo, params });
    const conUrl = (params.reply_markup?.inline_keyboard ?? []).flat().some((b) => b.url);
    if (conUrl) throw new Error("Telegram sendMessage: Bad Request: BUTTON_URL_INVALID");
    return {};
  } };
  const botRechazo = new (bot.constructor)(ctx, api, "http://localhost:3000");
  const a = await ctx.almacen.crearAlumno(1, "Lucía", 4);
  await botRechazo.manejar(cb(1, `al:${a.id}`));
  const final = llamadas.filter((l) => l.metodo !== "answerCallbackQuery").at(-1);
  assert.equal(final.metodo, "sendMessage");
  const botones = final.params.reply_markup.inline_keyboard.flat();
  assert.ok(botones.every((b) => !b.url));
  assert.ok(botones.some((b) => b.text === "Abrir ficha del alumno" && b.callback_data === "lw"));
  await botRechazo.manejar(cb(1, "lw"));
  assert.match(llamadas.at(-1).params.text, new RegExp(`/a/${a.token}`));
});
