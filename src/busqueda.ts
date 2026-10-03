import { createHash } from "node:crypto";
import type { Complejidad, Ficha, Grado } from "./dominio.js";
import { LIMITES, TEXTO_COMPLEJIDAD, TIEMPOS } from "./config.js";
import { esUrlHttp, esUrlPdf } from "./validacion.js";
import { type DepsRed, type Fetch, enParalelo, fetchSeguro } from "./red.js";

export interface ResultadoBusqueda {
  url: string;
  titulo: string;
}

// Cualquier buscador se conecta implementando esta interfaz.
export interface ProveedorBusqueda {
  readonly nombre: string;
  buscar(consulta: string, n: number): Promise<ResultadoBusqueda[]>;
}

// Adaptador de ejemplo: versión HTML de DuckDuckGo. No necesita clave,
// pero es una página pública no oficial: si DuckDuckGo cambia su HTML, hay que ajustar el parser.
export class ProveedorDuckDuckGo implements ProveedorBusqueda {
  readonly nombre = "duckduckgo";
  constructor(private readonly fetchFn: Fetch) {}

  async buscar(consulta: string, n: number): Promise<ResultadoBusqueda[]> {
    const url = `https://html.duckduckgo.com/html/?kl=es-es&q=${encodeURIComponent(consulta)}`;
    const r = await this.fetchFn(url, {
      headers: { "User-Agent": "Mozilla/5.0 (ProfesorRepaso)", "Accept-Language": "es-ES,es" },
      signal: AbortSignal.timeout(TIEMPOS.busquedaMs),
    });
    // Cuando limita peticiones automáticas responde 202 con una página de comprobación, sin resultados.
    if (r.status !== 200) throw new Error(`DuckDuckGo respondió ${r.status}`);
    return parsearDuckDuckGo(await r.text()).slice(0, n);
  }
}

export function parsearDuckDuckGo(html: string): ResultadoBusqueda[] {
  const salida: ResultadoBusqueda[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const href = decodificarEntidades(m[1] ?? "");
    const titulo = decodificarEntidades((m[2] ?? "").replace(/<[^>]+>/g, "")).trim();
    let url = href;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      const real = u.searchParams.get("uddg");
      url = real ?? u.toString();
    } catch {
      continue;
    }
    if (esUrlHttp(url)) salida.push({ url, titulo });
  }
  return salida;
}

function decodificarEntidades(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

export function crearProveedor(nombre: string, fetchFn: Fetch): ProveedorBusqueda {
  switch (nombre) {
    case "duckduckgo":
      return new ProveedorDuckDuckGo(fetchFn);
    default:
      throw new Error(`Proveedor de búsqueda desconocido: '${nombre}'. Ver README.md para añadir uno.`);
  }
}

export function construirConsulta(tema: string, grado: Grado, cx: Complejidad, dominios: readonly string[] = []): string {
  const base = `${tema} ${grado}º primaria ${TEXTO_COMPLEJIDAD[cx]} fichas filetype:pdf`;
  if (dominios.length === 0) return base;
  return `${base} (${dominios.map((d) => `site:${d}`).join(" OR ")})`;
}

export function idDeUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

// HEAD con tiempo máximo; si el servidor no admite HEAD, prueba un GET de 1 KB.
export async function validarPdf(url: string, red: DepsRed): Promise<boolean> {
  const intentar = async (init: RequestInit): Promise<Response | null> => {
    try {
      const { respuesta } = await fetchSeguro(url, { ...init, signal: AbortSignal.timeout(TIEMPOS.validacionMs) }, red, LIMITES.redirecciones);
      return respuesta;
    } catch {
      return null;
    }
  };
  let r = await intentar({ method: "HEAD" });
  if (r && (r.status === 405 || r.status === 501 || r.status === 403)) {
    r = await intentar({ method: "GET", headers: { Range: "bytes=0-1023" } });
    await r?.body?.cancel();
  }
  if (!r || (r.status !== 200 && r.status !== 206)) return false;
  const tipo = (r.headers.get("content-type") ?? "").toLowerCase();
  if (tipo.includes("pdf")) return true;
  return esUrlPdf(url) && (tipo === "" || tipo.includes("octet-stream"));
}

export interface ParametrosBusqueda {
  grado: Grado;
  asignatura: string;
  tema: string;
  complejidad: Complejidad;
  dominios: readonly string[];
}

// El buscador no respondió (caído, bloqueado o sin conexión). No es lo mismo que "sin resultados".
export class ErrorBusqueda extends Error {}

// Busca, valida y devuelve fichas listas para guardar. Nunca inventa URLs.
// Lanza ErrorBusqueda si ninguna consulta llegó a responder.
export async function buscarFichas(p: ParametrosBusqueda, proveedor: ProveedorBusqueda, red: DepsRed): Promise<Ficha[]> {
  const consultas = p.dominios.length > 0
    ? [construirConsulta(p.tema, p.grado, p.complejidad, p.dominios), construirConsulta(p.tema, p.grado, p.complejidad)]
    : [construirConsulta(p.tema, p.grado, p.complejidad)];
  const vistos = new Set<string>();
  const resultados: ResultadoBusqueda[] = [];
  const errores: string[] = [];
  for (const c of consultas) {
    let lista: ResultadoBusqueda[] = [];
    try {
      lista = await proveedor.buscar(c, LIMITES.resultadosBusqueda);
    } catch (e) {
      errores.push((e as Error).message);
      continue;
    }
    for (const r of lista) {
      if (!vistos.has(r.url)) {
        vistos.add(r.url);
        resultados.push(r);
      }
    }
  }
  if (errores.length === consultas.length) throw new ErrorBusqueda(`${proveedor.nombre}: ${errores.join("; ")}`);
  const validos = await enParalelo(resultados, LIMITES.concurrencia, (r) => validarPdf(r.url, red));
  return resultados
    .filter((_, i) => validos[i])
    .map((r) => ({
      id: idDeUrl(r.url),
      url: r.url,
      titulo: r.titulo || nombreDeArchivo(r.url),
      grado: p.grado,
      asignatura: p.asignatura,
      tema: p.tema,
      complejidad: p.complejidad,
      descargada: false,
    }));
}

function nombreDeArchivo(url: string): string {
  const ultimo = new URL(url).pathname.split("/").pop() ?? "ficha.pdf";
  return decodeURIComponent(ultimo).replace(/\.pdf$/i, "").replace(/[-_]+/g, " ");
}
