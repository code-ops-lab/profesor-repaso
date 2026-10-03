// Cliente de la web. Sin innerHTML con datos: todo se crea con textContent.
const $ = (id) => document.getElementById(id);

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const estado = {
  token: "",
  alumno: null,
  mes: "",
  dias: new Map(), // fecha → fichas
  diaSeleccionado: "",
  fichaEnVisor: null,
  visorCargado: false,
};

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const h of hijos) if (h) n.append(h);
  return n;
}

function mostrarEstado(texto, esError = false) {
  const e = $("estado");
  e.textContent = texto;
  e.classList.toggle("error", esError);
}

async function api(ruta, opciones) {
  let r;
  try {
    r = await fetch(ruta, opciones);
  } catch {
    throw new Error("No se puede conectar con el servidor. Comprueba que el ordenador está encendido y el programa arrancado.");
  }
  const json = await r.json().catch(() => null);
  if (!json || !json.ok) throw new Error(json?.error ?? `Error ${r.status}`);
  return json.datos;
}

const nombreMes = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
};

const desplazarMes = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

const fechaLarga = (f) => {
  const d = new Date(`${f}T00:00:00Z`);
  return `${DIAS_LARGOS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
};

const fechaCorta = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

const urlPdf = (f) => `/pdf/${encodeURIComponent(estado.token)}/${f.fichaId}`;
// Dentro de la página se oculta la barra oscura del visor del navegador: los botones son los de la web.
const urlPdfEnVisor = (f) => `${urlPdf(f)}#toolbar=0&navpanes=0&view=FitH`;

// ---------- Carga ----------

async function iniciar() {
  const m = /^\/a\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname);
  if (!m) {
    mostrarEstado("Abre el enlace personal que te dio el bot en Telegram.");
    return;
  }
  estado.token = m[1];
  try {
    estado.alumno = await api(`/api/alumno/${estado.token}`);
  } catch (e) {
    mostrarEstado(e.message, true);
    return;
  }
  const a = estado.alumno;
  document.title = `${a.nombre} · Profesor de repaso`;
  $("titulo").textContent = `Alumno: ${a.nombre}`;
  $("subtitulo").textContent = `Grado escolar: ${a.grado}º de primaria`;
  pintarProgreso();
  pintarResumen();

  const mesHoy = a.hoy.slice(0, 7);
  estado.mes = a.meses.includes(mesHoy) ? mesHoy : (a.meses.find((x) => x > mesHoy) ?? a.meses.at(-1) ?? mesHoy);
  $("contenido").hidden = false;
  await cargarMes();
}

async function cargarMes() {
  mostrarEstado("Cargando el mes…");
  $("mes-titulo").textContent = nombreMes(estado.mes);
  try {
    const datos = await api(`/api/alumno/${estado.token}/mes/${estado.mes}`);
    estado.dias = new Map(datos.dias.map((d) => [d.fecha, d.fichas]));
    mostrarEstado("");
  } catch (e) {
    estado.dias = new Map();
    mostrarEstado(e.message, true);
  }
  const hoy = estado.alumno.hoy;
  const fechas = [...estado.dias.keys()];
  estado.diaSeleccionado = estado.dias.has(hoy) ? hoy : (fechas.find((f) => f >= hoy) ?? fechas[0] ?? "");
  pintarCalendario();
  pintarDetalle();
}

// ---------- Pintado ----------

function pintarProgreso() {
  const { impresas, total } = estado.alumno.progreso;
  const p = $("progreso");
  p.hidden = total === 0;
  p.replaceChildren(el("strong", { text: `${impresas} de ${total}` }), " fichas impresas");
}

function pintarResumen() {
  const planes = estado.alumno.planes;
  const r = $("resumen");
  if (planes.length === 0) {
    r.replaceChildren(el("p", { text: "Aún no hay planes. Créalo desde el bot de Telegram con «Nueva dificultad»." }));
    return;
  }
  const lista = el("ul");
  for (const p of planes) {
    for (const d of p.dificultades) {
      lista.append(el("li", { text: `${nombreMes(p.mes)}: ${d.asignatura} · ${d.tema} · ${d.complejidad}` }));
    }
  }
  r.replaceChildren(el("p", { text: "Dificultades en repaso" }), lista);
}

function pintarCalendario() {
  const [a, m] = estado.mes.split("-").map(Number);
  const primero = new Date(Date.UTC(a, m - 1, 1)).getUTCDay();
  const huecos = (primero + 6) % 7; // lunes = 0
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const rejilla = $("rejilla");
  rejilla.replaceChildren();

  for (let i = 0; i < huecos; i++) rejilla.append(el("span", { class: "dia vacio" }));
  for (let d = 1; d <= total; d++) {
    const fecha = `${estado.mes}-${String(d).padStart(2, "0")}`;
    const fichas = estado.dias.get(fecha);
    const clases = ["dia"];
    if (fecha === estado.alumno.hoy) clases.push("hoy");
    if (!fichas) {
      rejilla.append(el("span", { class: clases.join(" "), text: String(d) }));
      continue;
    }
    const impresas = fichas.filter((f) => f.impresa).length;
    clases.push("con-fichas");
    if (impresas === fichas.length) clases.push("completo");
    rejilla.append(el("button", {
      type: "button",
      role: "gridcell",
      class: clases.join(" "),
      "aria-selected": String(fecha === estado.diaSeleccionado),
      "aria-label": `${fechaLarga(fecha)}: ${impresas} de ${fichas.length} fichas impresas`,
      onclick: () => {
        estado.diaSeleccionado = fecha;
        pintarCalendario();
        pintarDetalle();
        $("detalle").focus();
      },
    }, String(d), el("span", { class: "cuenta", text: `${impresas}/${fichas.length}` })));
  }
}

function pintarDetalle() {
  const lista = $("lista");
  const f = estado.diaSeleccionado;
  if (!f) {
    $("dia-titulo").textContent = "Sin fichas este mes";
    lista.replaceChildren(el("p", { class: "vacio-dia", text: "No hay fichas planificadas en este mes. Cambia de mes o crea un plan desde el bot." }));
    return;
  }
  const fichas = estado.dias.get(f) ?? [];
  $("dia-titulo").textContent = fechaLarga(f);
  const porAsignatura = new Map();
  for (const x of fichas) porAsignatura.set(x.asignatura, [...(porAsignatura.get(x.asignatura) ?? []), x]);

  lista.replaceChildren();
  for (const [asignatura, grupo] of porAsignatura) {
    lista.append(el("h3", { text: asignatura }));
    for (const ficha of grupo) lista.append(tarjetaFicha(ficha));
  }
}

function tarjetaFicha(f) {
  const meta = [f.tema, f.complejidad].filter(Boolean).join(" · ");
  const estadoTexto = f.impresa ? `🖨️ Impresa el ${fechaCorta(f.fechaImpresion)}` : "";
  const info = el("div", { class: "ficha-info" },
    el("p", { class: "ficha-titulo", text: f.titulo }),
    el("p", { class: "ficha-meta", text: [meta, estadoTexto].filter(Boolean).join(" · ") }),
  );
  if (!f.descargada) info.append(el("p", { class: "ficha-meta", text: "Sin copia local: se abrirá la web original." }));

  const acciones = el("div", { class: "acciones" },
    el("button", { type: "button", class: "boton secundario", text: "Ver", onclick: () => verFicha(f) }),
    el("button", { type: "button", class: "boton principal", text: "Imprimir", onclick: () => imprimirFicha(f) }),
  );
  if (f.impresa) {
    acciones.append(el("button", { type: "button", class: "boton texto", text: "Desmarcar", onclick: () => desmarcar(f) }));
  }
  return el("article", { class: f.impresa ? "ficha impresa" : "ficha", "aria-label": f.titulo }, info, acciones);
}

// ---------- Visor e impresión ----------

function abrirOriginal(f) {
  if (f.urlOriginal) window.open(f.urlOriginal, "_blank", "noopener,noreferrer");
}

// Resuelve true si el visor cargó el PDF; false si en 4 s no hubo respuesta
// (pasa cuando el navegador está configurado para descargar los PDF en vez de mostrarlos).
function cargarEnVisor(f) {
  return new Promise((resolver) => {
    const marco = $("visor-marco");
    $("visor").hidden = false;
    $("visor-titulo").textContent = f.titulo;
    $("visor-pestana").href = urlPdf(f);
    if (estado.fichaEnVisor?.fichaId === f.fichaId && estado.visorCargado) {
      resolver(true);
      return;
    }
    estado.fichaEnVisor = f;
    estado.visorCargado = false;
    const espera = setTimeout(() => resolver(false), 4000);
    marco.addEventListener("load", () => {
      clearTimeout(espera);
      estado.visorCargado = true;
      resolver(true);
    }, { once: true });
    marco.src = urlPdfEnVisor(f);
  });
}

async function verFicha(f) {
  if (!f.descargada) return abrirOriginal(f);
  await cargarEnVisor(f);
  $("visor").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function imprimirFicha(f) {
  if (!f.descargada) {
    abrirOriginal(f);
  } else {
    const cargado = await cargarEnVisor(f);
    await new Promise((r) => setTimeout(r, 400)); // da tiempo al visor de PDF del navegador
    try {
      if (!cargado) throw new Error("visor sin cargar");
      const w = $("visor-marco").contentWindow;
      w.focus();
      w.print();
    } catch {
      window.open(urlPdf(f), "_blank", "noopener"); // el navegador no deja imprimir el marco: pestaña nueva
    }
  }
  if (await preguntar(`¿Se imprimió bien «${f.titulo}»?`)) await marcar(f, true);
}

function preguntar(texto) {
  return new Promise((resolver) => {
    const d = $("confirmar");
    $("confirmar-texto").textContent = texto;
    const cerrar = (valor) => {
      d.close();
      resolver(valor);
    };
    $("confirmar-si").onclick = () => cerrar(true);
    $("confirmar-no").onclick = () => cerrar(false);
    d.oncancel = () => resolver(false);
    d.showModal();
    $("confirmar-si").focus();
  });
}

async function marcar(f, impresa) {
  mostrarEstado("Guardando…");
  try {
    const nueva = await api(`/api/alumno/${estado.token}/impresa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fichaId: f.fichaId, fecha: f.fecha, impresa }),
    });
    const lista = estado.dias.get(f.fecha) ?? [];
    estado.dias.set(f.fecha, lista.map((x) => (x.fichaId === f.fichaId ? nueva : x)));
    estado.alumno.progreso.impresas += impresa ? 1 : -1;
    mostrarEstado(impresa ? "Marcada como impresa." : "Desmarcada.");
    pintarProgreso();
    pintarCalendario();
    pintarDetalle();
  } catch (e) {
    mostrarEstado(e.message, true);
  }
}

async function desmarcar(f) {
  if (await preguntar(`¿Quitar la marca de impresa a «${f.titulo}»?`)) await marcar(f, false);
}

// ---------- Eventos ----------

$("mes-anterior").addEventListener("click", () => {
  estado.mes = desplazarMes(estado.mes, -1);
  cargarMes();
});
$("mes-siguiente").addEventListener("click", () => {
  estado.mes = desplazarMes(estado.mes, 1);
  cargarMes();
});
$("visor-imprimir").addEventListener("click", () => {
  if (estado.fichaEnVisor) imprimirFicha(estado.fichaEnVisor);
});
$("visor-cerrar").addEventListener("click", () => {
  $("visor").hidden = true;
  $("visor-marco").src = "about:blank";
  estado.fichaEnVisor = null;
  estado.visorCargado = false;
});

iniciar();
