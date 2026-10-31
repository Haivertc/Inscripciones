const { prisma } = require('../config/db');
const { Inscripcion, Nota, HistorialEstado } = require('../models');
const { validar } = require('../utils/validacion');
const { generarId, esIdValido } = require('../utils/objectId');

const NOT_FOUND_MSG = 'Inscripción no encontrada';
const NOTA_NOT_FOUND_MSG = 'Nota no encontrada';
const HISTORIAL_NOT_FOUND_MSG = 'Registro de historial no encontrado';

// Notas e historial en orden de creación (como el populate de Mongoose)
const ORDEN_CREACION = [{ createdAt: 'asc' }, { id: 'asc' }];

const { serializarInscripcion } = Inscripcion;
const { serializarNota } = Nota;
const { serializarHistorial } = HistorialEstado;

// Copia solo las claves permitidas que vengan definidas en el body
const pick = (source = {}, allowed) =>
  allowed.reduce((acc, key) => {
    if (source[key] !== undefined) acc[key] = source[key];
    return acc;
  }, {});

// Prisma lanza P2025 cuando el registro a actualizar no existe
const esNoEncontrado = (error) => error.code === 'P2025';

// Errores de validación -> 400; el resto -> 500
const handleError = (res, error) => {
  if (error.name === 'ValidationError') {
    return res.status(400).json({ message: error.message });
  }
  return res.status(500).json({ message: error.message });
};

const createInscripcion = async (req, res) => {
  try {
    const { estudianteId, cursoId, periodo } = req.body;
    const data = validar(Inscripcion, { estudianteId, cursoId, periodo });
    const inscripcion = await prisma.inscripcion.create({ data: { id: generarId(), ...data } });
    return res.status(201).json(serializarInscripcion(inscripcion));
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

    // Solo se agregan los filtros presentes; String() descarta objetos (?campo[x]=y)
    const where = {};
    ['estudianteId', 'cursoId', 'periodo'].forEach((field) => {
      if (req.query[field] !== undefined && req.query[field] !== '') {
        where[field] = String(req.query[field]);
      }
    });

    const [data, total] = await Promise.all([
      prisma.inscripcion.findMany({
        where,
        // El id desempata para que la paginación sea estable
        orderBy: [{ [sortBy]: sortDirection }, { id: sortDirection }],
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        include: { notas: { orderBy: ORDEN_CREACION } },
      }),
      prisma.inscripcion.count({ where }),
    ]);

    return res.status(200).json({
      data: data.map(serializarInscripcion),
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
    if (!esIdValido(id)) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    const inscripcion = await prisma.inscripcion.findUnique({
      where: { id },
      include: {
        notas: { orderBy: ORDEN_CREACION },
        historial: { orderBy: ORDEN_CREACION },
      },
    });

    if (!inscripcion) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }
    return res.status(200).json(serializarInscripcion(inscripcion));
  } catch (error) {
    return handleError(res, error);
  }
};

const updateInscripcion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    const data = validar(
      Inscripcion,
      pick(req.body, ['estudianteId', 'cursoId', 'periodo', 'estado']),
      { parcial: true }
    );

    const inscripcion = await prisma.inscripcion.update({ where: { id }, data });
    return res.status(200).json(serializarInscripcion(inscripcion));
  } catch (error) {
    if (esNoEncontrado(error)) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }
    return handleError(res, error);
  }
};

const deleteInscripcion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    // Las notas y el historial se eliminan en cascada (ON DELETE CASCADE)
    const { count } = await prisma.inscripcion.deleteMany({ where: { id } });
    if (count === 0) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    return res.status(200).json({ message: 'Inscripción eliminada correctamente' });
  } catch (error) {
    return handleError(res, error);
  }
};

const addNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id) || (await prisma.inscripcion.count({ where: { id } })) === 0) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    const data = validar(Nota, pick(req.body, ['tipo', 'valor']));
    const nota = await prisma.nota.create({
      data: { id: generarId(), ...data, inscripcionId: id },
    });
    return res.status(201).json(serializarNota(nota));
  } catch (error) {
    return handleError(res, error);
  }
};

const addHistorial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id) || (await prisma.inscripcion.count({ where: { id } })) === 0) {
      return res.status(404).json({ message: NOT_FOUND_MSG });
    }

    // Se valida estadoNuevo antes de tocar la inscripción
    const data = validar(HistorialEstado, pick(req.body, ['estadoAnterior', 'estadoNuevo', 'motivo']));

    // Transacción: el historial y el nuevo estado se guardan juntos o no se guarda nada
    const [historial] = await prisma.$transaction([
      prisma.historialEstado.create({ data: { id: generarId(), ...data, inscripcionId: id } }),
      prisma.inscripcion.update({ where: { id }, data: { estado: data.estadoNuevo } }),
    ]);

    return res.status(201).json(serializarHistorial(historial));
  } catch (error) {
    return handleError(res, error);
  }
};

const getNotaById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }

    const nota = await prisma.nota.findUnique({ where: { id } });
    if (!nota) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }
    return res.status(200).json(serializarNota(nota));
  } catch (error) {
    return handleError(res, error);
  }
};

const updateNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }

    const data = validar(Nota, pick(req.body, ['tipo', 'valor']), { parcial: true });

    const nota = await prisma.nota.update({ where: { id }, data });
    return res.status(200).json(serializarNota(nota));
  } catch (error) {
    if (esNoEncontrado(error)) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }
    return handleError(res, error);
  }
};

const deleteNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) {
      return res.status(404).json({ message: NOTA_NOT_FOUND_MSG });
    }

    const { count } = await prisma.nota.deleteMany({ where: { id } });
    if (count === 0) {
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
    if (!esIdValido(id)) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }

    const historial = await prisma.historialEstado.findUnique({ where: { id } });
    if (!historial) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }
    return res.status(200).json(serializarHistorial(historial));
  } catch (error) {
    return handleError(res, error);
  }
};

const updateHistorial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }

    const data = validar(
      HistorialEstado,
      pick(req.body, ['estadoAnterior', 'estadoNuevo', 'motivo']),
      { parcial: true }
    );

    const historial = await prisma.historialEstado.update({ where: { id }, data });
    return res.status(200).json(serializarHistorial(historial));
  } catch (error) {
    if (esNoEncontrado(error)) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }
    return handleError(res, error);
  }
};

const deleteHistorial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) {
      return res.status(404).json({ message: HISTORIAL_NOT_FOUND_MSG });
    }

    const { count } = await prisma.historialEstado.deleteMany({ where: { id } });
    if (count === 0) {
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
