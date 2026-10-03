// Genera ejecutable/profesor-repaso.exe: el programa con Node dentro, para arrancar con doble clic.
// Uso: npm run exe
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(RAIZ, ".runtime", "exe");
const SALIDA = join(RAIZ, "ejecutable");
const EXE = join(SALIDA, process.platform === "win32" ? "profesor-repaso.exe" : "profesor-repaso");

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
await mkdir(join(SALIDA, "datos"), { recursive: true });

// 1. Todo el código en un solo archivo.
const paquete = join(TMP, "servidor.cjs");
await build({
  entryPoints: [join(RAIZ, "src", "servidor.ts")],
  outfile: paquete,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  logOverride: { "empty-import-meta": "silent" }, // import.meta solo se usa fuera del ejecutable
});

// 2. Ese archivo se convierte en un bloque que Node sabe ejecutar al arrancar.
const bloque = join(TMP, "servidor.blob");
const config = join(TMP, "sea-config.json");
await writeFile(config, JSON.stringify({ main: paquete, output: bloque, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "inherit" });

// 3. Copia de node con el bloque inyectado.
await copyFile(process.execPath, EXE);
const postject = join(RAIZ, "node_modules", "postject", "dist", "cli.js");
execFileSync(process.execPath, [
  postject, EXE, "NODE_SEA_BLOB", bloque,
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
], { stdio: "inherit" });

// 4. Lo que el programa necesita a su lado. Los datos que ya existan en ejecutable/ no se tocan.
await cp(join(RAIZ, "public"), join(SALIDA, "public"), { recursive: true });
await copyFile(join(RAIZ, ".env.example"), join(SALIDA, ".env.example"));
for (const f of ["catalogo.json", "fuentes.json"]) {
  const destino = join(SALIDA, "datos", f);
  if (!existsSync(destino)) await copyFile(join(RAIZ, "datos", f), destino);
}

// 5. Zip para compartir: solo el programa, nunca el .env ni los datos de alumnos.
if (process.platform === "win32") {
  const paquete = join(TMP, "paquete", "profesor-repaso");
  await mkdir(join(paquete, "datos"), { recursive: true });
  await copyFile(EXE, join(paquete, "profesor-repaso.exe"));
  await cp(join(RAIZ, "public"), join(paquete, "public"), { recursive: true });
  await copyFile(join(RAIZ, ".env.example"), join(paquete, ".env.example"));
  await copyFile(join(RAIZ, "scripts", "LEEME.txt"), join(paquete, "LEEME.txt"));
  for (const f of ["catalogo.json", "fuentes.json"]) await copyFile(join(RAIZ, "datos", f), join(paquete, "datos", f));
  const zip = join(SALIDA, "profesor-repaso-windows.zip");
  await rm(zip, { force: true });
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Compress-Archive -Path '${paquete.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -CompressionLevel Optimal`], { stdio: "inherit" });
  console.log(`Zip para compartir: ${zip}`);
}

console.log(`\nListo: ${EXE}`);
