// Validación y conversión de tipos equivalente a la que hacía Mongoose, con los
// mismos mensajes de error para no alterar el contrato del API.

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const tipoDe = (valor) => {
  if (Array.isArray(valor)) return 'Array';
  if (valor !== null && typeof valor === 'object') return 'Object';
  return typeof valor;
};

const errorDeCast = (tipo, valor, campo, modelo) =>
  `Cast to ${tipo} failed for value ${JSON.stringify(valor)} (type ${tipoDe(valor)}) at path "${campo}"` +
  (modelo ? ` for model "${modelo}"` : '');

// Devuelve { ok, valor } o { ok: false, mensaje }
const convertir = (spec, valor, campo, modelo) => {
  if (valor === null) return { ok: true, valor: null };

  if (spec.tipo === 'string') {
    if (['string', 'number', 'boolean'].includes(typeof valor)) {
      const texto = String(valor);
      return { ok: true, valor: spec.trim ? texto.trim() : texto };
    }
    return { ok: false, mensaje: errorDeCast('string', valor, campo, modelo) };
  }

  if (spec.tipo === 'number') {
    if (typeof valor === 'number' && Number.isFinite(valor)) return { ok: true, valor };
    if (typeof valor === 'boolean') return { ok: true, valor: valor ? 1 : 0 };
    if (typeof valor === 'string') {
      if (valor.trim() === '') return { ok: true, valor: null };
      const numero = Number(valor);
      if (Number.isFinite(numero)) return { ok: true, valor: numero };
    }
    return { ok: false, mensaje: errorDeCast('Number', valor, campo, modelo) };
  }

  throw new Error(`Tipo no soportado: ${spec.tipo}`);
};

const vacio = (valor) => valor === null || valor === undefined || valor === '';

/**
 * Valida `datos` contra los campos del modelo.
 * - Creación: aplica requeridos a todos los campos; mensaje "<Modelo> validation failed: ...".
 * - Actualización (parcial): solo valida los campos presentes; mensaje "Validation failed: ...".
 */
const validar = (modelo, datos, { parcial = false } = {}) => {
  const limpio = {};
  const errores = [];

  for (const [campo, spec] of Object.entries(modelo.campos)) {
    if (parcial && datos[campo] === undefined) continue;

    let valor = datos[campo];
    if (valor !== undefined) {
      const resultado = convertir(spec, valor, campo, parcial ? null : modelo.nombre);
      if (!resultado.ok) {
        errores.push(`${campo}: ${resultado.mensaje}`);
        continue;
      }
      valor = resultado.valor;
    }

    if (spec.requerido && vacio(valor)) {
      errores.push(`${campo}: ${spec.requerido}`);
      continue;
    }
    if (valor !== undefined) limpio[campo] = valor;
  }

  if (errores.length > 0) {
    const prefijo = parcial ? 'Validation failed' : `${modelo.nombre} validation failed`;
    throw new ValidationError(`${prefijo}: ${errores.join(', ')}`);
  }
  return limpio;
};

module.exports = { validar, ValidationError };
