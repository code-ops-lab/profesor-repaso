import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PREFIJO_CIFRADO, cifrar, descifrar, enmascarar, guardarVariable } from "../dist/entorno.js";
import { comprobarToken, esFormatoToken } from "../dist/telegram.js";

const TOKEN = "1234567890:AAEjemploFalsoNoEsUnTokenRealDePrueba"; // inventado
const carpeta = () => mkdtemp(join(tmpdir(), "profesor-env-"));

test("guardarVariable sustituye la línea y conserva el resto", async () => {
  const ruta = join(await carpeta(), ".env");
  await writeFile(ruta, "# comentario\r\nTELEGRAM_TOKEN=viejo\r\nPUERTO=3000\r\n");
  await guardarVariable(ruta, "TELEGRAM_TOKEN", "nuevo$1");
  assert.equal(await readFile(ruta, "utf8"), "# comentario\r\nTELEGRAM_TOKEN=nuevo$1\r\nPUERTO=3000\r\n");
});

test("guardarVariable añade la línea si no existe", async () => {
  const ruta = join(await carpeta(), ".env");
  await writeFile(ruta, "PUERTO=3000");
  await guardarVariable(ruta, "TELEGRAM_TOKEN", "abc");
  assert.equal(await readFile(ruta, "utf8"), "PUERTO=3000\nTELEGRAM_TOKEN=abc\n");
});

test("guardarVariable crea el .env a partir de .env.example", async () => {
  const dir = await carpeta();
  await writeFile(join(dir, ".env.example"), "# Token\nTELEGRAM_TOKEN=\nPUERTO=3000\n");
  await guardarVariable(join(dir, ".env"), "TELEGRAM_TOKEN", "abc");
  assert.equal(await readFile(join(dir, ".env"), "utf8"), "# Token\nTELEGRAM_TOKEN=abc\nPUERTO=3000\n");
});

test("cifrar y descifrar con Windows (DPAPI)", { skip: process.platform !== "win32" }, async () => {
  const c = await cifrar(TOKEN);
  assert.ok(c.startsWith(PREFIJO_CIFRADO));
  assert.ok(!c.includes(TOKEN), "el valor cifrado no contiene el token");
  assert.equal(await descifrar(c), TOKEN);
  await assert.rejects(descifrar(`${PREFIJO_CIFRADO}AAAAbasura`));
});

test("descifrar deja pasar un token sin cifrar", async () => {
  assert.equal(await descifrar(TOKEN), TOKEN);
});

test("enmascarar muestra solo el principio y el final", () => {
  assert.equal(enmascarar(TOKEN), "1234567890:AAE****ueba");
  assert.equal(enmascarar("corto"), "****");
});

test("formato del token de BotFather", () => {
  assert.ok(esFormatoToken(TOKEN));
  for (const malo of ["", "hola", "123:abc", `${TOKEN} extra`, "abc:AAEjemploFalsoNoEsUnTokenRealDePrueba"]) assert.ok(!esFormatoToken(malo), malo);
});

test("comprobarToken distingue token válido, inválido y sin conexión", async () => {
  const api = (fn) => ({ llamar: fn });
  assert.deepEqual(await comprobarToken(api(async () => ({ username: "mi_bot" }))), { estado: "ok", usuarioBot: "mi_bot" });
  assert.deepEqual(await comprobarToken(api(async () => { throw new Error("Telegram getMe: Unauthorized"); })), { estado: "invalido" });
  assert.deepEqual(await comprobarToken(api(async () => { throw new Error("Telegram getMe: Not Found"); })), { estado: "invalido" });
  assert.equal((await comprobarToken(api(async () => { throw new TypeError("fetch failed"); }))).estado, "sin-conexion");
});
