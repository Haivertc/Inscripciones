// Coordinación con Estudiantes y Materias. No hay una transacción común entre las
// bases de los módulos, así que el cupo se controla así:
//   1. Materias reserva el cupo con una operación atómica (reservar-cupo).
//   2. Esta base guarda la inscripción.
//   3. Si el paso 2 falla, se devuelve el cupo (liberar-cupo): compensación.
// Lo que no se puede deshacer automáticamente se registra en el log
// (ReservaIncierta, CompensacionFallida) para repararlo a mano.

const { prisma } = require('../config/db');
const { obtenerEstudiante } = require('../clients/estudiantes.client');
const { obtenerCurso, reservarCupo, liberarCupo } = require('../clients/materias.client');
const { ServicioNoDisponibleError } = require('../clients/httpClient');
const { ERRORES, ErrorApi } = require('../utils/errores');
const { registrarEvento } = require('../utils/logger');
const { generarId } = require('../utils/objectId');

const ACTIVA = 'activa';
const CANCELADA = 'cancelada';

// Una inscripción 'cancelada' no ocupa cupo; cualquier otro estado sí
const esCancelada = (estado) => String(estado ?? '').trim().toLowerCase() === CANCELADA;
const FILTRO_CANCELADA = { equals: CANCELADA, mode: 'insensitive' };

const es2xx = (status) => status >= 200 && status < 300;

// ---------------------------------------------------------------------------
// Validación contra los otros módulos (B1: validar al escribir)
// ---------------------------------------------------------------------------

const noDisponible = (servicio, detalle) =>
  new ErrorApi(
    503,
    ERRORES.servicioNoDisponible,
    `El módulo ${servicio} no está disponible (${detalle}). Intenta de nuevo más tarde.`
  );

// Convierte el resultado de Promise.allSettled en { status, data } o lanza 503
const respuestaDe = (resultado, servicio) => {
  if (resultado.status === 'rejected') {
    if (resultado.reason instanceof ServicioNoDisponibleError) {
      throw noDisponible(servicio, resultado.reason.causa);
    }
    throw resultado.reason;
  }
  const respuesta = resultado.value;
  if (respuesta.status >= 500) throw noDisponible(servicio, `respondió ${respuesta.status}`);
  return respuesta;
};

const validarReferencias = async (estudianteId, cursoId) => {
  // Las dos consultas son independientes: se hacen en paralelo
  const [resEstudiante, resCurso] = await Promise.allSettled([
    obtenerEstudiante(estudianteId),
    obtenerCurso(cursoId),
  ]);

  const estudiante = respuestaDe(resEstudiante, 'Estudiantes');
  const curso = respuestaDe(resCurso, 'Materias');

  if (estudiante.status === 404) {
    throw new ErrorApi(422, ERRORES.estudianteNoExiste, `El estudiante ${estudianteId} no existe`);
  }
  if (!es2xx(estudiante.status)) {
    throw noDisponible('Estudiantes', `respuesta inesperada ${estudiante.status}`);
  }
  if (String(estudiante.data?.estado ?? '').toUpperCase() !== 'ACTIVO') {
    throw new ErrorApi(422, ERRORES.estudianteInactivo, `El estudiante ${estudianteId} no está ACTIVO`);
  }

  if (curso.status === 404) {
    throw new ErrorApi(422, ERRORES.cursoNoExiste, `El curso ${cursoId} no existe`);
  }
  if (!es2xx(curso.status)) {
    throw noDisponible('Materias', `respuesta inesperada ${curso.status}`);
  }
  if (String(curso.data?.estado ?? '').toUpperCase() !== 'ACTIVO') {
    throw new ErrorApi(422, ERRORES.cursoInactivo, `El curso ${cursoId} no está ACTIVO`);
  }
};

// ---------------------------------------------------------------------------
// Cupos en Materias
// ---------------------------------------------------------------------------

const reservar = async ({ estudianteId, cursoId }, idempotencyKey) => {
  let respuesta;
  try {
    respuesta = await reservarCupo(cursoId);
  } catch (error) {
    if (!(error instanceof ServicioNoDisponibleError)) throw error;
    // No sabemos si Materias alcanzó a descontar el cupo: hay que revisarlo a mano
    registrarEvento('ReservaIncierta', { estudianteId, cursoId, idempotencyKey, causa: error.causa });
    throw noDisponible('Materias', error.causa);
  }

  const { status, data } = respuesta;
  if (es2xx(status)) return;
  if (status === 409) {
    throw new ErrorApi(409, ERRORES.cupoAgotado, data?.message || `El curso ${cursoId} no tiene cupos disponibles`);
  }
  if (status === 404 || status === 422) {
    const errorType = data?.errorType || (status === 404 ? ERRORES.cursoNoExiste : ERRORES.cursoInactivo);
    throw new ErrorApi(422, errorType, data?.message || `Materias rechazó la reserva del curso ${cursoId}`);
  }
  if (status >= 500) {
    // Un 5xx puede llegar después de confirmar el cambio en su base
    registrarEvento('ReservaIncierta', { estudianteId, cursoId, idempotencyKey, causa: `Materias respondió ${status}` });
  }
  throw noDisponible('Materias', `reservar-cupo respondió ${status}`);
};

// Devuelve true si el cupo se liberó. Si no, registra CompensacionFallida con lo
// necesario para devolver el cupo a mano (POST .../liberar-cupo del curso).
const liberar = async (cursoId, contexto) => {
  let detalle;
  try {
    const { status, data } = await liberarCupo(cursoId);
    if (es2xx(status)) return true;
    detalle = { status, errorType: data?.errorType, respuesta: data?.message };
  } catch (error) {
    if (!(error instanceof ServicioNoDisponibleError)) throw error;
    detalle = { causa: error.causa };
  }
  registrarEvento('CompensacionFallida', {
    cursoId,
    ...contexto,
    ...detalle,
    accionManual: `POST {MATERIAS_URL}/api/materias/cursos/${cursoId}/liberar-cupo`,
  });
  return false;
};

// ---------------------------------------------------------------------------
// Crear inscripción (POST /api/inscripciones)
// ---------------------------------------------------------------------------

const buscarPorClave = (idempotencyKey) =>
  prisma.inscripcion.findUnique({ where: { idempotencyKey } });

// Réplica idempotente: misma clave -> misma inscripción, sin crear nada ni tocar cupos
const replicar = (previa, { estudianteId, cursoId }) => {
  if (previa.estudianteId !== estudianteId || previa.cursoId !== cursoId) {
    throw new ErrorApi(
      422,
      ERRORES.idempotencyKeyReutilizada,
      'La Idempotency-Key ya se usó para otra inscripción (otro estudianteId/cursoId). Genera una clave nueva por cada intento distinto.'
    );
  }
  return { inscripcion: previa, replayed: true };
};

const insertar = ({ estudianteId, cursoId, periodo }, idempotencyKey) =>
  prisma.inscripcion.create({
    data: { id: generarId(), estudianteId, cursoId, periodo, estado: ACTIVA, idempotencyKey },
  });

// Reactiva la fila 'cancelada' en vez de crear otra (uq_insc permite una por curso).
// El UPDATE condicionado (estado = 'cancelada') evita que dos reactivaciones
// simultáneas pasen las dos: la segunda no encuentra la fila y aborta.
const reactivar = (existente, { periodo }, idempotencyKey) =>
  prisma.$transaction(async (tx) => {
    const { count } = await tx.inscripcion.updateMany({
      where: { id: existente.id, estado: FILTRO_CANCELADA },
      data: { estado: ACTIVA, periodo, ...(idempotencyKey && { idempotencyKey }) },
    });
    if (count === 0) {
      throw new ErrorApi(409, ERRORES.inscripcionDuplicada, 'El estudiante ya está inscrito en este curso');
    }
    await tx.historialEstado.create({
      data: {
        id: generarId(),
        inscripcionId: existente.id,
        estadoAnterior: existente.estado,
        estadoNuevo: ACTIVA,
        motivo: 'Reinscripción',
      },
    });
    return tx.inscripcion.findUnique({ where: { id: existente.id } });
  });

/**
 * @param {{estudianteId: string, cursoId: string, periodo: string}} datos  body ya validado
 * @param {string|null} idempotencyKey
 * @returns {Promise<{inscripcion: object, replayed: boolean}>}
 */
const crearInscripcion = async (datos, idempotencyKey) => {
  const { estudianteId, cursoId } = datos;

  // b) Idempotencia
  if (idempotencyKey) {
    const previa = await buscarPorClave(idempotencyKey);
    if (previa) return replicar(previa, datos);
  }

  // c) Validar estudiante y curso en sus módulos
  await validarReferencias(estudianteId, cursoId);

  // d) ¿Ya hay una fila de este estudiante en este curso?
  const existente = await prisma.inscripcion.findUnique({
    where: { estudianteId_cursoId: { estudianteId, cursoId } },
  });
  if (existente && !esCancelada(existente.estado)) {
    throw new ErrorApi(409, ERRORES.inscripcionDuplicada, 'El estudiante ya está inscrito en este curso');
  }

  // e) Reservar el cupo (operación atómica en Materias)
  await reservar(datos, idempotencyKey);

  // f) Guardar; si falla, compensar devolviendo el cupo
  try {
    const inscripcion = existente
      ? await reactivar(existente, datos, idempotencyKey)
      : await insertar(datos, idempotencyKey);
    return { inscripcion, replayed: false };
  } catch (error) {
    await liberar(cursoId, {
      estudianteId,
      idempotencyKey,
      motivo: `compensación tras fallo al guardar: ${error.code || error.errorType || error.message}`,
    });

    if (error.code === 'P2002') {
      // Otra petición ganó la carrera. Si fue con la misma clave, es una réplica.
      if (idempotencyKey) {
        const previa = await buscarPorClave(idempotencyKey);
        if (previa) return replicar(previa, datos);
      }
      throw new ErrorApi(409, ERRORES.inscripcionDuplicada, 'El estudiante ya está inscrito en este curso');
    }
    if (error instanceof ErrorApi) throw error;

    console.error(error);
    throw new ErrorApi(
      503,
      ERRORES.servicioNoDisponible,
      'No se pudo guardar la inscripción (base de datos de Inscripciones). Intenta de nuevo más tarde.'
    );
  }
};

// ---------------------------------------------------------------------------
// Cancelar inscripción (DELETE, PUT estado='cancelada', POST historial 'cancelada')
// ---------------------------------------------------------------------------

/**
 * Marca la inscripción como 'cancelada' y registra el historial en una transacción;
 * después libera el cupo en Materias.
 * @param {string} id
 * @param {object} [opciones]
 * @param {string} [opciones.motivo]
 * @param {string} [opciones.estadoAnterior]  si el cliente lo envía (POST historial)
 * @param {object} [opciones.cambios]          otros campos a actualizar en la misma transacción (PUT)
 * @returns {Promise<{inscripcion, historial, cupoLiberado: boolean, yaCancelada: boolean} | null>}
 *          null si la inscripción no existe
 */
const cancelarInscripcion = async (id, { motivo, estadoAnterior, cambios = {} } = {}) => {
  const resultado = await prisma.$transaction(async (tx) => {
    const actual = await tx.inscripcion.findUnique({ where: { id } });
    if (!actual) return null;
    if (esCancelada(actual.estado)) return { inscripcion: actual, historial: null, yaCancelada: true };

    // Condicionado al estado: si dos cancelaciones llegan a la vez, solo una libera el cupo
    const { count } = await tx.inscripcion.updateMany({
      where: { id, NOT: { estado: FILTRO_CANCELADA } },
      data: { ...cambios, estado: CANCELADA },
    });
    if (count === 0) {
      return { inscripcion: await tx.inscripcion.findUnique({ where: { id } }), historial: null, yaCancelada: true };
    }

    const historial = await tx.historialEstado.create({
      data: {
        id: generarId(),
        inscripcionId: id,
        estadoAnterior: estadoAnterior ?? actual.estado,
        estadoNuevo: CANCELADA,
        motivo: motivo ?? null,
      },
    });
    const inscripcion = await tx.inscripcion.findUnique({ where: { id } });
    return { inscripcion, historial, yaCancelada: false };
  });

  if (!resultado) return null;
  if (resultado.yaCancelada) return { ...resultado, cupoLiberado: false };

  const { inscripcion } = resultado;
  const cupoLiberado = await liberar(inscripcion.cursoId, {
    inscripcionId: inscripcion.id,
    estudianteId: inscripcion.estudianteId,
    motivo: 'cancelación de inscripción',
  });
  return { ...resultado, cupoLiberado };
};

module.exports = {
  crearInscripcion,
  cancelarInscripcion,
  esCancelada,
  CANCELADA,
  ACTIVA,
};
