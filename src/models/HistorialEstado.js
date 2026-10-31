// Campos editables y sus reglas (antes en el esquema de Mongoose)
const campos = {
  estadoAnterior: { tipo: 'string', trim: true },
  estadoNuevo: { tipo: 'string', trim: true, requerido: 'estadoNuevo es obligatorio' },
  motivo: { tipo: 'string', trim: true },
};

// Los campos opcionales sin valor se omiten, como hacía Mongoose
const serializarHistorial = (historial) => ({
  _id: historial.id,
  inscripcionId: historial.inscripcionId,
  ...(historial.estadoAnterior != null && { estadoAnterior: historial.estadoAnterior }),
  estadoNuevo: historial.estadoNuevo,
  ...(historial.motivo != null && { motivo: historial.motivo }),
  createdAt: historial.createdAt,
  updatedAt: historial.updatedAt,
  __v: 0,
});

module.exports = { nombre: 'HistorialEstado', campos, serializarHistorial };
