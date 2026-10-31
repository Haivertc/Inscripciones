// Campos editables y sus reglas (antes en el esquema de Mongoose)
const campos = {
  tipo: { tipo: 'string', trim: true, requerido: 'tipo es obligatorio' },
  valor: { tipo: 'number', requerido: 'valor es obligatorio' },
};

const serializarNota = (nota) => ({
  _id: nota.id,
  inscripcionId: nota.inscripcionId,
  tipo: nota.tipo,
  valor: nota.valor,
  createdAt: nota.createdAt,
  updatedAt: nota.updatedAt,
  __v: 0,
});

module.exports = { nombre: 'Nota', campos, serializarNota };
