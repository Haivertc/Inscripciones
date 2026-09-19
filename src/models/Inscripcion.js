const mongoose = require('mongoose');

const inscripcionSchema = new mongoose.Schema(
  {
    // IDs de otros microservicios: no son ObjectId de esta base de datos
    estudianteId: {
      type: String,
      required: [true, 'estudianteId es obligatorio'],
      trim: true,
      index: true,
    },
    cursoId: {
      type: String,
      required: [true, 'cursoId es obligatorio'],
      trim: true,
      index: true,
    },
    periodo: {
      type: String,
      required: [true, 'periodo es obligatorio'],
      trim: true,
    },
    estado: {
      type: String,
      default: 'activa',
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

inscripcionSchema.virtual('notas', {
  ref: 'Nota',
  localField: '_id',
  foreignField: 'inscripcionId',
});

inscripcionSchema.virtual('historial', {
  ref: 'HistorialEstado',
  localField: '_id',
  foreignField: 'inscripcionId',
});

module.exports = mongoose.model('Inscripcion', inscripcionSchema);
