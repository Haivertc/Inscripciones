const { prisma } = require('../config/db');
const { Inscripcion, Nota, HistorialEstado } = require('../models');
const { validar } = require('../utils/validacion');
const { generarId, esIdValido } = require('../utils/objectId');
const { ERRORES, ErrorApi, responderError } = require('../utils/errores');
const { crearInscripcion, cancelarInscripcion, esCancelada } = require('../services/inscripciones.service');

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

// Todas las respuestas de error: { message, errorType } (y res.locals.errorType)
const noEncontrada = (res) => responderError(res, 404, ERRORES.inscripcionNoExiste, NOT_FOUND_MSG);
const notaNoEncontrada = (res) => responderError(res, 404, ERRORES.notaNoExiste, NOTA_NOT_FOUND_MSG);
const historialNoEncontrado = (res) =>
  responderError(res, 404, ERRORES.historialNoExiste, HISTORIAL_NOT_FOUND_MSG);

// Negocio -> su código; validación -> 400; el resto -> 500
const handleError = (res, error) => {
  if (error instanceof ErrorApi) {
    return responderError(res, error.status, error.errorType, error.message);
  }
  if (error.name === 'ValidationError') {
    return responderError(res, 400, ERRORES.validacion, error.message);
  }
  console.error(error);
  return responderError(res, 500, ERRORES.errorInterno, error.message);
};

const MAX_IDEMPOTENCY_KEY = 100;

// Encabezado opcional; vacío equivale a no enviarlo
const leerIdempotencyKey = (req) => {
  const clave = (req.get('Idempotency-Key') ?? '').trim();
  if (clave === '') return null;
  if (clave.length > MAX_IDEMPOTENCY_KEY) {
    throw new ErrorApi(400, ERRORES.validacion, `Idempotency-Key no debe superar ${MAX_IDEMPOTENCY_KEY} caracteres`);
  }
  return clave;
};

const MENSAJE_CAMBIO_CURSO =
  'No se puede cambiar estudianteId ni cursoId de una inscripción (se saltaría el control de cupos). ' +
  'Para cambiar de curso: cancela la inscripción (DELETE) e inscribe de nuevo (POST).';
const MENSAJE_REACTIVAR =
  'Una inscripción cancelada no se reactiva cambiando su estado (no reservaría cupo). ' +
  'Usa POST /api/inscripciones con el mismo estudianteId y cursoId.';

// Respuesta de una cancelación (DELETE y POST historial sobre una ya cancelada)
const cuerpoCancelacion = ({ inscripcion, cupoLiberado, yaCancelada }) => ({
  message: yaCancelada
    ? 'La inscripción ya estaba cancelada; no se liberó cupo de nuevo'
    : 'Inscripción cancelada correctamente',
  ...serializarInscripcion(inscripcion),
  cupoLiberado,
  yaCancelada,
});

// Flujo completo (idempotencia, validación, reserva, compensación) en
// services/inscripciones.service.js -> crearInscripcion
const createInscripcion = async (req, res) => {
  try {
    // a) Validar el body -> 400
    const { estudianteId, cursoId, periodo } = req.body ?? {};
    const data = validar(Inscripcion, { estudianteId, cursoId, periodo });
    const idempotencyKey = leerIdempotencyKey(req);

    const { inscripcion, replayed } = await crearInscripcion(data, idempotencyKey);
    if (replayed) res.set('Idempotent-Replayed', 'true');
    return res.status(201).json(serializarInscripcion(inscripcion));
  } catch (error) {
    if (error instanceof ErrorApi || error.name === 'ValidationError') return handleError(res, error);
    // Fallo inesperado (p. ej. la base de Inscripciones no responde): nunca 500 en este flujo
    console.error(error);
    return responderError(
      res,
      503,
      ERRORES.servicioNoDisponible,
      'Inscripciones no pudo completar la operación (base de datos no disponible). Intenta de nuevo más tarde.'
    );
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
    return handleError(res, error);
  }
};

const getInscripcionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) return noEncontrada(res);

    const inscripcion = await prisma.inscripcion.findUnique({
      where: { id },
      include: {
        notas: { orderBy: ORDEN_CREACION },
        historial: { orderBy: ORDEN_CREACION },
      },
    });

    if (!inscripcion) return noEncontrada(res);
    return res.status(200).json(serializarInscripcion(inscripcion));
  } catch (error) {
    return handleError(res, error);
  }
};

const updateInscripcion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) return noEncontrada(res);

    const data = validar(
      Inscripcion,
      pick(req.body, ['estudianteId', 'cursoId', 'periodo', 'estado']),
      { parcial: true }
    );

    const actual = await prisma.inscripcion.findUnique({ where: { id } });
    if (!actual) return noEncontrada(res);

    // Se aceptan si llegan con el mismo valor (el formulario envía el objeto completo)
    const cambiaReferencia = ['estudianteId', 'cursoId'].some(
      (campo) => data[campo] !== undefined && data[campo] !== actual[campo]
    );
    if (cambiaReferencia) {
      return responderError(res, 422, ERRORES.cambioNoPermitido, MENSAJE_CAMBIO_CURSO);
    }
    delete data.estudianteId;
    delete data.cursoId;

    if (data.estado !== undefined) {
      const estaba = esCancelada(actual.estado);
      const quedaria = esCancelada(data.estado);
      if (estaba && !quedaria) {
        return responderError(res, 422, ERRORES.cambioNoPermitido, MENSAJE_REACTIVAR);
      }
      if (estaba && quedaria) delete data.estado;
      if (!estaba && quedaria) {
        // Cancelar desde el formulario: misma lógica que DELETE (historial + liberar cupo)
        const { estado, ...cambios } = data;
        const resultado = await cancelarInscripcion(id, { motivo: 'Cancelada desde la edición', cambios });
        if (!resultado) return noEncontrada(res);
        return res.status(200).json({
          ...serializarInscripcion(resultado.inscripcion),
          cupoLiberado: resultado.cupoLiberado,
        });
      }
    }

    const inscripcion = await prisma.inscripcion.update({ where: { id }, data });
    return res.status(200).json(serializarInscripcion(inscripcion));
  } catch (error) {
    if (esNoEncontrado(error)) return noEncontrada(res);
    return handleError(res, error);
  }
};

// Ya no borra: marca 'cancelada' (conserva notas e historial) y libera el cupo en Materias
const deleteInscripcion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) return noEncontrada(res);

    const resultado = await cancelarInscripcion(id, { motivo: 'Inscripción cancelada' });
    if (!resultado) return noEncontrada(res);
    return res.status(200).json(cuerpoCancelacion(resultado));
  } catch (error) {
    return handleError(res, error);
  }
};

const addNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id) || (await prisma.inscripcion.count({ where: { id } })) === 0) {
      return noEncontrada(res);
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
    if (!esIdValido(id)) return noEncontrada(res);
    const actual = await prisma.inscripcion.findUnique({ where: { id } });
    if (!actual) return noEncontrada(res);

    // Se valida estadoNuevo antes de tocar la inscripción
    const data = validar(HistorialEstado, pick(req.body, ['estadoAnterior', 'estadoNuevo', 'motivo']));

    const estaba = esCancelada(actual.estado);
    const quedaria = esCancelada(data.estadoNuevo);
    if (estaba && !quedaria) {
      return responderError(res, 422, ERRORES.cambioNoPermitido, MENSAJE_REACTIVAR);
    }
    if (quedaria) {
      // Misma lógica que DELETE: transacción (estado + historial) y liberar el cupo
      const resultado = await cancelarInscripcion(id, {
        motivo: data.motivo,
        estadoAnterior: data.estadoAnterior,
      });
      if (!resultado) return noEncontrada(res);
      if (resultado.yaCancelada) return res.status(200).json(cuerpoCancelacion(resultado));
      return res.status(201).json({
        ...serializarHistorial(resultado.historial),
        cupoLiberado: resultado.cupoLiberado,
      });
    }

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
    if (!esIdValido(id)) return notaNoEncontrada(res);

    const nota = await prisma.nota.findUnique({ where: { id } });
    if (!nota) return notaNoEncontrada(res);
    return res.status(200).json(serializarNota(nota));
  } catch (error) {
    return handleError(res, error);
  }
};

const updateNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) return notaNoEncontrada(res);

    const data = validar(Nota, pick(req.body, ['tipo', 'valor']), { parcial: true });

    const nota = await prisma.nota.update({ where: { id }, data });
    return res.status(200).json(serializarNota(nota));
  } catch (error) {
    if (esNoEncontrado(error)) return notaNoEncontrada(res);
    return handleError(res, error);
  }
};

const deleteNota = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) return notaNoEncontrada(res);

    const { count } = await prisma.nota.deleteMany({ where: { id } });
    if (count === 0) return notaNoEncontrada(res);
    return res.status(200).json({ message: 'Nota eliminada correctamente' });
  } catch (error) {
    return handleError(res, error);
  }
};

const getHistorialById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) return historialNoEncontrado(res);

    const historial = await prisma.historialEstado.findUnique({ where: { id } });
    if (!historial) return historialNoEncontrado(res);
    return res.status(200).json(serializarHistorial(historial));
  } catch (error) {
    return handleError(res, error);
  }
};

const updateHistorial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) return historialNoEncontrado(res);

    const data = validar(
      HistorialEstado,
      pick(req.body, ['estadoAnterior', 'estadoNuevo', 'motivo']),
      { parcial: true }
    );

    const historial = await prisma.historialEstado.update({ where: { id }, data });
    return res.status(200).json(serializarHistorial(historial));
  } catch (error) {
    if (esNoEncontrado(error)) return historialNoEncontrado(res);
    return handleError(res, error);
  }
};

const deleteHistorial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!esIdValido(id)) return historialNoEncontrado(res);

    const { count } = await prisma.historialEstado.deleteMany({ where: { id } });
    if (count === 0) return historialNoEncontrado(res);
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
