# Inscripciones

Microservicio de **Inscripciones** del laboratorio de Sistemas Distribuidos, desarrollado con Node.js, Express y MongoDB (Mongoose).

Gestiona las inscripciones de estudiantes a cursos, junto con sus notas y el historial de cambios de estado.

> **Regla clave:** `estudianteId` y `cursoId` son **solo textos** (`String`), **no llaves foráneas**. Pertenecen a otros microservicios, por lo que este servicio no los valida contra otra base de datos ni los referencia con `ObjectId`.

## Requisitos

- Node.js 18 o superior
- Una instancia de MongoDB (local o MongoDB Atlas)

## Instalación

```bash
npm install
```

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
PORT=3003
MONGO_URI=mongodb://localhost:27017/inscripciones_db
```

| Variable    | Descripción                                             |
|-------------|---------------------------------------------------------|
| `PORT`      | Puerto del servidor (por defecto `3003`).               |
| `MONGO_URI` | Cadena de conexión a MongoDB (local o Atlas `mongodb+srv://...`). |

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
