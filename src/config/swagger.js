const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Microservicio Inscripciones',
      version: '1.0.0',
      description: 'Gestión de inscripciones, notas e historial de estados',
    },
    servers: [{ url: `http://localhost:${process.env.PORT || 8083}` }],
    components: {
      parameters: {
        InscripcionId: {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string' },
          description: 'ID de la inscripción (ObjectId de MongoDB)',
          example: '665f1c2e8b1e4a0012345678',
        },
      },
      schemas: {
        Nota: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            inscripcionId: { type: 'string' },
            tipo: { type: 'string', example: 'Parcial 1' },
            valor: { type: 'number', example: 4.5 },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        HistorialEstado: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            inscripcionId: { type: 'string' },
            estadoAnterior: { type: 'string', example: 'activa' },
            estadoNuevo: { type: 'string', example: 'retirada' },
            motivo: { type: 'string', example: 'Solicitud del estudiante' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Inscripcion: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '665f1c2e8b1e4a0012345678' },
            estudianteId: { type: 'string', example: '1001' },
            cursoId: { type: 'string', example: 'MAT-101' },
            periodo: { type: 'string', example: '2026-2' },
            estado: { type: 'string', example: 'activa' },
            notas: { type: 'array', items: { $ref: '#/components/schemas/Nota' } },
            historial: { type: 'array', items: { $ref: '#/components/schemas/HistorialEstado' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  // glob requiere separadores "/" (en Windows path.join genera "\")
  apis: [path.join(__dirname, '../routes/*.js').split(path.sep).join('/')],
};

module.exports = swaggerJsdoc(options);
