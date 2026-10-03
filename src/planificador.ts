// Lógica pura y determinista: misma entrada → mismo plan.
import type { Complejidad, Dificultad } from "./dominio.js";
import { FICHAS_POR_DIA } from "./config.js";

export function claveDificultad(d: Dificultad): string {
  return `${d.asignatura}|${d.tema}|${d.complejidad}`;
}

// Día de la semana 1 = lunes … 7 = domingo para una fecha "YYYY-MM-DD".
export function diaSemana(fecha: string): number {
  const d = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// Fechas del mes que caen en los días elegidos, desde 'desde' inclusive (si se da).
export function fechasDelMes(mes: string, dias: readonly number[], desde?: string): string[] {
  const [a, m] = mes.split("-").map(Number);
  if (a === undefined || m === undefined) return [];
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const elegidos = new Set(dias);
  const fechas: string[] = [];
  for (let d = 1; d <= total; d++) {
    const f = `${mes}-${String(d).padStart(2, "0")}`;
    if (desde !== undefined && f < desde) continue;
    if (elegidos.has(diaSemana(f))) fechas.push(f);
  }
  return fechas;
}

export interface EntradaPlan {
  fechas: readonly string[];
  dificultades: readonly Dificultad[];
  candidatas: Readonly<Record<string, readonly string[]>>; // claveDificultad → ids de ficha en orden
  excluir: ReadonlySet<string>; // ya impresas o ya asignadas en otros planes
  porDia?: Readonly<Record<Complejidad, number>>;
  nombres?: Readonly<Record<string, string>>; // código de asignatura → nombre para los avisos
}

export interface AsignacionPlan {
  fecha: string;
  fichaId: string;
  asignatura: string;
}

export interface ResultadoPlan {
  asignaciones: AsignacionPlan[];
  avisos: string[];
}

// Varias dificultades de la misma asignatura comparten el cupo diario de esa asignatura
// (el mayor de sus complejidades) y se alternan en orden.
export function planificar(e: EntradaPlan): ResultadoPlan {
  const porDia = e.porDia ?? FICHAS_POR_DIA;
  const grupos = new Map<string, Dificultad[]>();
  for (const d of e.dificultades) {
    const g = grupos.get(d.asignatura) ?? [];
    if (!g.some((x) => claveDificultad(x) === claveDificultad(d))) g.push(d);
    grupos.set(d.asignatura, g);
  }

  const usadas = new Set<string>(e.excluir);
  const asignaciones: AsignacionPlan[] = [];
  const avisos: string[] = [];

  for (const [asignatura, difs] of grupos) {
    const cupo = Math.max(...difs.map((d) => porDia[d.complejidad]));
    const cola = intercalar(difs.map((d) => e.candidatas[claveDificultad(d)] ?? []));
    let i = 0;
    let ultimaFecha: string | undefined;
    for (const fecha of e.fechas) {
      let puestas = 0;
      while (puestas < cupo && i < cola.length) {
        const id = cola[i++] as string;
        if (usadas.has(id)) continue;
        usadas.add(id);
        asignaciones.push({ fecha, fichaId: id, asignatura });
        puestas++;
      }
      if (puestas > 0) ultimaFecha = fecha;
      if (i >= cola.length) break;
    }
    const temas = difs.map((d) => d.tema).join(", ");
    const nombre = e.nombres?.[asignatura] ?? asignatura;
    if (ultimaFecha === undefined) {
      avisos.push(`No se encontraron fichas para ${nombre} (${temas}).`);
    } else if (ultimaFecha !== e.fechas[e.fechas.length - 1]) {
      avisos.push(`No hay más fichas para ${nombre} (${temas}): plan cubierto hasta el ${ultimaFecha}.`);
    }
  }

  asignaciones.sort((a, b) => (a.fecha === b.fecha ? 0 : a.fecha < b.fecha ? -1 : 1));
  return { asignaciones, avisos };
}

// [[a1,a2],[b1]] → [a1,b1,a2]
function intercalar(listas: readonly (readonly string[])[]): string[] {
  const salida: string[] = [];
  const max = Math.max(0, ...listas.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of listas) {
      const v = l[i];
      if (v !== undefined) salida.push(v);
    }
  }
  return salida;
}
