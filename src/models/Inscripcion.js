const { serializarNota } = require('./Nota');
const { serializarHistorial } = require('./HistorialEstado');

// Campos editables y sus reglas (antes en el esquema de Mongoose)
const campos = {
  // IDs de otros microservicios: no son ids de esta base de datos
  estudianteId: { tipo: 'string', trim: true, requerido: 'estudianteId es obligatorio' },
  cursoId: { tipo: 'string', trim: true, requerido: 'cursoId es obligatorio' },
  periodo: { tipo: 'string', trim: true, requerido: 'periodo es obligatorio' },
  estado: { tipo: 'string', trim: true },
};

// Mismo JSON que producía Mongoose: _id, __v y el virtual "id"; notas e historial
// solo cuando se cargaron (equivalente al populate)
const serializarInscripcion = (inscripcion) => ({
  _id: inscripcion.id,
  estudianteId: inscripcion.estudianteId,
  cursoId: inscripcion.cursoId,
  periodo: inscripcion.periodo,
  estado: inscripcion.estado,
  createdAt: inscripcion.createdAt,
  updatedAt: inscripcion.updatedAt,
  __v: 0,
  ...(inscripcion.notas && { notas: inscripcion.notas.map(serializarNota) }),
  ...(inscripcion.historial && { historial: inscripcion.historial.map(serializarHistorial) }),
  id: inscripcion.id,
});

module.exports = { nombre: 'Inscripcion', campos, serializarInscripcion };
