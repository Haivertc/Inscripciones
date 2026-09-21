const { Router } = require('express');
const {
  createInscripcion,
  getAllInscripciones,
  getInscripcionById,
  updateInscripcion,
  deleteInscripcion,
  addNota,
  addHistorial,
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
 *     summary: Crea una inscripción
 *     tags: [Inscripciones]
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
 *         description: Inscripción creada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Inscripcion' }
 *       400:
 *         description: Datos inválidos
 *       500:
 *         description: Error interno del servidor
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
 *               estudianteId: { type: string, example: '1001' }
 *               cursoId: { type: string, example: 'MAT-101' }
 *               periodo: { type: string, example: '2026-2' }
 *               estado: { type: string, example: 'retirada' }
 *     responses:
 *       200:
 *         description: Inscripción actualizada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Inscripcion' }
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Inscripción no encontrada
 *       500:
 *         description: Error interno del servidor
 *   delete:
 *     summary: Elimina una inscripción junto con sus notas e historial
 *     tags: [Inscripciones]
 *     parameters:
 *       - $ref: '#/components/parameters/InscripcionId'
 *     responses:
 *       200:
 *         description: Inscripción eliminada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: 'Inscripción eliminada correctamente' }
 *       404:
 *         description: Inscripción no encontrada
 *       500:
 *         description: Error interno del servidor
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
 *       201:
 *         description: Registro de historial creado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HistorialEstado' }
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Inscripción no encontrada
 *       500:
 *         description: Error interno del servidor
 */
router.post('/:id/historial', addHistorial);

module.exports = router;
