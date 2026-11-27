# Inscripciones

Microservicio de **Inscripciones** del laboratorio de Sistemas Distribuidos, desarrollado con Node.js, Express y PostgreSQL (Prisma ORM).

Gestiona las inscripciones de estudiantes a cursos, junto con sus notas y el historial de cambios de estado.

> **Regla clave:** `estudianteId` y `cursoId` son **solo textos** (`VARCHAR`), **sin llave foránea**. Pertenecen a otros microservicios, por lo que no hay FK hacia otra base de datos: al **crear** una inscripción se validan llamando por HTTP a Estudiantes y Materias (ver [Consistencia con Materias](#consistencia-con-materias-cupos)). Las únicas llaves foráneas son internas: `notas` e `historial_estados` → `inscripciones` (con borrado en cascada).

## Requisitos

- Node.js 24 (usa `fetch` y `AbortSignal.timeout` nativos)
- PostgreSQL 16 (local con `docker compose up -d`, o AWS RDS)

## Instalación

```bash
npm install                 # también genera el cliente de Prisma
cp .env.example .env        # completar credenciales
docker compose up -d        # PostgreSQL local en el puerto 5435
npm run db:deploy           # aplica prisma/migrations (npx prisma migrate deploy)
```

## Variables de entorno

| Variable       | Descripción                                             |
|----------------|---------------------------------------------------------|
| `PORT`         | Puerto del servidor (por defecto `3003`).               |
| `DATABASE_URL` | Cadena de conexión PostgreSQL. En RDS agregar `&sslmode=require`. |
| `ESTUDIANTES_URL` | URL base del módulo Estudiantes, sin `/` final (local: `http://localhost:3001`). Llamada **directa**, no por el Gateway. |
| `MATERIAS_URL` | URL base del módulo Materias, sin `/` final (local: `http://localhost:3002`). Llamada **directa**, no por el Gateway. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Solo para el contenedor local de `docker-compose.yml`. |

Si falta `ESTUDIANTES_URL` o `MATERIAS_URL` el servicio arranca con una advertencia, pero `POST /api/inscripciones` responderá `503`.

## Modelo relacional

| Tabla | Columnas principales |
|---|---|
| `inscripciones` | `id` (PK, 24 hex), `estudiante_id`, `curso_id`, `periodo`, `estado`, `idempotency_key` (UNIQUE, nullable), `created_at`, `updated_at`. UNIQUE `uq_insc` (`estudiante_id`, `curso_id`) |
| `notas` | `id` (PK), `inscripcion_id` (FK → inscripciones, cascada), `tipo`, `valor`, timestamps |
| `historial_estados` | `id` (PK), `inscripcion_id` (FK → inscripciones, cascada), `estado_anterior`, `estado_nuevo`, `motivo`, timestamps |

Los ids conservan el formato de ObjectId (24 caracteres hex) y las respuestas
mantienen el JSON de la versión con MongoDB (`_id`, `__v`, `id`, `notas`, `historial`),
de modo que el API Gateway y el frontend no requieren cambios.

## Ejecución

```bash
# Desarrollo (reinicia con nodemon)
npm run dev

# Producción
npm start
```

El servicio queda disponible en `http://localhost:3003`.

## Documentación (Swagger)

Con el servidor corriendo, abre:

**http://localhost:3003/api-docs**

## Endpoints

Base: `/api/inscripciones`

| Método   | Ruta              | Descripción                                            |
|----------|-------------------|--------------------------------------------------------|
| `POST`   | `/`               | Crear una inscripción (valida en Estudiantes/Materias y reserva cupo). Acepta `Idempotency-Key` |
| `GET`    | `/`               | Listar con filtros, ordenamiento y paginación          |
| `GET`    | `/:id`            | Obtener por ID (con notas e historial)                 |
| `PUT`    | `/:id`            | Actualizar datos básicos (no permite cambiar `estudianteId` ni `cursoId`) |
| `DELETE` | `/:id`            | **Cancelar** (no borra): estado `cancelada` + historial, y libera el cupo |
| `POST`   | `/:id/notas`      | Agregar una nota                                       |
| `POST`   | `/:id/historial`  | Registrar un cambio de estado (`cancelada` libera el cupo) |

El `GET /` acepta los query params `pageNumber`, `pageSize`, `sortBy`, `sortDirection`, `estudianteId`, `cursoId` y `periodo`.

Todas las respuestas de error tienen la forma `{ "message": "...", "errorType": "..." }` y el `errorType` también se deja en `res.locals.errorType` para el middleware del datalake.

## Consistencia con Materias (cupos)

Los cupos viven en el módulo Materias (Java, otra base). Como no hay una transacción común
entre las dos bases, el `POST /api/inscripciones` sigue este orden:

1. **Validar el body** → `400 ValidacionFallida`.
2. **Idempotencia**: si llega `Idempotency-Key` y ya hay una inscripción con esa clave → `201`
   con esa misma inscripción y el encabezado `Idempotent-Replayed: true` (no crea nada ni toca cupos).
   Si la clave existe con otro `estudianteId`/`cursoId` → `422 IdempotencyKeyReutilizada`.
3. **Validar al escribir** (en paralelo, `GET` directo a cada módulo, timeout 2 s y 1 reintento ante timeout/error de red):
   - Estudiante: `404` → `422 EstudianteNoExiste`; no `ACTIVO` → `422 EstudianteInactivo`.
   - Curso: `404` → `422 CursoNoExiste`; no `ACTIVO` → `422 CursoInactivo`.
   - Sin respuesta o `5xx` → `503 ServicioNoDisponible` (el mensaje dice cuál módulo). Nunca `500`.
4. **Duplicados**: si el estudiante ya tiene una inscripción activa en el curso → `409 InscripcionDuplicada`.
   Si la tiene `cancelada`, se **reactiva esa misma fila** (no se crea otra).
5. **Reservar el cupo** en Materias (`POST .../reservar-cupo`, operación atómica, **sin reintento**):
   `409` → `409 CupoAgotado`; `404`/`422` → `422` con el `errorType` de Materias;
   sin respuesta → `503` y se registra `ReservaIncierta` en el log.
6. **Guardar** (o reactivar en una transacción con su registro de historial). Si falla, se
   **compensa** llamando a `liberar-cupo`:
   - `P2002` por `idempotency_key` (petición concurrente con la misma clave) → `201` réplica como en el paso 2.
   - `P2002` por `uq_insc` → `409 InscripcionDuplicada`.
   - Cualquier otro fallo → `503`.
   - Si `liberar-cupo` también falla se registra `CompensacionFallida`.
7. `201` con la inscripción.

`reservar-cupo` y `liberar-cupo` **no se reintentan** automáticamente: no son idempotentes y un
reintento tras un timeout podría descontar (o devolver) el cupo dos veces.

**Cancelar** (`DELETE /:id`, `PUT` con `estado: 'cancelada'` o `POST /:id/historial` con
`estadoNuevo: 'cancelada'`): en una transacción se pone `estado = 'cancelada'` y se crea el
historial; luego se llama a `liberar-cupo`. La respuesta incluye `cupoLiberado: true|false`
(`false` + log `CompensacionFallida` si Materias no lo devolvió). Si ya estaba cancelada responde
`200` sin volver a liberar. Una inscripción cancelada no se reactiva por `PUT` ni por historial
(`422 CambioNoPermitido`): se usa `POST /api/inscripciones`, que sí reserva cupo.

**Cambiar de curso**: `PUT` no permite cambiar `estudianteId` ni `cursoId` (`422 CambioNoPermitido`).
Hay que cancelar la inscripción e inscribir de nuevo.

### Eventos del log que requieren revisión manual

Se escriben en `stderr` como una línea JSON (búscalos por `"evento"`):

| Evento | Qué significa | Qué hacer |
|---|---|---|
| `ReservaIncierta` | `reservar-cupo` no respondió (o respondió 5xx): no se sabe si Materias descontó el cupo. Trae `estudianteId`, `cursoId`, `idempotencyKey`. | Comparar `cupoDisponible` del curso con las inscripciones activas; si sobra un descuento, llamar a `liberar-cupo`. Si el cliente reintenta con la misma clave, no se duplica la inscripción. |
| `CompensacionFallida` | Había que devolver un cupo y `liberar-cupo` falló. Trae `cursoId`, `estudianteId`/`inscripcionId`, el motivo y la `accionManual`. | Ejecutar `POST {MATERIAS_URL}/api/materias/cursos/{cursoId}/liberar-cupo` una vez. |

## Migración de consistencia

La migración `prisma/migrations/20261126120000_consistencia_cupos` agrega `idempotency_key`
(UNIQUE) y el UNIQUE `uq_insc` sobre (`estudiante_id`, `curso_id`).

**Antes de aplicarla**, busca duplicados existentes:

```sql
SELECT estudiante_id,
       curso_id,
       COUNT(*)                                  AS filas,
       array_agg(id     ORDER BY created_at)     AS ids,
       array_agg(estado ORDER BY created_at)     AS estados
  FROM inscripciones
 GROUP BY estudiante_id, curso_id
HAVING COUNT(*) > 1
 ORDER BY filas DESC;
```

Si devuelve filas, la migración **falla a propósito** con el mensaje
`Migracion consistencia_cupos abortada: hay inscripciones duplicadas...` y **no borra nada**
(todo el script es una sola transacción: no queda nada a medias). Para continuar:

1. Decide a mano qué fila conservar en cada caso (por ejemplo, la que tiene notas) y elimina o
   fusiona las demás. Revisa también el cupo en Materias si había inscripciones dobles.
2. Marca la migración fallida como revertida: `npx prisma migrate resolve --rolled-back 20261126120000_consistencia_cupos`
3. Vuelve a aplicarla: `npm run db:deploy`

## Pruebas

```bash
npm test
```

Usa `node:test` sin base de datos ni otros módulos: Prisma se reemplaza por uno en memoria
(`test/helpers/fakePrisma.js`, que reproduce los índices únicos y `P2002`) y Estudiantes y
Materias por servidores HTTP falsos (`test/helpers/fakeModulos.js`).

## Prueba de concurrencia: último cupo (`scripts/prueba_ultimo_cupo.py`)

Lanza 20 `POST /api/inscripciones` simultáneos **por el Gateway**, cada uno con su propia
`Idempotency-Key`, contra un curso con cupo 1. Esperado: `1 x 201`, `19 x 409` y
`cupoDisponible` final `0` (nunca negativo).

**Requisitos**: Python 3 y `pip install requests`. Gateway, Estudiantes, Materias e Inscripciones
levantados, y un JWT de admin (`POST {gateway}/api/auth/login`).

**1. Preparar un curso con cupo 1** (por el Gateway, como admin; usa una materia y un docente existentes):

```bash
curl -X POST http://localhost:3000/api/materias/cursos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"materiaId":1,"docenteId":1,"horario":"Lunes 8:00-10:00","periodo":"2026-2",
       "cupo":1,"aula":"Aula 101","modalidad":"PRESENCIAL","estado":"ACTIVO"}'
```

Anota el `id` devuelto y comprueba que `GET /api/materias/cursos/{id}` muestre `cupoDisponible: 1`.
Usa un curso nuevo en cada corrida (o cancela la inscripción ganadora para devolver el cupo).

**2. Archivo de estudiantes**: 20 ids de estudiantes **ACTIVOS** distintos, uno por línea
(las líneas vacías y las que empiezan con `#` se ignoran), sin inscripción previa en ese curso.

**3. Ejecutar**:

```bash
python scripts/prueba_ultimo_cupo.py --gateway-url http://localhost:3000 --token "$TOKEN" \
  --curso-id 7 --estudiantes estudiantes.txt --periodo 2026-2
```

Imprime el conteo por código HTTP, los `errorType` de las rechazadas y el `cupoDisponible` final.
Sale con código `0` si todo coincide con lo esperado y `1` si no.

**Modo idempotencia**: envía 2 veces la misma inscripción con la misma clave (usa el primer
estudiante del archivo; elige uno sin inscripción en el curso, y un curso con cupo libre) y verifica
que haya **1 sola fila**, que el cupo se descuente una sola vez y que el 2.º envío sea la réplica (`Idempotent-Replayed: true`; con `--simultaneo`, exactamente uno de los dos). Si falta el encabezado, la prueba falla (exit 1).
Con `--simultaneo` los dos envíos salen a la vez (prueba el camino de la compensación por `P2002`).

```bash
python scripts/prueba_ultimo_cupo.py --gateway-url http://localhost:3000 --token "$TOKEN" \
  --curso-id 8 --estudiantes estudiantes.txt --periodo 2026-2 --idempotencia [--simultaneo]
```

> El modo idempotencia exige que el Gateway reenvíe el encabezado `Idempotency-Key` al módulo
> (y devuelva `Idempotent-Replayed`). Si no lo hace, el 2.º envío llega sin clave, recibe
> `409 InscripcionDuplicada` y la prueba falla (exit 1) indicando la causa probable.

## Nota de integración

El endpoint `GET /api/inscripciones` devuelve las **notas anidadas** en cada inscripción (campo `notas`), para que el API Gateway pueda obtener todo en una sola consulta filtrando por `estudianteId`, sin peticiones adicionales.
