// Bot de Telegram guiado por botones. Se conecta por long polling (getUpdates).
import { readFile } from "node:fs/promises";
import type { Alumno, Complejidad, Sesion } from "./dominio.js";
import { DIAS_POR_DEFECTO, LIMITES, NOMBRE_COMPLEJIDAD, TIEMPOS } from "./config.js";
import { asignaturasDeGrado, nombreAsignatura, temasDe } from "./catalogo.js";
import { escribirJsonAtomico } from "./almacen.js";
import { type Contexto, generarPlan } from "./servicio.js";
import { esGrado, validarNombre } from "./validacion.js";
import type { Fetch } from "./red.js";

// ---------- API de Telegram ----------

export interface TelegramApi {
  llamar(metodo: string, params: Record<string, unknown>): Promise<unknown>;
}

export function crearApi(token: string, fetchFn: Fetch): TelegramApi {
  return {
    async llamar(metodo, params) {
      const r = await fetchFn(`https://api.telegram.org/bot${token}/${metodo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout((TIEMPOS.pollingSegundos + 10) * 1000),
      });
      const json = (await r.json()) as { ok?: boolean; result?: unknown; description?: string };
      if (!json.ok) throw new Error(`Telegram ${metodo}: ${json.description ?? r.status}`);
      return json.result;
    },
  };
}

// Formato de los tokens que da BotFather: "<id numérico>:<clave>".
export const esFormatoToken = (t: string): boolean => /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(t);

export type ResultadoToken = { estado: "ok"; usuarioBot: string } | { estado: "invalido" } | { estado: "sin-conexion"; error: string };

// Pregunta a Telegram si el token es de un bot real. Distingue un token malo de no tener internet.
export async function comprobarToken(api: TelegramApi): Promise<ResultadoToken> {
  try {
    const yo = (await api.llamar("getMe", {})) as { username?: string };
    return yo.username ? { estado: "ok", usuarioBot: yo.username } : { estado: "invalido" };
  } catch (e) {
    const mensaje = (e as Error).message;
    if (/Unauthorized|Not Found/i.test(mensaje)) return { estado: "invalido" };
    return { estado: "sin-conexion", error: mensaje };
  }
}

// ---------- Teclados ----------

// Un botón ejecuta una acción del bot (callback_data) o abre una dirección en el navegador (url).
export type Boton = { text: string; callback_data: string } | { text: string; url: string };
export type Teclado = Boton[][];

// callback_data admite como máximo 64 bytes.
export function boton(text: string, data: string): Boton {
  if (Buffer.byteLength(data, "utf8") > 64) throw new Error(`callback_data demasiado largo: ${data}`);
  return { text, callback_data: data };
}

export function botonUrl(text: string, url: string): Boton {
  return { text, url };
}

// Cambia cada botón de enlace por el botón "lw", que envía el enlace como texto.
// Se usa si Telegram rechaza la dirección (puede pasar con localhost o IPs locales).
export function sinBotonesUrl(t: Teclado): Teclado {
  return t.map((fila) => fila.map((b) => ("url" in b ? boton(b.text, "lw") : b)));
}

// Telegram no acepta botones ni enlaces hacia "localhost" o una IP: exige un nombre de dominio.
// nip.io es un DNS público que resuelve "<ip>.nip.io" a esa misma IP, así que la dirección
// sigue apuntando a este ordenador pero Telegram la muestra como enlace que se abre con un toque.
export function urlParaEnlaces(urlBase: string): string {
  let u: URL;
  try {
    u = new URL(urlBase);
  } catch {
    return urlBase;
  }
  const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return urlBase;
  u.hostname = `${host}.nip.io`;
  return u.toString().replace(/\/$/, "");
}

const tieneUrl = (t: Teclado): boolean => t.some((fila) => fila.some((b) => "url" in b));

function enFilas(botones: Boton[], porFila: number): Teclado {
  const filas: Teclado = [];
  for (let i = 0; i < botones.length; i += porFila) filas.push(botones.slice(i, i + porFila));
  return filas;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
const CX: Record<string, Complejidad> = { b: "basico", m: "medio", a: "avanzado" };

export function mesRelativo(hoy: string, desplazamiento: number): string {
  const [a = 2000, m = 1] = hoy.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + desplazamiento, 1));
  return d.toISOString().slice(0, 7);
}

export function nombreMes(mes: string): string {
  const [a, m = 1] = mes.split("-").map(Number);
  return `${MESES[m - 1] ?? "?"} ${a}`;
}

// ---------- Pantallas ----------

export interface Pantalla {
  texto: string;
  teclado: Teclado;
}

type Update =
  | { tipo: "mensaje"; chatId: number; texto: string }
  | { tipo: "callback"; id: string; chatId: number; messageId: number; data: string };

export function parsearUpdate(u: unknown): Update | null {
  if (typeof u !== "object" || u === null) return null;
  const x = u as Record<string, unknown>;
  const msg = x["message"] as Record<string, unknown> | undefined;
  if (msg && typeof msg === "object") {
    const chat = msg["chat"] as Record<string, unknown> | undefined;
    if (chat?.["type"] !== "private") return null;
    const chatId = chat["id"];
    const texto = msg["text"];
    if (typeof chatId === "number" && typeof texto === "string") return { tipo: "mensaje", chatId, texto };
    return null;
  }
  const cb = x["callback_query"] as Record<string, unknown> | undefined;
  if (cb && typeof cb === "object") {
    const m = cb["message"] as Record<string, unknown> | undefined;
    const chat = m?.["chat"] as Record<string, unknown> | undefined;
    const id = cb["id"], data = cb["data"], chatId = chat?.["id"], messageId = m?.["message_id"];
    if (typeof id === "string" && typeof data === "string" && typeof chatId === "number" && typeof messageId === "number") {
      return { tipo: "callback", id, chatId, messageId, data };
    }
  }
  return null;
}

export class Bot {
  constructor(
    private readonly ctx: Contexto,
    private readonly api: TelegramApi,
    private readonly urlBase: string,
  ) {}

  async manejar(u: unknown): Promise<void> {
    const up = parsearUpdate(u);
    if (!up) return;
    try {
      if (up.tipo === "mensaje") await this.mensaje(up.chatId, up.texto);
      else {
        await this.api.llamar("answerCallbackQuery", { callback_query_id: up.id }).catch(() => undefined);
        await this.callback(up.chatId, up.messageId, up.data);
      }
    } catch (e) {
      console.error("Error del bot:", e);
      await this.enviar(up.chatId, { texto: "Algo ha fallado. Escribe /start para empezar de nuevo.", teclado: [] }).catch(() => undefined);
    }
  }

  // ---- Mensajes de texto ----
  private async mensaje(chatId: number, texto: string): Promise<void> {
    const s = this.ctx.almacen.sesion(chatId);
    const t = texto.trim();
    if (t === "/start" || t === "/cancelar") {
      await this.reiniciar(s);
      if (t === "/start") await this.enviar(chatId, { texto: textoNormas(), teclado: [] });
      await this.enviar(chatId, this.menuPrincipal(t === "/cancelar"));
      return;
    }
    if (t === "/ayuda") {
      await this.enviar(chatId, this.ayuda());
      return;
    }
    if (s.paso === "nombre") {
      const nombre = validarNombre(t);
      if (!nombre) {
        await this.enviar(chatId, { texto: `Escribe un nombre de 1 a ${LIMITES.nombreAlumno} letras.`, teclado: [[boton("Volver", "v:m")]] });
        return;
      }
      s.nombre = nombre;
      s.paso = "ninguno";
      await this.ctx.almacen.guardarSesion(s);
      await this.enviar(chatId, this.pedirGrado(nombre));
      return;
    }
    await this.enviar(chatId, this.menuPrincipal(false));
  }

  // ---- Botones ----
  private async callback(chatId: number, messageId: number, data: string): Promise<void> {
    const s = this.ctx.almacen.sesion(chatId);
    const [accion = "", valor = ""] = data.split(":");
    const editar = (p: Pantalla) => this.editar(chatId, messageId, p);
    const alumno = this.alumnoActual(s);

    switch (accion) {
      case "m":
      case "v":
        if (valor === "al" && alumno) return editar(this.menuAlumno(alumno, s));
        if (valor === "as" && alumno) return editar(this.listaAsignaturas(alumno));
        if (valor === "te" && alumno && s.asignatura) return editar(this.listaTemas(alumno, s.asignatura));
        await this.reiniciar(s);
        return editar(this.menuPrincipal(false));
      case "ay":
        return editar(this.ayuda());
      case "nu":
        return editar({ texto: textoNormas(), teclado: [[boton("Volver", "ay")]] });
      case "na":
        s.paso = "nombre";
        await this.ctx.almacen.guardarSesion(s);
        return editar({ texto: "Escribe el nombre del alumno.", teclado: [[boton("Volver", "v:m")]] });
      case "g": {
        const grado = Number(valor);
        if (!esGrado(grado) || !s.nombre) return editar(this.menuPrincipal(false));
        const nuevo = await this.ctx.almacen.crearAlumno(chatId, s.nombre, grado);
        delete s.nombre;
        await this.seleccionar(s, nuevo.id);
        return editar(this.menuAlumno(nuevo, s, `Alumno creado: ${nuevo.nombre}, ${grado}º.`));
      }
      case "ma":
        return editar(this.listaAlumnos(chatId));
      case "al": {
        const a = this.ctx.almacen.alumno(valor);
        if (!a || a.chatId !== chatId) return editar(this.listaAlumnos(chatId));
        await this.seleccionar(s, a.id);
        return editar(this.menuAlumno(a, s));
      }
    }

    // A partir de aquí hace falta un alumno elegido y propio.
    if (!alumno) return editar(this.listaAlumnos(chatId));

    switch (accion) {
      case "nd":
      case "ao":
        return editar(this.listaAsignaturas(alumno));
      case "as":
        if (!asignaturasDeGrado(this.ctx.catalogo, alumno.grado).includes(valor)) return editar(this.listaAsignaturas(alumno));
        s.asignatura = valor;
        await this.ctx.almacen.guardarSesion(s);
        return editar(this.listaTemas(alumno, valor));
      case "te": {
        const temas = s.asignatura ? temasDe(this.ctx.catalogo, alumno.grado, s.asignatura) : [];
        const tema = temas[Number(valor)];
        if (!tema || !s.asignatura) return editar(this.listaAsignaturas(alumno));
        s.tema = tema;
        await this.ctx.almacen.guardarSesion(s);
        return editar(this.elegirComplejidad(s.asignatura, tema));
      }
      case "cx": {
        const cx = CX[valor];
        if (!cx || !s.asignatura || !s.tema) return editar(this.listaAsignaturas(alumno));
        const d = { asignatura: s.asignatura, tema: s.tema, complejidad: cx };
        if (!s.dificultades.some((x) => x.asignatura === d.asignatura && x.tema === d.tema && x.complejidad === d.complejidad)) {
          s.dificultades.push(d);
        }
        delete s.asignatura;
        delete s.tema;
        await this.ctx.almacen.guardarSesion(s);
        return editar(this.resumenDificultades(s));
      }
      case "gp":
        if (s.dificultades.length === 0) return editar(this.listaAsignaturas(alumno));
        return editar(this.elegirMes());
      case "me": {
        const k = Number(valor);
        if (k !== 0 && k !== 1) return editar(this.elegirMes());
        s.mes = mesRelativo(this.ctx.hoy(), k);
        if (s.dias.length === 0) s.dias = [...DIAS_POR_DEFECTO];
        await this.ctx.almacen.guardarSesion(s);
        return editar(this.elegirDias(s));
      }
      case "d": {
        const dia = Number(valor);
        if (dia >= 1 && dia <= 7) {
          s.dias = s.dias.includes(dia) ? s.dias.filter((x) => x !== dia) : [...s.dias, dia].sort();
          await this.ctx.almacen.guardarSesion(s);
        }
        return editar(this.elegirDias(s));
      }
      case "ok":
        return this.confirmarPlan(chatId, messageId, s, alumno);
      case "vp":
        return this.verPlan(chatId, alumno);
      case "lw":
        return this.enviar(chatId, { texto: this.textoEnlace(alumno), teclado: [[boton("Volver", "v:al")]] });
      case "rt": {
        const token = await this.ctx.almacen.regenerarToken(alumno.id);
        const a = token ? this.ctx.almacen.alumno(alumno.id) : undefined;
        return this.enviar(chatId, {
          texto: a ? `Enlace nuevo. El anterior ya no funciona.\n\n${this.textoEnlace(a)}` : "No se pudo regenerar el enlace.",
          teclado: [[this.botonWeb(a ?? alumno)], [boton("Volver", "v:al")]],
        });
      }
      case "ea":
        return editar(this.confirmarEliminar(alumno));
      case "ec":
        // El id va en el botón: una confirmación antigua no puede borrar a otro alumno elegido después.
        if (valor !== alumno.id) return editar(this.menuAlumno(alumno, s));
        await this.ctx.almacen.eliminarAlumno(alumno.id);
        delete s.alumnoId;
        await this.reiniciar(s);
        return editar(this.listaAlumnos(chatId, `Alumno eliminado: ${alumno.nombre}.`));
      default:
        return editar(this.menuAlumno(alumno, s));
    }
  }

  private async confirmarPlan(chatId: number, messageId: number, s: Sesion, alumno: Alumno): Promise<void> {
    if (!s.mes || s.dificultades.length === 0) return this.editar(chatId, messageId, this.menuAlumno(alumno, s));
    if (s.dias.length === 0) return this.editar(chatId, messageId, this.elegirDias(s, "Elige al menos un día."));
    await this.editar(chatId, messageId, { texto: "Buscando fichas… Puede tardar un par de minutos.", teclado: [] });
    const r = await generarPlan(this.ctx, alumno, s.dificultades, s.mes, s.dias);
    const mes = s.mes;
    s.dificultades = [];
    delete s.mes;
    await this.ctx.almacen.guardarSesion(s);
    const lineas = r.plan
      ? [
          `Plan de ${nombreMes(mes)} listo para ${alumno.nombre}.`,
          `Días con fichas: ${r.diasPlanificados}. Fichas en total: ${r.asignaciones.length}.`,
        ]
      : ["No se ha podido crear el plan."];
    if (r.avisos.length > 0) lineas.push("", ...r.avisos.map((a) => `· ${a}`));
    if (r.plan) lineas.push("", this.textoEnlace(alumno));
    return this.editar(chatId, messageId, {
      texto: lineas.join("\n"),
      teclado: r.plan
        ? [[this.botonWeb(alumno)], [boton("Ver plan", "vp"), boton("Menú del alumno", "v:al")]]
        : [[boton("Ver plan", "vp"), boton("Menú del alumno", "v:al")]],
    });
  }

  private async verPlan(chatId: number, alumno: Alumno): Promise<void> {
    const hoy = this.ctx.hoy();
    const lista = this.ctx.almacen.asignacionesDe(alumno.id)
      .filter((a) => a.fecha >= hoy)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (lista.length === 0) {
      return this.enviar(chatId, { texto: "No hay fichas planificadas desde hoy.", teclado: [[boton("Volver", "v:al")]] });
    }
    const bloques: string[] = [];
    let fechaActual = "";
    for (const a of lista) {
      const f = this.ctx.almacen.ficha(a.fichaId);
      if (!f) continue;
      if (a.fecha !== fechaActual) {
        fechaActual = a.fecha;
        bloques.push(`\n${a.fecha}`);
      }
      const marca = a.impresa ? "🖨️ " : "";
      bloques.push(`${marca}${nombreAsignatura(this.ctx.catalogo, a.asignatura)} · ${f.titulo}\n${f.url}`);
    }
    const mensajes = trocear(`Plan de ${alumno.nombre}\n${bloques.join("\n")}`, LIMITES.mensajeTelegram);
    for (let i = 0; i < mensajes.length; i++) {
      const ultimo = i === mensajes.length - 1;
      await this.enviar(chatId, { texto: mensajes[i] ?? "", teclado: ultimo ? [[boton("Volver", "v:al")]] : [] });
    }
  }

  // ---- Construcción de pantallas ----
  menuPrincipal(cancelado: boolean): Pantalla {
    return {
      texto: `${cancelado ? "Cancelado.\n\n" : ""}Hola. Soy Profesor de repaso: busco fichas PDF para practicar y preparo un plan de impresión por días.`,
      teclado: [[boton("Nuevo alumno", "na"), boton("Mis alumnos", "ma")], [boton("Ayuda", "ay")]],
    };
  }

  ayuda(): Pantalla {
    return {
      texto: [
        "Cómo funciona:",
        "1. Crea un alumno con su nombre y grado.",
        "2. Elige asignatura, tema y complejidad de lo que le cuesta. Puedes añadir varias.",
        "3. Genera el plan del mes y elige qué días.",
        "4. Abre el enlace de la web para ver e imprimir las fichas de cada día.",
        "",
        "/start vuelve al inicio. /cancelar sale de cualquier paso.",
      ].join("\n"),
      teclado: [[boton("Normas de uso", "nu")], [boton("Volver", "v:m")]],
    };
  }

  pedirGrado(nombre: string): Pantalla {
    return {
      texto: `¿En qué grado está ${nombre}?`,
      teclado: [...enFilas([1, 2, 3, 4, 5, 6].map((g) => boton(`${g}º`, `g:${g}`)), 3), [boton("Volver", "v:m")]],
    };
  }

  listaAlumnos(chatId: number, aviso?: string): Pantalla {
    const alumnos = this.ctx.almacen.alumnosDe(chatId);
    const antes = aviso ? `${aviso}\n\n` : "";
    if (alumnos.length === 0) {
      return { texto: `${antes}Todavía no tienes alumnos.`, teclado: [[boton("Nuevo alumno", "na")], [boton("Volver", "v:m")]] };
    }
    return {
      texto: `${antes}Elige un alumno.`,
      teclado: [...alumnos.map((a) => [boton(`${a.nombre} (${a.grado}º)`, `al:${a.id}`)]), [boton("Volver", "v:m")]],
    };
  }

  menuAlumno(a: Alumno, s: Sesion, aviso?: string): Pantalla {
    const pendientes = s.dificultades.length > 0 ? `\nDificultades sin planificar: ${s.dificultades.length}.` : "";
    const filas: Teclado = [[this.botonWeb(a)], [boton("Nueva dificultad", "nd"), boton("Ver plan", "vp")]];
    if (s.dificultades.length > 0) filas.push([boton("Generar plan", "gp")]);
    filas.push([boton("Regenerar enlace", "rt"), boton("Eliminar alumno", "ea")], [boton("Volver", "v:m")]);
    return { texto: `${aviso ? `${aviso}\n\n` : ""}${a.nombre} · ${a.grado}º${pendientes}`, teclado: filas };
  }

  confirmarEliminar(a: Alumno): Pantalla {
    const fichas = this.ctx.almacen.asignacionesDe(a.id).length;
    return {
      texto: `¿Eliminar a ${a.nombre} (${a.grado}º)?\nSe borrarán sus planes (${fichas} fichas asignadas) y su enlace web dejará de funcionar. No se puede deshacer.`,
      teclado: [[boton("Sí, eliminar", `ec:${a.id}`), boton("Cancelar", "v:al")]],
    };
  }

  listaAsignaturas(a: Alumno): Pantalla {
    const cods = asignaturasDeGrado(this.ctx.catalogo, a.grado);
    return {
      texto: "¿En qué asignatura tiene dificultad?",
      teclado: [...enFilas(cods.map((c) => boton(nombreAsignatura(this.ctx.catalogo, c), `as:${c}`)), 2), [boton("Volver", "v:al")]],
    };
  }

  listaTemas(a: Alumno, asignatura: string): Pantalla {
    const temas = temasDe(this.ctx.catalogo, a.grado, asignatura);
    return {
      texto: `${nombreAsignatura(this.ctx.catalogo, asignatura)}: ¿qué tema?`,
      teclado: [...temas.map((t, i) => [boton(t, `te:${i}`)]), [boton("Volver", "v:as")]],
    };
  }

  elegirComplejidad(asignatura: string, tema: string): Pantalla {
    return {
      texto: `${nombreAsignatura(this.ctx.catalogo, asignatura)} · ${tema}\n¿Qué complejidad?`,
      teclado: [
        [boton(NOMBRE_COMPLEJIDAD.basico, "cx:b"), boton(NOMBRE_COMPLEJIDAD.medio, "cx:m"), boton(NOMBRE_COMPLEJIDAD.avanzado, "cx:a")],
        [boton("Volver", "v:te")],
      ],
    };
  }

  resumenDificultades(s: Sesion): Pantalla {
    const lineas = s.dificultades.map((d) => `· ${nombreAsignatura(this.ctx.catalogo, d.asignatura)} · ${d.tema} · ${NOMBRE_COMPLEJIDAD[d.complejidad]}`);
    return {
      texto: `Dificultades para el plan:\n${lineas.join("\n")}`,
      teclado: [[boton("Añadir otra", "ao"), boton("Generar plan", "gp")], [boton("Volver", "v:al")]],
    };
  }

  elegirMes(): Pantalla {
    const hoy = this.ctx.hoy();
    return {
      texto: "¿Para qué mes? El mes actual se planifica desde hoy.",
      teclado: [[boton(nombreMes(mesRelativo(hoy, 0)), "me:0"), boton(nombreMes(mesRelativo(hoy, 1)), "me:1")], [boton("Volver", "v:al")]],
    };
  }

  elegirDias(s: Sesion, aviso?: string): Pantalla {
    const fila = DIAS.map((n, i) => boton(s.dias.includes(i + 1) ? `✓ ${n}` : n, `d:${i + 1}`));
    return {
      texto: `${aviso ? `${aviso}\n\n` : ""}${s.mes ? nombreMes(s.mes) : ""}: marca los días en que se imprimen fichas.`,
      teclado: [fila.slice(0, 4), fila.slice(4), [boton("Generar plan", "ok")], [boton("Volver", "v:al")]],
    };
  }

  urlWeb(a: Alumno): string {
    return `${this.urlBase}/a/${a.token}`;
  }

  // Abre la ficha del alumno en el navegador con un toque.
  botonWeb(a: Alumno): Boton {
    return botonUrl("Abrir ficha del alumno", this.urlWeb(a));
  }

  textoEnlace(a: Alumno): string {
    return `Web de ${a.nombre}:\n${this.urlWeb(a)}`;
  }

  // ---- Utilidades ----
  private alumnoActual(s: Sesion): Alumno | undefined {
    const a = s.alumnoId ? this.ctx.almacen.alumno(s.alumnoId) : undefined;
    return a && a.chatId === s.chatId ? a : undefined;
  }

  private async seleccionar(s: Sesion, alumnoId: string): Promise<void> {
    if (s.alumnoId !== alumnoId) s.dificultades = [];
    s.alumnoId = alumnoId;
    s.paso = "ninguno";
    await this.ctx.almacen.guardarSesion(s);
  }

  private async reiniciar(s: Sesion): Promise<void> {
    s.paso = "ninguno";
    s.dificultades = [];
    s.dias = [...DIAS_POR_DEFECTO];
    delete s.nombre;
    delete s.asignatura;
    delete s.tema;
    delete s.mes;
    await this.ctx.almacen.guardarSesion(s);
  }

  private async enviar(chatId: number, p: Pantalla): Promise<void> {
    try {
      await this.enviarTal(chatId, p);
    } catch (e) {
      if (!tieneUrl(p.teclado)) throw e;
      console.error("Telegram rechazó el botón de enlace; se envía como texto:", (e as Error).message);
      await this.enviarTal(chatId, { ...p, teclado: sinBotonesUrl(p.teclado) });
    }
  }

  private async enviarTal(chatId: number, p: Pantalla): Promise<void> {
    await this.api.llamar("sendMessage", {
      chat_id: chatId, text: p.texto, link_preview_options: { is_disabled: true },
      ...(p.teclado.length > 0 ? { reply_markup: { inline_keyboard: p.teclado } } : {}),
    });
  }

  private async editar(chatId: number, messageId: number, p: Pantalla): Promise<void> {
    try {
      await this.api.llamar("editMessageText", {
        chat_id: chatId, message_id: messageId, text: p.texto, link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: p.teclado },
      });
    } catch (e) {
      if (String((e as Error).message).includes("not modified")) return;
      await this.enviar(chatId, p);
    }
  }
}

// Se muestran al escribir /start y desde Ayuda. El buscador gratuito bloquea si recibe muchas búsquedas seguidas.
export function textoNormas(): string {
  return [
    "📋 Normas de uso",
    "",
    "Las fichas se buscan en internet con un buscador gratuito. Si recibe muchas búsquedas seguidas, las bloquea durante un rato y el bot no encontrará fichas.",
    "",
    "1. No crees muchos planes seguidos. Genera un plan, espera unos minutos y luego el siguiente.",
    "2. Añade pocas dificultades por plan (1 o 2). Cada dificultad nueva es una búsqueda.",
    "3. Si el bot dice «El buscador no ha respondido», espera al menos media hora antes de volver a intentarlo. Insistir alarga el bloqueo.",
    "4. Los temas que ya se buscaron se guardan 30 días: repetirlos, aunque sea para otro alumno del mismo grado, no gasta búsquedas.",
    "5. El bot solo responde mientras el ordenador donde está instalado esté encendido con el programa abierto.",
  ].join("\n");
}

export function trocear(texto: string, max: number): string[] {
  const salida: string[] = [];
  let actual = "";
  for (const linea of texto.split("\n")) {
    if (actual.length + linea.length + 1 > max && actual.length > 0) {
      salida.push(actual);
      actual = "";
    }
    actual += (actual ? "\n" : "") + linea;
  }
  if (actual) salida.push(actual);
  return salida;
}

// ---------- Long polling ----------

export interface EstadoPolling {
  conectado: boolean;
  ultimoError?: string;
  usuarioBot?: string;
}

export async function iniciarPolling(
  bot: Bot, api: TelegramApi, rutaOffset: string, estado: EstadoPolling, senal: AbortSignal,
  alConectar?: (usuarioBot: string) => void,
): Promise<void> {
  let offset = await leerOffset(rutaOffset);
  try {
    const yo = (await api.llamar("getMe", {})) as { username?: string };
    estado.usuarioBot = yo.username;
    if (yo.username) alConectar?.(yo.username);
  } catch (e) {
    estado.ultimoError = (e as Error).message;
  }
  while (!senal.aborted) {
    try {
      const updates = (await api.llamar("getUpdates", {
        offset, timeout: TIEMPOS.pollingSegundos, allowed_updates: ["message", "callback_query"],
      })) as { update_id: number }[];
      estado.conectado = true;
      delete estado.ultimoError;
      for (const u of updates) {
        await bot.manejar(u);
        offset = u.update_id + 1;
        await escribirJsonAtomico(rutaOffset, { offset });
      }
    } catch (e) {
      estado.conectado = false;
      estado.ultimoError = (e as Error).message;
      console.error("Telegram:", estado.ultimoError);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

async function leerOffset(ruta: string): Promise<number> {
  try {
    const v = JSON.parse(await readFile(ruta, "utf8")) as { offset?: unknown };
    return typeof v.offset === "number" ? v.offset : 0;
  } catch {
    return 0;
  }
}
