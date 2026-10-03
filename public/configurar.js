// Página de primera configuración: abrir BotFather y guardar el token del bot.
const $ = (id) => document.getElementById(id);

async function api(ruta, opciones) {
  let r;
  try {
    r = await fetch(ruta, opciones);
  } catch {
    throw new Error("No se puede conectar con el programa. Comprueba que sigue abierto.");
  }
  const json = await r.json().catch(() => null);
  if (!json || !json.ok) throw new Error(json?.error ?? `Error ${r.status}`);
  return json.datos;
}

function mostrarEstado(texto, esError = false) {
  $("estado").textContent = texto;
  $("estado").classList.toggle("error", esError);
}

function mostrarListo(usuarioBot) {
  $("pasos").hidden = true;
  $("listo").hidden = false;
  $("listo-texto").textContent = usuarioBot ? `Tu bot es @${usuarioBot}.` : "El bot ya está configurado.";
  if (usuarioBot) $("abrir-bot").href = `https://web.telegram.org/k/#@${usuarioBot}`;
  else $("abrir-bot").hidden = true;
}

async function iniciar() {
  try {
    const estado = await api("/api/configurar");
    mostrarEstado("");
    if (estado.pendiente) $("pasos").hidden = false;
    else mostrarListo(estado.usuarioBot);
  } catch (e) {
    mostrarEstado(e.message, true);
  }
}

$("abrir-botfather").addEventListener("click", async () => {
  try {
    await api("/api/configurar/botfather", { method: "POST" });
  } catch (e) {
    mostrarEstado(e.message, true);
  }
});

$("ver-token").addEventListener("click", () => {
  const campo = $("token");
  const ver = campo.type === "password";
  campo.type = ver ? "text" : "password";
  $("ver-token").textContent = ver ? "Ocultar" : "Ver";
  $("ver-token").setAttribute("aria-pressed", String(ver));
});

$("formulario").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const error = $("error");
  error.hidden = true;
  $("guardar").disabled = true;
  $("guardar").textContent = "Comprobando con Telegram…";
  try {
    const datos = await api("/api/configurar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: $("token").value.trim() }),
    });
    $("token").value = "";
    mostrarListo(datos.usuarioBot);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  } finally {
    $("guardar").disabled = false;
    $("guardar").textContent = "Guardar y conectar";
  }
});

iniciar();
