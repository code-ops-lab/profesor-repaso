export type Grado = 1 | 2 | 3 | 4 | 5 | 6;
export type Complejidad = "basico" | "medio" | "avanzado";

export interface Alumno {
  id: string;
  chatId: number; // usuario de Telegram propietario
  nombre: string;
  grado: Grado;
  token: string; // enlace personal a la web
  creado: string; // ISO 8601
}

export interface Dificultad {
  asignatura: string; // código del catálogo: "mat", "len"...
  tema: string; // nombre del tema tal como aparece en el catálogo
  complejidad: Complejidad;
}

export interface Ficha {
  id: string; // hash estable de la URL
  url: string; // siempre de la búsqueda o de fuentes.json
  titulo: string;
  grado: Grado;
  asignatura: string;
  tema: string;
  complejidad: Complejidad;
  descargada: boolean; // existe copia en datos/pdfs/<id>.pdf
}

export interface Plan {
  id: string;
  alumnoId: string;
  mes: string; // "2026-11"
  dias: number[]; // 1 = lunes … 7 = domingo
  dificultades: Dificultad[];
  creado: string;
}

export interface Asignacion {
  planId: string;
  alumnoId: string;
  fecha: string; // "2026-11-03"
  fichaId: string;
  asignatura: string;
  impresa: boolean;
  fechaImpresion?: string;
}

export interface EntradaCache {
  fecha: string;
  fichaIds: string[];
}

export interface EntradaRegistro {
  fecha: string;
  tipo: "desmarcar-impresion" | "regenerar-token" | "eliminar-alumno";
  alumnoId: string;
  detalle: string;
}

// Estado de la conversación con el bot, por chat.
export interface Sesion {
  chatId: number;
  paso: "ninguno" | "nombre";
  nombre?: string;
  alumnoId?: string;
  asignatura?: string;
  tema?: string;
  dificultades: Dificultad[];
  mes?: string;
  dias: number[];
}

export interface Respuesta<T> {
  ok: boolean;
  datos?: T;
  error?: string;
}
