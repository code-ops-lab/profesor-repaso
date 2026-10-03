// Parámetros configurables. Los marcados como SUPUESTO están pendientes de confirmar.
import type { Complejidad } from "./dominio.js";

// SUPUESTO: fichas por asignatura y día según la complejidad elegida.
export const FICHAS_POR_DIA: Record<Complejidad, number> = {
  basico: 2,
  medio: 3,
  avanzado: 3,
};

// SUPUESTO: días planificados por defecto (1 = lunes … 7 = domingo).
export const DIAS_POR_DEFECTO: readonly number[] = [1, 2, 3, 4, 5];

export const TEXTO_COMPLEJIDAD: Record<Complejidad, string> = {
  basico: "repaso fácil",
  medio: "ejercicios",
  avanzado: "ejercicios avanzados problemas",
};

export const NOMBRE_COMPLEJIDAD: Record<Complejidad, string> = {
  basico: "Básico",
  medio: "Medio",
  avanzado: "Avanzado",
};

export const TIEMPOS = {
  validacionMs: 5_000,
  descargaMs: 20_000,
  busquedaMs: 10_000,
  pollingSegundos: 30,
} as const;

export const LIMITES = {
  pdfBytes: 15 * 1024 * 1024,
  redirecciones: 5,
  resultadosBusqueda: 30,
  concurrencia: 4,
  cacheDias: 30,
  nombreAlumno: 40,
  mensajeTelegram: 3_800,
} as const;
