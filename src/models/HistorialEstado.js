const mongoose = require('mongoose');

const historialEstadoSchema = new mongoose.Schema(
  {
    inscripcionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inscripcion',
      required: [true, 'inscripcionId es obligatorio'],
      index: true,
    },
    estadoAnterior: {
      type: String,
      trim: true,
    },
    estadoNuevo: {
      type: String,
      required: [true, 'estadoNuevo es obligatorio'],
      trim: true,
    },
    motivo: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('HistorialEstado', historialEstadoSchema);
