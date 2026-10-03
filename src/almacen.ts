// Persistencia en JSON con escritura atómica (escribir .tmp y renombrar).
// Las escrituras se serializan con una cola para que nunca se pisen.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  Alumno, Asignacion, EntradaCache, EntradaRegistro, Ficha, Grado, Plan, Sesion,
} from "./dominio.js";
import { DIAS_POR_DEFECTO } from "./config.js";

interface Datos {
  alumnos: Alumno[];
  planes: Plan[];
  fichas: Record<string, Ficha>;
  asignaciones: Asignacion[];
  cache: Record<string, EntradaCache>;
  registro: EntradaRegistro[];
  sesiones: Record<string, Sesion>;
}

type Coleccion = keyof Datos;

const VACIO: { [K in Coleccion]: () => Datos[K] } = {
  alumnos: () => [],
  planes: () => [],
  fichas: () => ({}),
  asignaciones: () => [],
  cache: () => ({}),
  registro: () => [],
  sesiones: () => ({}),
};

export async function escribirJsonAtomico(ruta: string, valor: unknown): Promise<void> {
  const tmp = `${ruta}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(valor, null, 2), "utf8");
  await rename(tmp, ruta);
}

export function nuevoToken(): string {
  return randomBytes(24).toString("base64url"); // 192 bits
}

export class Almacen {
  private datos!: Datos;
  private cola: Promise<void> = Promise.resolve();

  private constructor(readonly dir: string) {}

  static async abrir(dir: string): Promise<Almacen> {
    const a = new Almacen(dir);
    await mkdir(join(dir, "pdfs"), { recursive: true });
    const datos: Partial<Datos> = {};
    for (const c of Object.keys(VACIO) as Coleccion[]) {
      (datos as Record<Coleccion, unknown>)[c] = await leer(join(dir, `${c}.json`), VACIO[c]());
    }
    a.datos = datos as Datos;
    return a;
  }

  get rutaPdfs(): string {
    return join(this.dir, "pdfs");
  }

  private guardar(...cols: Coleccion[]): Promise<void> {
    const tarea = this.cola.then(async () => {
      for (const c of cols) await escribirJsonAtomico(join(this.dir, `${c}.json`), this.datos[c]);
    });
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  // ---- Alumnos ----
  alumnosDe(chatId: number): Alumno[] {
    return this.datos.alumnos.filter((a) => a.chatId === chatId);
  }
  alumno(id: string): Alumno | undefined {
    return this.datos.alumnos.find((a) => a.id === id);
  }
  alumnoPorToken(token: string): Alumno | undefined {
    return this.datos.alumnos.find((a) => a.token === token);
  }
  async crearAlumno(chatId: number, nombre: string, grado: Grado): Promise<Alumno> {
    const a: Alumno = {
      id: randomBytes(4).toString("hex"),
      chatId, nombre, grado, token: nuevoToken(), creado: new Date().toISOString(),
    };
    this.datos.alumnos.push(a);
    await this.guardar("alumnos");
    return a;
  }
  async regenerarToken(alumnoId: string): Promise<string | undefined> {
    const a = this.alumno(alumnoId);
    if (!a) return undefined;
    a.token = nuevoToken();
    this.datos.registro.push({
      fecha: new Date().toISOString(), tipo: "regenerar-token", alumnoId, detalle: "Enlace web regenerado",
    });
    await this.guardar("alumnos", "registro");
    return a.token;
  }
  // Borra el alumno con sus planes y asignaciones. Las fichas y los PDF se conservan:
  // son la caché de búsquedas y pueden estar en planes de otros alumnos.
  async eliminarAlumno(alumnoId: string): Promise<boolean> {
    if (!this.alumno(alumnoId)) return false;
    this.datos.alumnos = this.datos.alumnos.filter((a) => a.id !== alumnoId);
    this.datos.planes = this.datos.planes.filter((p) => p.alumnoId !== alumnoId);
    this.datos.asignaciones = this.datos.asignaciones.filter((a) => a.alumnoId !== alumnoId);
    this.datos.registro.push({
      fecha: new Date().toISOString(), tipo: "eliminar-alumno", alumnoId, detalle: "Alumno eliminado con sus planes",
    });
    await this.guardar("alumnos", "planes", "asignaciones", "registro");
    return true;
  }

  // ---- Fichas y caché ----
  ficha(id: string): Ficha | undefined {
    return this.datos.fichas[id];
  }
  async guardarFichas(fichas: Ficha[]): Promise<void> {
    for (const f of fichas) {
      const previa = this.datos.fichas[f.id];
      this.datos.fichas[f.id] = previa ? { ...f, descargada: previa.descargada || f.descargada } : f;
    }
    await this.guardar("fichas");
  }
  async marcarDescargada(id: string, descargada: boolean): Promise<void> {
    const f = this.datos.fichas[id];
    if (!f) return;
    f.descargada = descargada;
    await this.guardar("fichas");
  }
  cache(clave: string): EntradaCache | undefined {
    return this.datos.cache[clave];
  }
  async guardarCache(clave: string, fichaIds: string[]): Promise<void> {
    this.datos.cache[clave] = { fecha: new Date().toISOString(), fichaIds };
    await this.guardar("cache");
  }

  // ---- Planes y asignaciones ----
  planesDe(alumnoId: string): Plan[] {
    return this.datos.planes.filter((p) => p.alumnoId === alumnoId);
  }
  asignacionesDe(alumnoId: string): Asignacion[] {
    return this.datos.asignaciones.filter((a) => a.alumnoId === alumnoId);
  }
  async crearPlan(plan: Omit<Plan, "id" | "creado">, asignaciones: Omit<Asignacion, "planId" | "alumnoId" | "impresa">[]): Promise<Plan> {
    const p: Plan = { ...plan, id: randomUUID(), creado: new Date().toISOString() };
    this.datos.planes.push(p);
    for (const a of asignaciones) {
      this.datos.asignaciones.push({ ...a, planId: p.id, alumnoId: p.alumnoId, impresa: false });
    }
    await this.guardar("planes", "asignaciones");
    return p;
  }
  async marcarImpresa(alumnoId: string, fichaId: string, fecha: string, impresa: boolean): Promise<Asignacion | undefined> {
    const a = this.datos.asignaciones.find((x) => x.alumnoId === alumnoId && x.fichaId === fichaId && x.fecha === fecha);
    if (!a) return undefined;
    if (a.impresa && !impresa) {
      this.datos.registro.push({
        fecha: new Date().toISOString(), tipo: "desmarcar-impresion", alumnoId,
        detalle: `Ficha ${fichaId} del ${fecha} desmarcada (impresa el ${a.fechaImpresion ?? "?"})`,
      });
    }
    a.impresa = impresa;
    if (impresa) a.fechaImpresion = new Date().toISOString();
    else delete a.fechaImpresion;
    await this.guardar("asignaciones", "registro");
    return a;
  }

  // ---- Sesiones del bot ----
  sesion(chatId: number): Sesion {
    return this.datos.sesiones[String(chatId)] ?? {
      chatId, paso: "ninguno", dificultades: [], dias: [...DIAS_POR_DEFECTO],
    };
  }
  async guardarSesion(s: Sesion): Promise<void> {
    this.datos.sesiones[String(s.chatId)] = s;
    await this.guardar("sesiones");
  }

  // Espera a que terminen las escrituras pendientes (útil en tests y al cerrar).
  vaciarCola(): Promise<void> {
    return this.cola;
  }
}

async function leer<T>(ruta: string, porDefecto: T): Promise<T> {
  try {
    return JSON.parse(await readFile(ruta, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return porDefecto;
    throw new Error(`No se pudo leer ${ruta}: ${(e as Error).message}`);
  }
}
