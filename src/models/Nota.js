const mongoose = require('mongoose');

const notaSchema = new mongoose.Schema(
  {
    inscripcionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inscripcion',
      required: [true, 'inscripcionId es obligatorio'],
      index: true,
    },
    tipo: {
      type: String,
      required: [true, 'tipo es obligatorio'],
      trim: true,
    },
    valor: {
      type: Number,
      required: [true, 'valor es obligatorio'],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Nota', notaSchema);
