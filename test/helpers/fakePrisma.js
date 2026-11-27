// Prisma falso en memoria con lo que usa el módulo: findUnique/findMany/count/
// create/update/updateMany y $transaction (con reversión). Aplica los mismos
// índices únicos que la base real (idempotency_key y uq_insc) y lanza P2002.

const clonar = (filas) => filas.map((f) => ({ ...f }));

const errorUnico = (target) => {
  const error = new Error(`Unique constraint failed on the fields: (${target.join(', ')})`);
  error.code = 'P2002';
  error.meta = { target };
  return error;
};

const coincideValor = (valor, condicion) => {
  if (condicion !== null && typeof condicion === 'object') {
    if ('equals' in condicion) {
      return condicion.mode === 'insensitive'
        ? String(valor).toLowerCase() === String(condicion.equals).toLowerCase()
        : valor === condicion.equals;
    }
  }
  return valor === condicion;
};

const coincide = (fila, where = {}) =>
  Object.entries(where).every(([campo, condicion]) => {
    if (campo === 'NOT') return !coincide(fila, condicion);
    if (campo === 'estudianteId_cursoId') {
      return fila.estudianteId === condicion.estudianteId && fila.cursoId === condicion.cursoId;
    }
    return coincideValor(fila[campo], condicion);
  });

const crearFakePrisma = () => {
  const estado = { inscripciones: [], historial: [], notas: [] };
  const hooks = {
    // async (data) => {} : se ejecuta justo antes de insertar (simula carreras)
    beforeCreate: null,
    // Error a lanzar en create (simula la base caída)
    errorCreate: null,
  };

  const validarUnicos = (fila, ignorarId) => {
    for (const otra of estado.inscripciones) {
      if (otra.id === ignorarId) continue;
      if (fila.idempotencyKey != null && otra.idempotencyKey === fila.idempotencyKey) {
        throw errorUnico(['idempotency_key']);
      }
      if (otra.estudianteId === fila.estudianteId && otra.cursoId === fila.cursoId) {
        throw errorUnico(['estudiante_id', 'curso_id']);
      }
    }
  };

  const conRelaciones = (fila, include) => {
    if (!fila) return null;
    const copia = { ...fila };
    if (include?.notas) copia.notas = estado.notas.filter((n) => n.inscripcionId === fila.id);
    if (include?.historial) copia.historial = estado.historial.filter((h) => h.inscripcionId === fila.id);
    return copia;
  };

  const inscripcion = {
    findUnique: async ({ where, include }) =>
      conRelaciones(estado.inscripciones.find((f) => coincide(f, where)), include),
    findMany: async ({ where } = {}) => clonar(estado.inscripciones.filter((f) => coincide(f, where))),
    count: async ({ where } = {}) => estado.inscripciones.filter((f) => coincide(f, where)).length,
    create: async ({ data }) => {
      if (hooks.beforeCreate) await hooks.beforeCreate(data);
      if (hooks.errorCreate) throw hooks.errorCreate;
      const ahora = new Date();
      const fila = { estado: 'activa', idempotencyKey: null, createdAt: ahora, updatedAt: ahora, ...data };
      validarUnicos(fila);
      estado.inscripciones.push(fila);
      return { ...fila };
    },
    update: async ({ where, data }) => {
      const fila = estado.inscripciones.find((f) => coincide(f, where));
      if (!fila) {
        const error = new Error('Record to update not found');
        error.code = 'P2025';
        throw error;
      }
      validarUnicos({ ...fila, ...data }, fila.id);
      Object.assign(fila, data, { updatedAt: new Date() });
      return { ...fila };
    },
    updateMany: async ({ where, data }) => {
      const filas = estado.inscripciones.filter((f) => coincide(f, where));
      filas.forEach((f) => validarUnicos({ ...f, ...data }, f.id));
      filas.forEach((f) => Object.assign(f, data, { updatedAt: new Date() }));
      return { count: filas.length };
    },
  };

  const historialEstado = {
    create: async ({ data }) => {
      const ahora = new Date();
      const fila = { estadoAnterior: null, motivo: null, createdAt: ahora, updatedAt: ahora, ...data };
      estado.historial.push(fila);
      return { ...fila };
    },
  };

  const prisma = {
    inscripcion,
    historialEstado,
    // Forma interactiva: revierte todo si la función lanza. Forma de arreglo: espera las promesas.
    $transaction: async (arg) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const copia = { inscripciones: clonar(estado.inscripciones), historial: clonar(estado.historial) };
      try {
        return await arg(prisma);
      } catch (error) {
        estado.inscripciones = copia.inscripciones;
        estado.historial = copia.historial;
        throw error;
      }
    },
    $connect: async () => {},
  };

  // Para que las pruebas inserten filas directamente (sin pasar por los hooks)
  const insertarDirecto = (data) => {
    const ahora = new Date();
    const fila = { estado: 'activa', idempotencyKey: null, createdAt: ahora, updatedAt: ahora, ...data };
    validarUnicos(fila);
    estado.inscripciones.push(fila);
    return fila;
  };

  const reiniciar = () => {
    estado.inscripciones = [];
    estado.historial = [];
    estado.notas = [];
    hooks.beforeCreate = null;
    hooks.errorCreate = null;
  };

  return { prisma, estado, hooks, insertarDirecto, reiniciar };
};

module.exports = { crearFakePrisma };
