# Profesor de repaso

Bot de Telegram y web local para preparar **fichas PDF de repaso de primaria** (1º a 6º).

Le dices al bot en qué tiene dificultad un alumno: asignatura, tema y nivel. Él busca fichas en PDF por internet, las descarga y reparte un **plan mensual** con 2 o 3 fichas por día. Después abres la web del alumno, ves el calendario y la ficha de cada día, y la imprimes con un botón.

Todo funciona en tu ordenador: no hay servidores externos ni cuentas que crear, aparte de un bot de Telegram propio.

## Qué hace

- **Bot de Telegram guiado por botones**: crear y eliminar alumnos, elegir asignatura → tema → complejidad, y generar el plan del mes eligiendo qué días de la semana.
- **Búsqueda de fichas**: solo PDF. Cada enlace se comprueba, se descarga y se guarda una copia local.
- **Web del alumno**: calendario del mes con colores (días pendientes y días ya impresos), lista de fichas del día, visor de PDF integrado, botón **Imprimir** y marca de ficha impresa.
- **Configuración guiada**: la primera vez, una página te lleva paso a paso para crear tu bot con BotFather y pegar su token.
- **Token protegido**: en Windows se guarda cifrado, solo legible por tu usuario en tu ordenador.

Al planificar, nunca repite fichas que el alumno ya tenga asignadas o impresas. Y nunca inventa enlaces: todo sale del buscador o de `datos/fuentes.json`.

## Usarlo en Windows (sin instalar nada)

1. Descarga `profesor-repaso-windows.zip` de la sección **Releases** de este repositorio y descomprímelo.
2. Haz doble clic en `profesor-repaso.exe`.
   - Windows puede avisar de «editor desconocido» porque el programa no está firmado: pulsa **Más información → Ejecutar de todas formas**.
   - Se abre una ventana negra con mensajes. **Mientras esté abierta, el bot y la web funcionan.** Para parar, ciérrala.
3. La primera vez se abre en el navegador la página **Configurar Profesor de repaso**:
   1. Pulsa **Abrir BotFather** (el bot oficial de Telegram para crear bots).
   2. Envíale `/newbot`, elige un nombre y un nombre de usuario que termine en `bot`.
   3. Copia el token que te devuelve, pégalo en la página y pulsa **Guardar y conectar**.
4. Se abre el chat de tu bot. Pulsa **Iniciar**: verás las normas de uso y el menú.

Las siguientes veces, al abrir el programa irá directo a tu bot.

Todo lo que crea el programa (alumnos, planes, PDF) se guarda en su propia carpeta, dentro de `datos/`. Para hacer copia de seguridad, copia esa carpeta.

## Normas de uso

Las fichas se buscan con un buscador gratuito (DuckDuckGo). **Si recibe muchas búsquedas seguidas, las bloquea durante un rato.** Para evitarlo:

- Genera un plan, espera unos minutos y luego el siguiente.
- Pon pocas dificultades por plan (1 o 2). Cada dificultad nueva es una búsqueda.
- Si el bot dice «El buscador no ha respondido», espera al menos media hora. Insistir alarga el bloqueo.
- Los temas ya buscados se guardan 30 días y no gastan búsquedas nuevas.

El bot muestra estas normas al escribir `/start` y desde **Ayuda → Normas de uso**.

## Abrir la web desde el móvil

La web se sirve desde tu ordenador, así que el móvil tiene que estar **en la misma wifi** y el ordenador encendido con el programa abierto.

1. En Windows, marca tu wifi como **red privada**: Configuración → Red e Internet → Wi-Fi → tu red → Perfil de red: **Privada**.
2. Abre el puerto 3000 solo para redes privadas. En PowerShell como administrador:
   ```powershell
   New-NetFirewallRule -DisplayName "Profesor de repaso" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
   ```
3. Averigua la IP del ordenador con `ipconfig` (por ejemplo `192.168.1.20`). En el archivo `.env` de la carpeta del programa, pon `URL_BASE=http://192.168.1.20:3000` y vuelve a abrir el programa.
4. En el móvil, abre el bot → **Mis alumnos** → alumno → **Abrir ficha del alumno**.

Telegram no admite enlaces a `localhost` ni a una IP, así que el bot los escribe como `http://<ip>.nip.io:3000`. nip.io es un servicio público de nombres que devuelve esa misma IP. Si esa dirección no carga, es que tu router bloquea ese tipo de nombres.

Fuera de casa, el botón **Ver plan** del bot envía los enlaces de las fichas por Telegram.

## Privacidad y seguridad

- **El token del bot es como su contraseña.** No lo compartas. Si crees que alguien lo tiene, en BotFather usa `/revoke` y vuelve a configurar el programa.
- **Si pasas el programa a otra persona**, dale el `.zip` de Releases o tu carpeta **sin** el archivo `.env` y **sin** `datos/` (salvo `catalogo.json` y `fuentes.json`). Que cree su propio bot: dos ordenadores no pueden usar el mismo.
- **El token se cifra con Windows (DPAPI)**: en `.env` aparece como `TELEGRAM_TOKEN=dpapi:…`. Copiado a otro ordenador o a otro usuario no sirve. Si reinstalas Windows, el programa te pedirá configurarlo de nuevo (BotFather → `/mybots` → tu bot → **API Token**).
- **La página de configuración** solo responde desde el propio ordenador y solo mientras no haya un bot válido.
- **Cada alumno tiene un enlace secreto aleatorio.** Si se comparte por error, usa **Regenerar enlace** en el bot y el anterior deja de funcionar.
- **Cada usuario de Telegram solo ve sus propios alumnos.** Pero cualquiera que encuentre el nombre de tu bot puede usarlo para sus búsquedas.
- **Las descargas** solo se hacen desde direcciones públicas de internet (nunca desde tu ordenador o tu red), con un máximo de 15 MB, y el archivo tiene que ser un PDF de verdad.

## Para desarrolladores

### Requisitos

- Node.js 22 o superior.
- Windows para generar el ejecutable y para el cifrado del token. En macOS y Linux funciona con `npm start`, con el token sin cifrar.

### Comandos

```bash
npm install
npm test        # compila y ejecuta los tests
npm start       # arranca web + bot (lee .env)
npm run exe     # genera ejecutable/ y ejecutable/profesor-repaso-windows.zip
```

Con `npm start`, si no hay token se puede configurar en `http://localhost:3000/configurar`.

### Estructura

| Ruta | Contenido |
| --- | --- |
| `src/servidor.ts` | Servidor web, API, visor de PDF, configuración y arranque |
| `src/telegram.ts` | Bot de Telegram (long polling, pantallas y botones, normas) |
| `src/busqueda.ts` | Buscador (DuckDuckGo) y validación de los PDF |
| `src/descargas.ts`, `src/red.ts` | Descargas seguras (solo IPs públicas, también tras redirecciones) |
| `src/planificador.ts` | Reparto de fichas por días (lógica pura y determinista) |
| `src/servicio.ts` | Une búsqueda, caché, plan y descargas |
| `src/almacen.ts` | Datos en JSON con escritura atómica |
| `src/entorno.ts` | Archivo `.env` y cifrado del token con DPAPI |
| `public/` | Web del alumno y página de configuración |
| `datos/catalogo.json` | Asignaturas y temas por grado |
| `scripts/exe.mjs` | Generación del ejecutable de Windows |
| `tests/` | Tests con `node:test` |

Las rutas de la web están documentadas en [API.md](API.md).

### Configuración (`.env`)

Ver [.env.example](.env.example). Lo principal:

| Variable | Para qué |
| --- | --- |
| `TELEGRAM_TOKEN` | Token del bot. Lo rellena la página de configuración. |
| `URL_BASE` | Dirección de la web en los enlaces del bot (para el móvil, la IP del ordenador). |
| `PUERTO`, `HOST` | Puerto y dirección donde escucha el servidor. |
| `ABRIR_TELEGRAM` | `no` para que el ejecutable no abra el chat del bot al arrancar. |

### Ajustes del contenido

- `src/config.ts`: fichas por día según la complejidad (básico 2, medio 3, avanzado 3) y días por defecto (lunes a viernes).
- `datos/catalogo.json`: base orientativa del currículo de primaria en España. Revisa los temas y añade asignaturas si hace falta. El código de cada asignatura son de 2 a 6 letras minúsculas.
- `datos/fuentes.json`: lista opcional de dominios de confianza, que se buscan primero.

### Otro buscador

1. En `src/busqueda.ts`, crea una clase que implemente `ProveedorBusqueda` (`buscar(consulta, n)` devuelve `{ url, titulo }[]`).
2. Añade su nombre en `crearProveedor`.
3. Pon `PROVEEDOR_BUSQUEDA=<nombre>` en `.env`.

## Limitaciones conocidas

- **El ordenador tiene que estar encendido** con el programa abierto para que el bot responda.
- **Imprimir** usa el visor de PDF del navegador. Si el navegador está configurado para descargar los PDF, se abren en una pestaña nueva y se imprimen desde allí.
- **La marca de impresa la confirma la persona** («¿Se imprimió bien?»): el navegador no puede saber si la impresora terminó.
- **Un tema puede tener menos fichas** de las que pide el mes. En ese caso el plan se recorta y el bot avisa.
- **El ejecutable es solo para Windows** y no está firmado.
