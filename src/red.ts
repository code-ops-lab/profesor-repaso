// Peticiones salientes seguras: solo http/https hacia IPs públicas, también tras redirecciones.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Fetch = typeof fetch;
export type Resolver = (host: string) => Promise<string[]>;

export const resolverDns: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

export interface DepsRed {
  fetch: Fetch;
  resolver: Resolver;
}

export const redPorDefecto: DepsRed = { fetch: globalThis.fetch.bind(globalThis), resolver: resolverDns };

export function esIpPrivada(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return esIpv4Privada(ip);
  if (v === 6) return esIpv6Privada(ip);
  return true; // no es una IP válida: se trata como no permitida
}

// "::ffff:7f00:1" → [0,0,0,0,0,0xffff,0x7f00,1]. Admite la parte final en formato IPv4 ("::ffff:127.0.0.1").
function expandirIpv6(ip: string): number[] | null {
  let x = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (v4?.[1]) {
    const [a = 0, b = 0, c = 0, d = 0] = v4[1].split(".").map(Number);
    x = x.slice(0, -v4[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [izq = "", der] = x.split("::");
  const a = izq ? izq.split(":") : [];
  const b = der !== undefined && der !== "" ? der.split(":") : [];
  const relleno = der === undefined ? 0 : 8 - a.length - b.length;
  const grupos = [...a, ...Array<string>(Math.max(0, relleno)).fill("0"), ...b].map((g) => parseInt(g, 16));
  return grupos.length === 8 && grupos.every((g) => g >= 0 && g <= 0xffff) ? grupos : null;
}

const ipv4DeGrupos = (alto: number, bajo: number): string => `${alto >> 8}.${alto & 255}.${bajo >> 8}.${bajo & 255}`;

function esIpv6Privada(ip: string): boolean {
  const g = expandirIpv6(ip);
  if (!g) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const ceros = (...xs: number[]) => xs.every((n) => n === 0);
  // Direcciones que llevan una IPv4 dentro: se juzga esa IPv4.
  if (ceros(g0, g1, g2, g3, g4) && (g5 === 0xffff || g5 === 0)) return esIpv4Privada(ipv4DeGrupos(g6, g7)); // ::ffff:a.b.c.d y ::a.b.c.d (incluye :: y ::1)
  if (g0 === 0x64 && g1 === 0xff9b && ceros(g2, g3, g4, g5)) return esIpv4Privada(ipv4DeGrupos(g6, g7)); // NAT64
  if (g0 === 0x2002) return esIpv4Privada(ipv4DeGrupos(g1, g2)); // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00; // privadas, enlace local, multidifusión
}

function esIpv4Privada(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export async function esUrlPublica(url: string, resolver: Resolver): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (isIP(host)) return !esIpPrivada(host);
  try {
    const ips = await resolver(host);
    return ips.length > 0 && ips.every((ip) => !esIpPrivada(ip));
  } catch {
    return false;
  }
}

export class ErrorRed extends Error {}

// fetch que sigue redirecciones a mano comprobando cada salto.
export async function fetchSeguro(
  url: string, init: RequestInit, deps: DepsRed, maxRedirecciones = 5,
): Promise<{ respuesta: Response; urlFinal: string }> {
  let actual = url;
  for (let i = 0; i <= maxRedirecciones; i++) {
    if (!(await esUrlPublica(actual, deps.resolver))) throw new ErrorRed(`Dirección no permitida: ${actual}`);
    const r = await deps.fetch(actual, { ...init, redirect: "manual" });
    if (r.status >= 300 && r.status < 400) {
      const destino = r.headers.get("location");
      if (!destino) throw new ErrorRed("Redirección sin destino");
      await r.body?.cancel();
      actual = new URL(destino, actual).toString();
      continue;
    }
    return { respuesta: r, urlFinal: actual };
  }
  throw new ErrorRed("Demasiadas redirecciones");
}

// Ejecuta tareas con un máximo de 'limite' a la vez, conservando el orden de los resultados.
export async function enParalelo<T, R>(items: readonly T[], limite: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array<R>(items.length);
  let siguiente = 0;
  const trabajador = async (): Promise<void> => {
    while (siguiente < items.length) {
      const i = siguiente++;
      salida[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return salida;
}
