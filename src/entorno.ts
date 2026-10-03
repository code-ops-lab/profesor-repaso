// Archivo .env y secretos. En Windows el token se guarda cifrado con DPAPI: solo lo puede
// descifrar el mismo usuario de Windows en el mismo ordenador. En otros sistemas se guarda tal cual.
import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

export const PREFIJO_CIFRADO = "dpapi:";

export const puedeCifrar = (): boolean => process.platform === "win32";

// PowerShell recibe y devuelve base64 por la entrada y salida estándar: el secreto nunca va en la línea de órdenes.
const PS_CIFRAR = "Add-Type -AssemblyName System.Security; $d = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($d, $null, 'CurrentUser'))";
const PS_DESCIFRAR = "Add-Type -AssemblyName System.Security; $d = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($d, $null, 'CurrentUser'))";

function powershell(script: string, entrada: string): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
    ], { windowsHide: true });
    let salida = "";
    let errores = "";
    hijo.stdout.on("data", (d: Buffer) => (salida += d.toString("utf8")));
    hijo.stderr.on("data", (d: Buffer) => (errores += d.toString("utf8")));
    hijo.on("error", rechazar);
    hijo.on("close", (codigo) => {
      if (codigo === 0 && salida.trim()) resolver(salida.trim());
      else rechazar(new Error(`PowerShell terminó con código ${codigo}: ${errores.trim().split("\n")[0] ?? ""}`));
    });
    hijo.stdin.end(entrada);
  });
}

export async function cifrar(texto: string): Promise<string> {
  if (!puedeCifrar()) return texto;
  const b64 = await powershell(PS_CIFRAR, Buffer.from(texto, "utf8").toString("base64"));
  return PREFIJO_CIFRADO + b64;
}

// Devuelve el valor en claro. Falla si está cifrado y no se puede descifrar (otro usuario u ordenador).
export async function descifrar(valor: string): Promise<string> {
  if (!valor.startsWith(PREFIJO_CIFRADO)) return valor;
  if (!puedeCifrar()) throw new Error("El token está cifrado con Windows y este sistema no puede descifrarlo.");
  const b64 = await powershell(PS_DESCIFRAR, valor.slice(PREFIJO_CIFRADO.length));
  return Buffer.from(b64, "base64").toString("utf8");
}

// Pone CLAVE=valor en el .env: sustituye la línea si existe y si no la añade.
// Si el .env no existe, parte de .env.example (en la misma carpeta) para conservar los comentarios.
export async function guardarVariable(rutaEnv: string, clave: string, valor: string): Promise<void> {
  let texto: string;
  try {
    texto = await readFile(rutaEnv, "utf8");
  } catch {
    texto = await readFile(join(dirname(rutaEnv), ".env.example"), "utf8").catch(() => "");
  }
  const salto = texto.includes("\r\n") ? "\r\n" : "\n";
  const linea = `${clave}=${valor}`;
  const re = new RegExp(`^${clave}=.*$`, "m");
  if (re.test(texto)) texto = texto.replace(re, () => linea);
  else texto = `${texto}${texto && !texto.endsWith("\n") ? salto : ""}${linea}${salto}`;
  const tmp = `${rutaEnv}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, texto, "utf8");
  await rename(tmp, rutaEnv);
}

// "8123456789:AAH****Xq4w": para reconocer el token sin mostrarlo entero.
export function enmascarar(token: string): string {
  if (token.length < 16) return "****";
  const dosPuntos = token.indexOf(":");
  const inicio = dosPuntos > 0 ? token.slice(0, dosPuntos + 4) : token.slice(0, 4);
  return `${inicio}****${token.slice(-4)}`;
}
