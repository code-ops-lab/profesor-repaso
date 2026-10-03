// Servidor local: web, API, visor de PDF y arranque del bot.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isSea } from "node:sea";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Asignacion, Respuesta } from "./dominio.js";
import { NOMBRE_COMPLEJIDAD } from "./config.js";
import { Almacen } from "./almacen.js";
import { cargarCatalogo, nombreAsignatura } from "./catalogo.js";
import { crearProveedor } from "./busqueda.js";
import { redPorDefecto } from "./red.js";
import type { Contexto } from "./servicio.js";
import { Bot, type EstadoPolling, comprobarToken, crearApi, esFormatoToken, iniciarPolling, urlParaEnlaces } from "./telegram.js";
import { PREFIJO_CIFRADO, cifrar, descifrar, enmascarar, guardarVariable, puedeCifrar } from "./entorno.js";
import { esBooleano, esFecha, esIdFicha, esMes, esToken } from "./validacion.js";

// En el ejecutable (npm run exe), datos/, public/ y .env están en la carpeta del .exe.
const EMPAQUETADO = isSea();
const RAIZ = EMPAQUETADO ? dirname(process.execPath) : resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function hoyLocal(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
};

const CSP = "default-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

function json<T>(res: ServerResponse, estado: number, cuerpo: Respuesta<T>): void {
  res.writeHead(estado, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(cuerpo));
}

const error = (res: ServerResponse, estado: number, mensaje: string): void => json(res, estado, { ok: false, error: mensaje });

async function leerCuerpo(req: IncomingMessage, max = 10_000): Promise<unknown> {
  let total = 0;
  const trozos: Buffer[] = [];
  for await (const t of req) {
    total += (t as Buffer).length;
    if (total > max) throw new Error("Cuerpo demasiado grande");
    trozos.push(t as Buffer);
  }
  return JSON.parse(Buffer.concat(trozos).toString("utf8"));
}

// Rechaza peticiones de escritura que vengan de otra web (protección CSRF básica).
function mismoOrigen(req: IncomingMessage): boolean {
  const origen = req.headers.origin;
  if (!origen) return true;
  try {
    return new URL(origen).host === req.headers.host;
  } catch {
    return false;
  }
}

// La configuración del bot solo se acepta desde el propio ordenador: conexión de loopback y
// cabecera Host local (evita que una web externa la use apuntando un dominio a 127.0.0.1).
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]", "127.0.0.1.nip.io"]);
export function esPeticionLocal(req: Pick<IncomingMessage, "headers" | "socket">): boolean {
  const ip = req.socket.remoteAddress ?? "";
  if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") return false;
  try {
    return HOSTS_LOCALES.has(new URL(`http://${req.headers.host ?? ""}`).hostname);
  } catch {
    return false;
  }
}

export type ResultadoConfiguracion = { ok: true; usuarioBot: string } | { ok: false; error: string };

// Primera puesta en marcha: crear el bot con BotFather y pegar su token en la web.
export interface Configuracion {
  pendiente(): boolean; // true mientras no haya un bot válido
  guardarToken(token: string): Promise<ResultadoConfiguracion>;
  abrirBotFather(): void;
}

export interface OpcionesServidor {
  ctx: Contexto;
  estadoTelegram: EstadoPolling;
  dirPublic?: string;
  configuracion?: Configuracion;
}

export function crearServidor({ ctx, estadoTelegram, dirPublic = join(RAIZ, "public"), configuracion }: OpcionesServidor): Server {
  const { almacen, catalogo } = ctx;

  const vistaFicha = (a: Asignacion) => {
    const f = almacen.ficha(a.fichaId);
    return {
      fichaId: a.fichaId,
      fecha: a.fecha,
      titulo: f?.titulo ?? "Ficha",
      asignatura: nombreAsignatura(catalogo, a.asignatura),
      tema: f?.tema ?? "",
      complejidad: f ? NOMBRE_COMPLEJIDAD[f.complejidad] : "",
      urlOriginal: f?.url ?? "",
      descargada: f?.descargada ?? false,
      impresa: a.impresa,
      fechaImpresion: a.fechaImpresion ?? null,
    };
  };

  const servirEstatico = async (res: ServerResponse, nombre: string): Promise<void> => {
    const ext = nombre.slice(nombre.lastIndexOf("."));
    const tipo = TIPOS[ext];
    if (!/^[a-z0-9-]+\.[a-z]+$/.test(nombre) || !tipo) return error(res, 404, "No encontrado");
    try {
      const contenido = await readFile(join(dirPublic, nombre));
      res.writeHead(200, { "Content-Type": tipo, "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
      res.end(contenido);
    } catch {
      error(res, 404, "No encontrado");
    }
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const partes = url.pathname.split("/").filter(Boolean);
      const metodo = req.method ?? "GET";

      if (metodo === "GET" && (partes.length === 0 || (partes[0] === "a" && partes.length === 2))) {
        return await servirEstatico(res, "index.html");
      }

      if (partes[0] === "configurar" && partes.length === 1 && metodo === "GET") {
        if (!esPeticionLocal(req)) return error(res, 403, "La configuración solo se puede hacer desde el ordenador donde está el programa.");
        return await servirEstatico(res, "configurar.html");
      }

      if (partes[0] === "api" && partes[1] === "configurar") {
        if (!esPeticionLocal(req)) return error(res, 403, "La configuración solo se puede hacer desde el ordenador donde está el programa.");
        const pendiente = configuracion?.pendiente() ?? false;
        if (metodo === "GET" && partes.length === 2) {
          return json(res, 200, { ok: true, datos: { pendiente, usuarioBot: estadoTelegram.usuarioBot ?? null } });
        }
        if (metodo !== "POST") return error(res, 404, "Ruta no encontrada");
        if (!mismoOrigen(req)) return error(res, 403, "Origen no permitido");
        if (!configuracion || !pendiente) return error(res, 409, "El bot ya está configurado.");
        if (partes[2] === "botfather" && partes.length === 3) {
          configuracion.abrirBotFather();
          return json(res, 200, { ok: true });
        }
        if (partes.length === 2) {
          let cuerpo: unknown;
          try {
            cuerpo = await leerCuerpo(req, 1_000);
          } catch {
            return error(res, 400, "JSON no válido");
          }
          const token = (cuerpo as Record<string, unknown> | null)?.["token"];
          if (typeof token !== "string") return error(res, 400, "Falta el token");
          const r = await configuracion.guardarToken(token.trim());
          return r.ok ? json(res, 200, { ok: true, datos: { usuarioBot: r.usuarioBot } }) : error(res, 400, r.error);
        }
        return error(res, 404, "Ruta no encontrada");
      }

      if (partes[0] === "api") {
        if (metodo === "GET" && partes[1] === "salud" && partes.length === 2) {
          return json(res, 200, { ok: true, datos: { servidor: true, telegram: { ...estadoTelegram } } });
        }
        if (partes[1] === "alumno" && partes[2] !== undefined) {
          const token = partes[2];
          if (!esToken(token)) return error(res, 400, "Enlace no válido");
          const alumno = almacen.alumnoPorToken(token);
          if (!alumno) return error(res, 404, "Este enlace no existe o se ha regenerado. Pide uno nuevo al bot.");

          if (metodo === "GET" && partes.length === 3) {
            const asignaciones = almacen.asignacionesDe(alumno.id);
            const meses = [...new Set(asignaciones.map((a) => a.fecha.slice(0, 7)))].sort();
            return json(res, 200, {
              ok: true,
              datos: {
                nombre: alumno.nombre,
                grado: alumno.grado,
                hoy: ctx.hoy(),
                meses,
                planes: almacen.planesDe(alumno.id).map((p) => ({
                  mes: p.mes,
                  dificultades: p.dificultades.map((d) => ({
                    asignatura: nombreAsignatura(catalogo, d.asignatura), tema: d.tema, complejidad: NOMBRE_COMPLEJIDAD[d.complejidad],
                  })),
                })),
                progreso: { impresas: asignaciones.filter((a) => a.impresa).length, total: asignaciones.length },
              },
            });
          }

          if (metodo === "GET" && partes[3] === "mes" && partes.length === 5) {
            const mes = partes[4];
            if (!esMes(mes)) return error(res, 400, "Mes no válido. Formato: AAAA-MM");
            const delMes = almacen.asignacionesDe(alumno.id).filter((a) => a.fecha.startsWith(mes)).sort((a, b) => a.fecha.localeCompare(b.fecha));
            const porDia = new Map<string, ReturnType<typeof vistaFicha>[]>();
            for (const a of delMes) porDia.set(a.fecha, [...(porDia.get(a.fecha) ?? []), vistaFicha(a)]);
            return json(res, 200, { ok: true, datos: { mes, dias: [...porDia].map(([fecha, fichas]) => ({ fecha, fichas })) } });
          }

          if (metodo === "POST" && partes[3] === "impresa" && partes.length === 4) {
            if (!mismoOrigen(req)) return error(res, 403, "Origen no permitido");
            let cuerpo: unknown;
            try {
              cuerpo = await leerCuerpo(req);
            } catch {
              return error(res, 400, "JSON no válido");
            }
            const { fichaId, fecha, impresa } = (cuerpo ?? {}) as Record<string, unknown>;
            if (!esIdFicha(fichaId) || !esFecha(fecha) || !esBooleano(impresa)) {
              return error(res, 400, "Datos no válidos: se espera {fichaId, fecha, impresa}");
            }
            const a = await almacen.marcarImpresa(alumno.id, fichaId, fecha, impresa);
            if (!a) return error(res, 404, "Esa ficha no está en el plan de este alumno");
            return json(res, 200, { ok: true, datos: vistaFicha(a) });
          }
        }
        return error(res, 404, "Ruta no encontrada");
      }

      if (metodo === "GET" && partes[0] === "pdf" && partes.length === 3) {
        const [, token, fichaId] = partes;
        if (!esToken(token) || !esIdFicha(fichaId)) return error(res, 400, "Petición no válida");
        const alumno = almacen.alumnoPorToken(token);
        if (!alumno || !almacen.asignacionesDe(alumno.id).some((a) => a.fichaId === fichaId)) return error(res, 404, "PDF no encontrado");
        const ruta = join(almacen.rutaPdfs, `${fichaId}.pdf`); // id validado: sin rutas del usuario
        try {
          const info = await stat(ruta);
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Length": info.size,
            "Content-Disposition": `inline; filename="${fichaId}.pdf"`,
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN",
            "Cache-Control": "private, max-age=86400",
          });
          createReadStream(ruta).pipe(res);
          return;
        } catch {
          return error(res, 404, "El PDF no está descargado");
        }
      }

      if (metodo === "GET" && partes.length === 1 && partes[0] !== undefined) return await servirEstatico(res, partes[0]);
      return error(res, 404, "No encontrado");
    } catch (e) {
      console.error(e);
      if (!res.headersSent) error(res, 500, "Error interno");
      else res.end();
    }
  });
}

// ---------- Arranque ----------

async function arrancar(): Promise<void> {
  const runtime = join(RAIZ, ".runtime");
  await mkdir(runtime, { recursive: true });
  const log = (m: string) => {
    const linea = `${new Date().toISOString()} ${m}\n`;
    process.stdout.write(linea);
    appendFile(join(runtime, "servidor.log"), linea).catch(() => undefined);
  };

  const rutaEnv = join(RAIZ, ".env");
  const puerto = Number(process.env["PUERTO"] ?? 3000);
  const host = process.env["HOST"] ?? "0.0.0.0";
  const urlBase = (process.env["URL_BASE"] ?? `http://localhost:${puerto}`).replace(/\/$/, "");

  const fuentes = JSON.parse(await readFile(join(RAIZ, "datos", "fuentes.json"), "utf8")) as { dominios?: unknown };
  const dominios = Array.isArray(fuentes.dominios) ? fuentes.dominios.filter((d): d is string => typeof d === "string" && /^[a-z0-9.-]+$/i.test(d)) : [];

  const ctx: Contexto = {
    almacen: await Almacen.abrir(join(RAIZ, "datos")),
    catalogo: cargarCatalogo(join(RAIZ, "datos", "catalogo.json")),
    proveedor: crearProveedor(process.env["PROVEEDOR_BUSQUEDA"] ?? "duckduckgo", redPorDefecto.fetch),
    red: redPorDefecto,
    dominios,
    hoy: () => hoyLocal(),
  };

  const estadoTelegram: EstadoPolling = { conectado: false };
  const control = new AbortController();
  const urlEnlaces = urlParaEnlaces(urlBase);
  let botActivo = false;

  const conectarBot = (token: string): void => {
    botActivo = true;
    delete estadoTelegram.ultimoError;
    const api = crearApi(token, redPorDefecto.fetch);
    if (urlEnlaces !== urlBase) log(`Enlaces del bot: ${urlEnlaces}`);
    const bot = new Bot(ctx, api, urlEnlaces);
    log(`Conectando con Telegram (long polling). Token ${enmascarar(token)}`);
    void iniciarPolling(bot, api, join(runtime, "telegram-offset.json"), estadoTelegram, control.signal, (usuario) => {
      log(`Bot conectado: @${usuario} (https://web.telegram.org/k/#@${usuario})`);
      if (EMPAQUETADO && process.env["ABRIR_TELEGRAM"] !== "no") abrirChat(usuario);
    });
  };

  const configuracion: Configuracion = {
    pendiente: () => !botActivo,
    abrirBotFather: () => abrirChat("BotFather"),
    async guardarToken(token) {
      if (!esFormatoToken(token)) {
        return { ok: false, error: "Eso no parece un token. Copia el texto completo que te dio BotFather, del tipo 123456789:AAH…" };
      }
      const r = await comprobarToken(crearApi(token, redPorDefecto.fetch));
      if (r.estado === "invalido") return { ok: false, error: "Telegram dice que ese token no es válido. Cópialo otra vez del último mensaje de BotFather." };
      if (r.estado === "sin-conexion") return { ok: false, error: "No se pudo conectar con Telegram. Comprueba la conexión a internet y vuelve a intentarlo." };
      await guardarVariable(rutaEnv, "TELEGRAM_TOKEN", await cifrarSiSePuede(token));
      log(`Bot configurado desde la web: @${r.usuarioBot}`);
      conectarBot(token);
      return { ok: true, usuarioBot: r.usuarioBot };
    },
  };

  // Lo cifra con Windows; si falla, lo guarda sin cifrar antes que perderlo.
  const cifrarSiSePuede = async (token: string): Promise<string> => {
    if (!puedeCifrar()) return token;
    try {
      return await cifrar(token);
    } catch (e) {
      log(`Aviso: no se pudo cifrar el token (${(e as Error).message}). Se guarda sin cifrar.`);
      return token;
    }
  };

  const servidor = crearServidor({ ctx, estadoTelegram, configuracion });
  await new Promise<void>((r) => servidor.listen(puerto, host, r));
  log(`Web en ${urlBase} (escuchando en ${host}:${puerto})`);
  await writeFile(join(runtime, "servidor.pid"), String(process.pid));

  const parar = () => {
    log("Parando…");
    control.abort();
    servidor.close();
    void ctx.almacen.vaciarCola().finally(() => process.exit(0));
  };
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);

  const token = await leerToken(rutaEnv, log, cifrarSiSePuede);
  const comprobacion = token ? await comprobarToken(crearApi(token, redPorDefecto.fetch)) : undefined;
  if (token && comprobacion?.estado !== "invalido") {
    // Sin conexión también se conecta: el polling reintenta solo hasta que vuelva internet.
    conectarBot(token);
    return;
  }

  const urlConfigurar = `http://localhost:${puerto}/configurar`;
  estadoTelegram.ultimoError = `Falta configurar el bot: abre ${urlConfigurar}`;
  log(token ? "El token guardado no es válido (¿se revocó en BotFather?)." : "Todavía no hay ningún bot configurado.");
  log(`Configúralo en ${urlConfigurar}. La web de los alumnos funciona mientras tanto.`);
  if (EMPAQUETADO) abrirEnNavegador(urlConfigurar);
}

// Lee TELEGRAM_TOKEN: si está cifrado lo descifra; si está en claro y se puede, lo cifra en el .env.
async function leerToken(rutaEnv: string, log: (m: string) => void, cifrarSiSePuede: (t: string) => Promise<string>): Promise<string> {
  const valor = (process.env["TELEGRAM_TOKEN"] ?? "").trim();
  if (!valor) return "";
  if (valor.startsWith(PREFIJO_CIFRADO)) {
    try {
      return await descifrar(valor);
    } catch {
      log("No se pudo descifrar el token: está cifrado con otro usuario de Windows o en otro ordenador. Hay que configurarlo de nuevo.");
      return "";
    }
  }
  if (puedeCifrar()) {
    const cifrado = await cifrarSiSePuede(valor);
    if (cifrado !== valor) {
      await guardarVariable(rutaEnv, "TELEGRAM_TOKEN", cifrado);
      log("Token cifrado en .env con tu usuario de Windows.");
    }
  }
  return valor;
}

function abrirEnNavegador(url: string): void {
  if (!/^http:\/\/localhost:\d+\/configurar$/.test(url)) return;
  if (process.platform === "win32") abrir("cmd", ["/c", "start", "", url]);
  else abrir(process.platform === "darwin" ? "open" : "xdg-open", [url]);
}

// Abre el chat del bot. En Windows, si la aplicación de Telegram está instalada (protocolo tg://)
// se abre en ella; si no, en Telegram Web, porque la página t.me solo sabe lanzar la aplicación.
function abrirChat(usuario: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(usuario)) return;
  if (process.platform !== "win32") {
    abrir(process.platform === "darwin" ? "open" : "xdg-open", [`https://t.me/${usuario}`]);
    return;
  }
  execFile("reg", ["query", "HKCR\\tg", "/ve"], { windowsHide: true }, (sinAplicacion) => {
    const url = sinAplicacion ? `https://web.telegram.org/k/#@${usuario}` : `tg://resolve?domain=${usuario}`;
    abrir("cmd", ["/c", "start", "", url]);
  });
}

function abrir(orden: string, args: string[]): void {
  try {
    const hijo = spawn(orden, args, { detached: true, stdio: "ignore", windowsHide: true });
    hijo.on("error", () => undefined);
    hijo.unref();
  } catch {
    // Sin navegador disponible: el enlace ya está escrito en la consola.
  }
}

if (EMPAQUETADO) {
  // Abierto con doble clic: lee el .env de su carpeta y, si falla, deja el error a la vista.
  try {
    process.loadEnvFile(join(RAIZ, ".env"));
  } catch {
    // Sin .env: primera vez. El programa abre la página de configuración y lo crea.
  }
  arrancar().catch((e: unknown) => {
    console.error("No se pudo arrancar:", e instanceof Error ? e.message : e);
    console.error("Pulsa Intro para cerrar.");
    process.stdin.once("data", () => process.exit(1));
  });
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  arrancar().catch((e: unknown) => {
    console.error("No se pudo arrancar:", e);
    process.exit(1);
  });
}
