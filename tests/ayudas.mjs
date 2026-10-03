// Utilidades compartidas por los tests: red falsa, almacén temporal y catálogo.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Almacen } from "../dist/almacen.js";
import { cargarCatalogo } from "../dist/catalogo.js";

export const catalogo = cargarCatalogo(fileURLToPath(new URL("../datos/catalogo.json", import.meta.url)));

export async function almacenTemporal() {
  const dir = await mkdtemp(join(tmpdir(), "profesor-"));
  return Almacen.abrir(dir);
}

export const PDF = Buffer.from("%PDF-1.4\n%prueba\n");

// rutas: { url: (init) => Response }
export function redFalsa(rutas) {
  const llamadas = [];
  return {
    llamadas,
    fetch: async (url, init = {}) => {
      llamadas.push({ url: String(url), metodo: init.method ?? "GET" });
      const r = rutas[String(url)];
      if (!r) return new Response("no", { status: 404 });
      return r(init);
    },
    resolver: async (host) => (host.endsWith(".interno") ? ["192.168.1.10"] : ["93.184.216.34"]),
  };
}

export const respuestaPdf = (cuerpo = PDF) => (init) =>
  new Response(init.method === "HEAD" ? null : cuerpo, { status: 200, headers: { "content-type": "application/pdf" } });

export function proveedorFalso(resultados) {
  return { nombre: "falso", consultas: [], async buscar(c) { this.consultas.push(c); return resultados; } };
}
