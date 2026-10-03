import { join } from "node:path";
import { rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { LIMITES, TIEMPOS } from "./config.js";
import { type DepsRed, fetchSeguro } from "./red.js";

export type ResultadoDescarga = { ok: true; bytes: number } | { ok: false; motivo: string };

export async function descargarPdf(url: string, dirPdfs: string, id: string, red: DepsRed): Promise<ResultadoDescarga> {
  let respuesta: Response;
  try {
    ({ respuesta } = await fetchSeguro(url, { signal: AbortSignal.timeout(TIEMPOS.descargaMs) }, red, LIMITES.redirecciones));
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
  if (!respuesta.ok || !respuesta.body) return { ok: false, motivo: `HTTP ${respuesta.status}` };
  const declarado = Number(respuesta.headers.get("content-length") ?? "0");
  if (declarado > LIMITES.pdfBytes) {
    await respuesta.body.cancel();
    return { ok: false, motivo: "Archivo demasiado grande" };
  }

  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    const lector = respuesta.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > LIMITES.pdfBytes) {
        await lector.cancel();
        return { ok: false, motivo: "Archivo demasiado grande" };
      }
      trozos.push(value);
    }
  } catch (e) {
    return { ok: false, motivo: `Descarga interrumpida: ${(e as Error).message}` };
  }

  const contenido = Buffer.concat(trozos);
  if (contenido.subarray(0, 4).toString("latin1") !== "%PDF") return { ok: false, motivo: "No es un PDF" };

  const destino = join(dirPdfs, `${id}.pdf`);
  const tmp = `${destino}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, contenido);
  await rename(tmp, destino);
  return { ok: true, bytes: total };
}
