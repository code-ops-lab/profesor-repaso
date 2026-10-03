// Orquesta búsqueda, caché, planificador y descargas. Lo usan el bot y los tests.
import type { Alumno, Asignacion, Dificultad, Ficha, Plan } from "./dominio.js";
import { LIMITES } from "./config.js";
import type { Almacen } from "./almacen.js";
import { type Catalogo, nombreAsignatura } from "./catalogo.js";
import { ErrorBusqueda, type ProveedorBusqueda, buscarFichas } from "./busqueda.js";
import { descargarPdf } from "./descargas.js";
import { claveDificultad, fechasDelMes, planificar } from "./planificador.js";
import { type DepsRed, enParalelo } from "./red.js";

export interface Contexto {
  almacen: Almacen;
  catalogo: Catalogo;
  proveedor: ProveedorBusqueda;
  red: DepsRed;
  dominios: readonly string[];
  hoy: () => string; // "YYYY-MM-DD"
}

export function claveCache(grado: number, d: Dificultad): string {
  return `${grado}|${claveDificultad(d)}`;
}

export async function obtenerFichas(ctx: Contexto, grado: Alumno["grado"], d: Dificultad): Promise<Ficha[]> {
  const clave = claveCache(grado, d);
  const cache = ctx.almacen.cache(clave);
  // Una entrada vacía no cuenta: pudo guardarse con el buscador bloqueado. Se vuelve a buscar.
  if (cache && cache.fichaIds.length > 0) {
    const edadDias = (Date.parse(ctx.hoy()) - Date.parse(cache.fecha.slice(0, 10))) / 86_400_000;
    if (edadDias <= LIMITES.cacheDias) {
      return cache.fichaIds.map((id) => ctx.almacen.ficha(id)).filter((f): f is Ficha => f !== undefined);
    }
  }
  const fichas = await buscarFichas({ grado, ...d, dominios: ctx.dominios }, ctx.proveedor, ctx.red);
  if (fichas.length === 0) return fichas;
  await ctx.almacen.guardarFichas(fichas);
  await ctx.almacen.guardarCache(clave, fichas.map((f) => f.id));
  return fichas;
}

export interface ResultadoGeneracion {
  plan?: Plan;
  asignaciones: Pick<Asignacion, "fecha" | "fichaId" | "asignatura">[];
  avisos: string[];
  diasPlanificados: number;
}

export async function generarPlan(
  ctx: Contexto, alumno: Alumno, dificultades: Dificultad[], mes: string, dias: number[],
): Promise<ResultadoGeneracion> {
  const fechas = fechasDelMes(mes, dias, ctx.hoy());
  if (fechas.length === 0) return { asignaciones: [], avisos: ["No quedan días de ese mes con los días elegidos."], diasPlanificados: 0 };

  const candidatas: Record<string, string[]> = {};
  let buscadorFallo = false;
  for (const d of dificultades) {
    try {
      candidatas[claveDificultad(d)] = (await obtenerFichas(ctx, alumno.grado, d)).map((f) => f.id);
    } catch (e) {
      if (!(e instanceof ErrorBusqueda)) throw e;
      console.error("Búsqueda:", e.message);
      candidatas[claveDificultad(d)] = [];
      buscadorFallo = true;
    }
  }
  const avisosBusqueda = buscadorFallo ? ["El buscador no ha respondido (puede estar limitando las peticiones). Inténtalo más tarde."] : [];

  const excluir = new Set(ctx.almacen.asignacionesDe(alumno.id).map((a) => a.fichaId));
  const nombres = Object.fromEntries(dificultades.map((d) => [d.asignatura, nombreAsignatura(ctx.catalogo, d.asignatura)]));
  const fallidas: string[] = [];

  // Planifica, descarga lo asignado y, si alguna descarga falla, vuelve a planificar sin ella.
  for (let intento = 0; intento < 3; intento++) {
    const r = planificar({ fechas, dificultades, candidatas, excluir, nombres });
    const pendientes = [...new Set(r.asignaciones.map((a) => a.fichaId))].filter((id) => !ctx.almacen.ficha(id)?.descargada);
    const resultados = await enParalelo(pendientes, LIMITES.concurrencia, async (id) => {
      const f = ctx.almacen.ficha(id);
      if (!f) return false;
      const d = await descargarPdf(f.url, ctx.almacen.rutaPdfs, id, ctx.red);
      await ctx.almacen.marcarDescargada(id, d.ok);
      return d.ok;
    });
    const nuevasFallidas = pendientes.filter((_, i) => !resultados[i]);
    if (nuevasFallidas.length === 0 || intento === 2) {
      const asignaciones = r.asignaciones.filter((a) => !nuevasFallidas.includes(a.fichaId));
      const avisos = [...avisosBusqueda, ...r.avisos];
      const totalFallidas = fallidas.length + nuevasFallidas.length;
      if (totalFallidas > 0) avisos.push(`${totalFallidas} PDF no se pudieron descargar y se descartaron.`);
      if (asignaciones.length === 0) return { asignaciones, avisos, diasPlanificados: 0 };
      const plan = await ctx.almacen.crearPlan({ alumnoId: alumno.id, mes, dias, dificultades }, asignaciones);
      return { plan, asignaciones, avisos, diasPlanificados: new Set(asignaciones.map((a) => a.fecha)).size };
    }
    for (const id of nuevasFallidas) {
      excluir.add(id);
      fallidas.push(id);
    }
  }
  return { asignaciones: [], avisos: ["No se pudo generar el plan."], diasPlanificados: 0 };
}
