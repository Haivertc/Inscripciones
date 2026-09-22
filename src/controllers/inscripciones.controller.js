const mongoose = require('mongoose');
const { Inscripcion, Nota, HistorialEstado } = require('../models');

const NOT_FOUND_MSG = 'Inscripción no encontrada';
const NOTA_NOT_FOUND_MSG = 'Nota no encontrada';
const HISTORIAL_NOT_FOUND_MSG = 'Registro de historial no encontrado';

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Copia solo las claves permitidas que vengan definidas en el body
const pick = (source = {}, allowed) =>
  allowed.reduce((acc, key) => {
    if (source[key] !== undefined) acc[key] = source[key];
    return acc;
  }, {});

// Errores de validación de Mongoose -> 400; el resto -> 500
const handleError = (res, error) => {
  if (error.name === 'ValidationError') {
    return res.status(400).json({ message: error.message });
  }
  return res.status(500).json({ message: error.message });
};

const createInscripcion = async (req, res) => {
  try {
    const { estudianteId, cursoId, periodo } = req.body;
    const inscripcion = await Inscripcion.create({ estudianteId, cursoId, periodo });
    return res.status(201).json(inscripcion);
  } catch (error) {
    return handleError(res, error);
  }
};

const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'estudianteId', 'cursoId', 'periodo', 'estado'];
const MAX_PAGE_SIZE = 100;

// Entero positivo o el valor por defecto
const toPositiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const getAllInscripciones = async (req, res) => {
  try {
    const pageNumber = toPositiveInt(req.query.pageNumber, 1);
    const pageSize = Math.min(toPositiveInt(req.query.pageSize, 10), MAX_PAGE_SIZE);
    const sortBy = SORTABLE_FIELDS.includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
    const sortDirection = req.query.sortDirection === 'asc' ? 'asc' : 'desc';

    // Solo se agregan los filtros presentes; String() evita inyección de operadores (?campo[$ne]=x)
    const query = {};
    ['estudianteId', 'cursoId', 'periodo'].forEach((field) => {
      if (req.query[field] !== undefined && req.query[field] !== '') {
        query[field] = String(req.query[field]);
      }
    });

    const [data, total] = await Promise.all([
      Inscripcion.find(query)
        .sort({ [sortBy]: sortDirection === 'desc' ? -1 : 1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(Number(pageSize))
        .populate('notas'),
      Inscripcion.countDocuments(query),
    ]);

    return res.status(200).json({
      data,
      metadata: {
        total,
        page: pageNumber,
        totalPages: Math.ceil(total / pageSize),
        pageSize,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getInscripcionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    const inscripcion = await Inscripcion.findById(id)
      .populate('notas')
      .populate('historial');

    if (!inscripcion) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }
    return res.status(200).json(inscripcion);
  } catch (error) {
    return handleError(res, error);
  }
};

const updateInscripcion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    const data = pick(req.body, ['estudianteId', 'cursoId', 'periodo', 'estado']);

    const inscripcion = await Inscripcion.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!inscripcion) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }
    return res.status(200).json(inscripcion);
  } catch (error) {
    return handleError(res, error);
  }
};

const deleteInscripcion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    const inscripcion = await Inscripcion.findByIdAndDelete(id);
    if (!inscripcion) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    // Evita documentos huérfanos
    await Promise.all([
      Nota.deleteMany({ inscripcionId: id }),
      HistorialEstado.deleteMany({ inscripcionId: id }),
    ]);

    return res.status(200).json({ message: 'Inscripción eliminada correctamente' });
  } catch (error) {
    return handleError(res, error);
  }
};

const addNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id) || !(await Inscripcion.exists({ _id: id }))) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    const nota = await Nota.create({
      ...pick(req.body, ['tipo', 'valor']),
      inscripcionId: id,
    });
    return res.status(201).json(nota);
  } catch (error) {
    return handleError(res, error);
  }
};

const addHistorial = async (req, res) => {
  let historial;
  try {
    const { id } = req.params;
    const inscripcion = isValidId(id) ? await Inscripcion.findById(id) : null;
    if (!inscripcion) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    // create() valida estadoNuevo antes de tocar la inscripción
    historial = await HistorialEstado.create({
      ...pick(req.body, ['estadoAnterior', 'estadoNuevo', 'motivo']),
      inscripcionId: id,
    });

    inscripcion.estado = historial.estadoNuevo;
    await inscripcion.save();

    return res.status(201).json(historial);
  } catch (error) {
    // Si falló el guardado del estado, se revierte el historial para no dejarlos desincronizados
    if (historial) {
      await HistorialEstado.deleteOne({ _id: historial._id }).catch(() => {});
    }
    return handleError(res, error);
  }
};

const getNotaById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }

    const nota = await Nota.findById(id);
    if (!nota) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }
    return res.status(200).json(nota);
  } catch (error) {
    return handleError(res, error);
  }
};

const updateNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }

    const data = pick(req.body, ['tipo', 'valor']);

    const nota = await Nota.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!nota) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }
    return res.status(200).json(nota);
  } catch (error) {
    return handleError(res, error);
  }
};

const deleteNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }

    const nota = await Nota.findByIdAndDelete(id);
    if (!nota) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }
    return res.status(200).json({ message: 'Nota eliminada correctamente' });
  } catch (error) {
    return handleError(res, error);
  }
};

const getHistorialById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }

    const historial = await HistorialEstado.findById(id);
    if (!historial) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }
    return res.status(200).json(historial);
  } catch (error) {
    return handleError(res, error);
  }
};

const updateHistorial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }

    const data = pick(req.body, ['estadoAnterior', 'estadoNuevo', 'motivo']);

    const historial = await HistorialEstado.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!historial) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }
    return res.status(200).json(historial);
  } catch (error) {
    return handleError(res, error);
  }
};

const deleteHistorial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }

    const historial = await HistorialEstado.findByIdAndDelete(id);
    if (!historial) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }
    return res.status(200).json({ message: 'Registro de historial eliminado correctamente' });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
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
};
