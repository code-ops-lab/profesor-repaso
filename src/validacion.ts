import type { Complejidad, Grado } from "./dominio.js";
import { LIMITES } from "./config.js";

export function esGrado(v: unknown): v is Grado {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 6;
}

export function esComplejidad(v: unknown): v is Complejidad {
  return v === "basico" || v === "medio" || v === "avanzado";
}

// Nombre del alumno: 1–40 caracteres, sin caracteres de control.
export function validarNombre(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const limpio = v.trim().replace(/\s+/g, " ");
  if (limpio.length === 0 || limpio.length > LIMITES.nombreAlumno) return null;
  if (/[\u0000-\u001f\u007f]/.test(limpio)) return null;
  return limpio;
}

export function esMes(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return false;
  return true;
}

export function esFecha(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function esDiaSemana(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7;
}

export function esToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(v);
}

export function esIdFicha(v: unknown): v is string {
  return typeof v === "string" && /^[a-f0-9]{16}$/.test(v);
}

export function esUrlHttp(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// URL http/https cuya ruta termina en .pdf (ignorando query y mayúsculas).
export function esUrlPdf(v: unknown): v is string {
  if (!esUrlHttp(v)) return false;
  return new URL(v).pathname.toLowerCase().endsWith(".pdf");
}

export function esBooleano(v: unknown): v is boolean {
  return typeof v === "boolean";
}
