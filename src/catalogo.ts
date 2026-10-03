import { readFileSync } from "node:fs";
import type { Grado } from "./dominio.js";
import { esGrado } from "./validacion.js";

export interface Catalogo {
  asignaturas: Record<string, string>; // código → nombre visible
  temas: Record<string, Record<string, string[]>>; // grado → código → temas
}

export function validarCatalogo(datos: unknown): Catalogo {
  if (typeof datos !== "object" || datos === null) throw new Error("catalogo.json: debe ser un objeto");
  const { asignaturas, temas } = datos as Record<string, unknown>;
  if (typeof asignaturas !== "object" || asignaturas === null) throw new Error("catalogo.json: falta 'asignaturas'");
  if (typeof temas !== "object" || temas === null) throw new Error("catalogo.json: falta 'temas'");
  const asig: Record<string, string> = {};
  for (const [cod, nombre] of Object.entries(asignaturas)) {
    if (!/^[a-z]{2,6}$/.test(cod) || typeof nombre !== "string") throw new Error(`catalogo.json: asignatura inválida '${cod}'`);
    asig[cod] = nombre;
  }
  const tem: Record<string, Record<string, string[]>> = {};
  for (const [g, porAsig] of Object.entries(temas)) {
    if (!esGrado(Number(g))) throw new Error(`catalogo.json: grado inválido '${g}'`);
    if (typeof porAsig !== "object" || porAsig === null) throw new Error(`catalogo.json: grado ${g} mal formado`);
    tem[g] = {};
    for (const [cod, lista] of Object.entries(porAsig)) {
      if (!(cod in asig)) throw new Error(`catalogo.json: asignatura desconocida '${cod}' en grado ${g}`);
      if (!Array.isArray(lista) || !lista.every((t) => typeof t === "string" && t.length > 0)) {
        throw new Error(`catalogo.json: temas inválidos en ${g}/${cod}`);
      }
      tem[g][cod] = lista as string[];
    }
  }
  return { asignaturas: asig, temas: tem };
}

export function cargarCatalogo(ruta: string): Catalogo {
  return validarCatalogo(JSON.parse(readFileSync(ruta, "utf8")));
}

export function asignaturasDeGrado(cat: Catalogo, grado: Grado): string[] {
  return Object.keys(cat.temas[String(grado)] ?? {});
}

export function temasDe(cat: Catalogo, grado: Grado, asignatura: string): string[] {
  return cat.temas[String(grado)]?.[asignatura] ?? [];
}

export function nombreAsignatura(cat: Catalogo, cod: string): string {
  return cat.asignaturas[cod] ?? cod;
}
