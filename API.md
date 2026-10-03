# API

Respuestas JSON con la forma `{ ok, datos?, error? }`. `<token>` es el enlace personal del alumno.

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/salud` | Estado del servidor y de la conexión con Telegram |
| GET | `/api/alumno/<token>` | Nombre, grado, planes, meses con fichas y progreso |
| GET | `/api/alumno/<token>/mes/<AAAA-MM>` | Fichas del mes agrupadas por día |
| POST | `/api/alumno/<token>/impresa` | Marca o desmarca `{ fichaId, fecha, impresa }` |
| GET | `/pdf/<token>/<fichaId>` | Copia local del PDF (solo fichas de ese alumno) |
| GET | `/a/<token>` | La web del alumno |

## Ejemplos

```bash
curl http://localhost:3000/api/salud
# {"ok":true,"datos":{"servidor":true,"telegram":{"conectado":true,"usuarioBot":"mi_bot"}}}

curl http://localhost:3000/api/alumno/TOKEN/mes/2026-11
# {"ok":true,"datos":{"mes":"2026-11","dias":[{"fecha":"2026-11-02","fichas":[{"fichaId":"…","titulo":"…","asignatura":"Matemáticas","impresa":false,…}]}]}}

curl -X POST http://localhost:3000/api/alumno/TOKEN/impresa \
  -H "Content-Type: application/json" \
  -d '{"fichaId":"0123456789abcdef","fecha":"2026-11-02","impresa":true}'
```

## Errores
| Código | Cuándo |
| --- | --- |
| 400 | Token, mes, fecha o cuerpo con formato no válido |
| 403 | POST desde otra web (cabecera `Origin` distinta) |
| 404 | Enlace inexistente o regenerado, ficha fuera del plan, PDF no descargado |
