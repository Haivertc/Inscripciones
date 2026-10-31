# Inscripciones

Microservicio de **Inscripciones** del laboratorio de Sistemas Distribuidos, desarrollado con Node.js, Express y PostgreSQL (Prisma ORM).

Gestiona las inscripciones de estudiantes a cursos, junto con sus notas y el historial de cambios de estado.

> **Regla clave:** `estudianteId` y `cursoId` son **solo textos** (`VARCHAR`), **sin llave foránea**. Pertenecen a otros microservicios, por lo que este servicio no los valida contra otra base de datos. Las únicas llaves foráneas son internas: `notas` e `historial_estados` → `inscripciones` (con borrado en cascada).

## Requisitos

- Node.js 18 o superior
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
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Solo para el contenedor local de `docker-compose.yml`. |

## Modelo relacional

| Tabla | Columnas principales |
|---|---|
| `inscripciones` | `id` (PK, 24 hex), `estudiante_id`, `curso_id`, `periodo`, `estado`, `created_at`, `updated_at` |
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
| `POST`   | `/`               | Crear una inscripción                                  |
| `GET`    | `/`               | Listar con filtros, ordenamiento y paginación          |
| `GET`    | `/:id`            | Obtener por ID (con notas e historial)                 |
| `PUT`    | `/:id`            | Actualizar datos básicos                               |
| `DELETE` | `/:id`            | Eliminar (junto con sus notas e historial)             |
| `POST`   | `/:id/notas`      | Agregar una nota                                       |
| `POST`   | `/:id/historial`  | Registrar un cambio de estado y actualizar la inscripción |

El `GET /` acepta los query params `pageNumber`, `pageSize`, `sortBy`, `sortDirection`, `estudianteId`, `cursoId` y `periodo`.

## Nota de integración

El endpoint `GET /api/inscripciones` devuelve las **notas anidadas** en cada inscripción (campo `notas`), para que el API Gateway pueda obtener todo en una sola consulta filtrando por `estudianteId`, sin peticiones adicionales.
