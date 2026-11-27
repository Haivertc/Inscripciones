const { Router } = require('express');
const {
  createInscripcion,
  getAllInscripciones,
  getInscripcionById,
  updateInscripcion,
  deleteInscripcion,
  addNota,
  addHistorial,
  getNotaById,
  updateNota,
  deleteNota,
  getHistorialById,
  updateHistorial,
  deleteHistorial,
} = require('../controllers/inscripciones.controller');

const router = Router();

/**
 * @openapi
 * /api/inscripciones:
 *   get:
 *     summary: Lista inscripciones con filtros, orden y paginación (incluye notas)
 *     tags: [Inscripciones]
 *     parameters:
 *       - in: query
 *         name: pageNumber
 *         schema: { type: integer, default: 1, minimum: 1 }
 *         description: Número de página
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10, minimum: 1, maximum: 100 }
 *         description: Registros por página (máximo 100)
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: createdAt
 *           enum: [createdAt, updatedAt, estudianteId, cursoId, periodo, estado]
 *         description: Campo de ordenamiento
 *       - in: query
 *         name: sortDirection
 *         schema: { type: string, default: desc, enum: [asc, desc] }
 *         description: Dirección del ordenamiento
 *       - in: query
 *         name: estudianteId
 *         schema: { type: string }
 *         description: Filtra por ID de estudiante
 *       - in: query
 *         name: cursoId
 *         schema: { type: string }
 *         description: Filtra por ID de curso
 *       - in: query
 *         name: periodo
 *         schema: { type: string, example: '2026-2' }
 *         description: Filtra por periodo
 *     responses:
 *       200:
 *         description: Lista paginada de inscripciones
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Inscripcion' }
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     page: { type: integer }
 *                     totalPages: { type: integer }
 *                     pageSize: { type: integer }
 *       500:
 *         description: Error interno del servidor
 *   post:
 *     summary: Crea una inscripción (valida estudiante y curso, y reserva el cupo en Materias)
 *     description: |
 *       Orden: validar body → idempotencia → validar estudiante (Estudiantes) y curso (Materias)
 *       → duplicados → reservar cupo (Materias) → guardar. Si el guardado falla, se libera el
 *       cupo (compensación). Si el estudiante tenía una inscripción **cancelada** en el curso,
 *       se reactiva esa misma fila.
 *     tags: [Inscripciones]
 *     parameters:
 *       - $ref: '#/components/parameters/IdempotencyKey'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [estudianteId, cursoId, periodo]
 *             properties:
 *               estudianteId: { type: string, example: '1001' }
 *               cursoId: { type: string, example: 'MAT-101' }
 *               periodo: { type: string, example: '2026-2' }
 *     responses:
 *       201:
 *         description: Inscripción creada, reactivada o (con la misma Idempotency-Key) la ya existente
 *         headers:
 *           Idempotent-Replayed:
 *             description: "'true' cuando la respuesta es la réplica de una petición anterior con la misma clave"
 *             schema: { type: string, example: 'true' }
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Inscripcion' }
 *       400:
 *         $ref: '#/components/responses/Error400'
 *       409:
 *         description: CupoAgotado (sin cupos en el curso) o InscripcionDuplicada (el estudiante ya está inscrito)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *             examples:
 *               cupo: { value: { message: 'El curso MAT-101 no tiene cupos disponibles', errorType: CupoAgotado } }
 *               duplicada: { value: { message: 'El estudiante ya está inscrito en este curso', errorType: InscripcionDuplicada } }
 *       422:
 *         description: EstudianteNoExiste, EstudianteInactivo, CursoNoExiste, CursoInactivo o IdempotencyKeyReutilizada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *             example: { message: 'El estudiante 1001 no está ACTIVO', errorType: EstudianteInactivo }
 *       503:
 *         $ref: '#/components/responses/Error503'
 */
router.post('/', createInscripcion);
router.get('/', getAllInscripciones);

/**
 * @openapi
 * /api/inscripciones/{id}:
 *   get:
 *     summary: Obtiene una inscripción por ID (incluye notas e historial)
 *     tags: [Inscripciones]
 *     parameters:
 *       - $ref: '#/components/parameters/InscripcionId'
 *     responses:
 *       200:
 *         description: Inscripción encontrada con sus notas e historial
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Inscripcion' }
 *       404:
 *         description: Inscripción no encontrada
 *       500:
 *         description: Error interno del servidor
 *   put:
 *     summary: Actualiza los datos básicos de una inscripción
 *     description: |
 *       estudianteId y cursoId no se pueden cambiar (se saltaría el control de cupos); se aceptan
 *       solo si llegan con el mismo valor. Para cambiar de curso: cancelar (DELETE) e inscribir (POST).
 *       estado='cancelada' aplica la misma lógica que DELETE (historial + liberar cupo; la respuesta
 *       incluye cupoLiberado). Una inscripción cancelada no se reactiva por PUT: usar POST.
 *     tags: [Inscripciones]
 *     parameters:
 *       - $ref: '#/components/parameters/InscripcionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               estudianteId: { type: string, example: '1001', description: 'Solo el valor actual' }
 *               cursoId: { type: string, example: 'MAT-101', description: 'Solo el valor actual' }
 *               periodo: { type: string, example: '2026-2' }
 *               estado: { type: string, example: 'retirada' }
 *     responses:
 *       200:
 *         description: Inscripción actualizada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Inscripcion' }
 *       400:
 *         $ref: '#/components/responses/Error400'
 *       404:
 *         $ref: '#/components/responses/Error404'
 *       422:
 *         description: CambioNoPermitido (cambio de estudianteId/cursoId, o reactivar una cancelada)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       500:
 *         $ref: '#/components/responses/Error500'
 *   delete:
 *     summary: Cancela una inscripción (no la borra) y libera su cupo en Materias
 *     description: |
 *       Cambia el estado a 'cancelada' y registra el historial en una transacción; luego llama
 *       a liberar-cupo. Las notas y el historial se conservan. Si ya estaba cancelada responde
 *       200 sin volver a liberar.
 *     tags: [Inscripciones]
 *     parameters:
 *       - $ref: '#/components/parameters/InscripcionId'
 *     responses:
 *       200:
 *         description: Inscripción cancelada (cupoLiberado indica si Materias devolvió el cupo)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Cancelacion' }
 *       404:
 *         $ref: '#/components/responses/Error404'
 *       500:
 *         $ref: '#/components/responses/Error500'
 */
router.get('/:id', getInscripcionById);
router.put('/:id', updateInscripcion);
router.delete('/:id', deleteInscripcion);

/**
 * @openapi
 * /api/inscripciones/{id}/notas:
 *   post:
 *     summary: Agrega una nota a una inscripción
 *     tags: [Notas]
 *     parameters:
 *       - $ref: '#/components/parameters/InscripcionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tipo, valor]
 *             properties:
 *               tipo: { type: string, example: 'Parcial 1' }
 *               valor: { type: number, example: 4.5 }
 *     responses:
 *       201:
 *         description: Nota creada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Nota' }
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Inscripción no encontrada
 *       500:
 *         description: Error interno del servidor
 */
router.post('/:id/notas', addNota);

/**
 * @openapi
 * /api/inscripciones/{id}/historial:
 *   post:
 *     summary: Registra un cambio de estado en el historial y actualiza el estado de la inscripción
 *     description: |
 *       Con estadoNuevo 'cancelada' sigue la misma lógica que DELETE: libera el cupo y la respuesta
 *       incluye cupoLiberado; si ya estaba cancelada responde 200 (Cancelacion) sin liberar otra vez.
 *       Sobre una inscripción cancelada, cualquier otro estadoNuevo -> 422 CambioNoPermitido
 *       (para reactivar se usa POST /api/inscripciones, que reserva cupo).
 *     tags: [Historial]
 *     parameters:
 *       - $ref: '#/components/parameters/InscripcionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [estadoNuevo]
 *             properties:
 *               estadoAnterior: { type: string, example: 'activa' }
 *               estadoNuevo: { type: string, example: 'retirada' }
 *               motivo: { type: string, example: 'Solicitud del estudiante' }
 *     responses:
 *       200:
 *         description: La inscripción ya estaba cancelada (no se liberó cupo de nuevo)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Cancelacion' }
 *       201:
 *         description: Registro de historial creado (con cupoLiberado si estadoNuevo es 'cancelada')
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HistorialEstado' }
 *       400:
 *         $ref: '#/components/responses/Error400'
 *       404:
 *         $ref: '#/components/responses/Error404'
 *       422:
 *         description: CambioNoPermitido (reactivar una inscripción cancelada)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       500:
 *         $ref: '#/components/responses/Error500'
 */
router.post('/:id/historial', addHistorial);

/**
 * @openapi
 * /api/inscripciones/notas/{id}:
 *   get:
 *     summary: Obtiene una nota por su ID
 *     tags: [Notas]
 *     parameters:
 *       - $ref: '#/components/parameters/NotaId'
 *     responses:
 *       200:
 *         description: Nota encontrada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Nota' }
 *       404:
 *         description: Nota no encontrada
 *       500:
 *         description: Error interno del servidor
 *   put:
 *     summary: Actualiza una nota por su ID
 *     tags: [Notas]
 *     parameters:
 *       - $ref: '#/components/parameters/NotaId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tipo: { type: string, example: 'Parcial 1' }
 *               valor: { type: number, example: 4.5 }
 *     responses:
 *       200:
 *         description: Nota actualizada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Nota' }
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Nota no encontrada
 *       500:
 *         description: Error interno del servidor
 *   delete:
 *     summary: Elimina una nota por su ID
 *     tags: [Notas]
 *     parameters:
 *       - $ref: '#/components/parameters/NotaId'
 *     responses:
 *       200:
 *         description: Nota eliminada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: 'Nota eliminada correctamente' }
 *       404:
 *         description: Nota no encontrada
 *       500:
 *         description: Error interno del servidor
 */
router.get('/notas/:id', getNotaById);
router.put('/notas/:id', updateNota);
router.delete('/notas/:id', deleteNota);

/**
 * @openapi
 * /api/inscripciones/historial/{id}:
 *   get:
 *     summary: Obtiene un registro de historial por su ID
 *     tags: [Historial]
 *     parameters:
 *       - $ref: '#/components/parameters/HistorialId'
 *     responses:
 *       200:
 *         description: Registro de historial encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HistorialEstado' }
 *       404:
 *         description: Registro de historial no encontrado
 *       500:
 *         description: Error interno del servidor
 *   put:
 *     summary: Actualiza un registro de historial por su ID
 *     tags: [Historial]
 *     parameters:
 *       - $ref: '#/components/parameters/HistorialId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               estadoAnterior: { type: string, example: 'activa' }
 *               estadoNuevo: { type: string, example: 'retirada' }
 *               motivo: { type: string, example: 'Solicitud del estudiante' }
 *     responses:
 *       200:
 *         description: Registro de historial actualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HistorialEstado' }
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Registro de historial no encontrado
 *       500:
 *         description: Error interno del servidor
 *   delete:
 *     summary: Elimina un registro de historial por su ID
 *     tags: [Historial]
 *     parameters:
 *       - $ref: '#/components/parameters/HistorialId'
 *     responses:
 *       200:
 *         description: Registro de historial eliminado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: 'Registro de historial eliminado correctamente' }
 *       404:
 *         description: Registro de historial no encontrado
 *       500:
 *         description: Error interno del servidor
 */
router.get('/historial/:id', getHistorialById);
router.put('/historial/:id', updateHistorial);
router.delete('/historial/:id', deleteHistorial);

module.exports = router;
