// Cliente HTTP mínimo sobre fetch para llamar directamente a otros módulos.
// Cada intento tiene un límite de tiempo (AbortSignal.timeout). Si el módulo no
// responde (timeout o error de red) se lanza ServicioNoDisponibleError; si responde,
// se devuelve { status, data } con cualquier código HTTP, y quien llama decide qué hacer.

const { obtenerContexto } = require('../utils/contextoPeticion');

const TIMEOUT_MS_POR_DEFECTO = 2000;

// x-trace-id, x-user-id y x-user-role de la petición original (si la hay), para que
// el datalake pueda seguir la misma petición a través de los módulos
const encabezadosPropagados = () => {
  try {
    const contexto = obtenerContexto();
    if (!contexto) return {};
    return {
      ...(contexto.traceId && { 'x-trace-id': contexto.traceId }),
      ...(contexto.userId && { 'x-user-id': contexto.userId }),
      ...(contexto.role && { 'x-user-role': contexto.role }),
    };
  } catch {
    return {};
  }
};

class ServicioNoDisponibleError extends Error {
  constructor(servicio, causa) {
    super(`El módulo ${servicio} no respondió (${causa})`);
    this.name = 'ServicioNoDisponibleError';
    this.servicio = servicio;
    this.causa = causa;
  }
}

// Se lee en cada llamada para poder ajustarlo en pruebas (HTTP_TIMEOUT_MS)
const timeoutMs = () => {
  const n = parseInt(process.env.HTTP_TIMEOUT_MS, 10);
  return Number.isInteger(n) && n > 0 ? n : TIMEOUT_MS_POR_DEFECTO;
};

const describirFallo = (error) => {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
  const codigo = error.cause && error.cause.code;
  return codigo ? `error de red: ${codigo}` : `error de red: ${error.message}`;
};

const leerCuerpo = async (respuesta) => {
  const texto = await respuesta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return { raw: texto };
  }
};

/**
 * @param {string} servicio  nombre del módulo, para los mensajes ("Estudiantes", "Materias")
 * @param {string} metodo    GET | POST
 * @param {string} url
 * @param {object} [opciones]
 * @param {number} [opciones.reintentos=0]  reintentos SOLO ante timeout o error de red
 * @param {object} [opciones.body]
 */
const solicitar = async (servicio, metodo, url, { reintentos = 0, body } = {}) => {
  let ultimoFallo;

  for (let intento = 0; intento <= reintentos; intento += 1) {
    try {
      const respuesta = await fetch(url, {
        method: metodo,
        headers: {
          Accept: 'application/json',
          ...encabezadosPropagados(),
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // Cubre la conexión y la lectura del cuerpo
        signal: AbortSignal.timeout(timeoutMs()),
      });
      const data = await leerCuerpo(respuesta);
      return { status: respuesta.status, data };
    } catch (error) {
      ultimoFallo = describirFallo(error);
    }
  }

  throw new ServicioNoDisponibleError(servicio, ultimoFallo);
};

// Une la URL base (se le quita la "/" final) con la ruta
const unirUrl = (base, ruta) => `${String(base).replace(/\/+$/, '')}${ruta}`;

module.exports = { solicitar, unirUrl, ServicioNoDisponibleError, TIMEOUT_MS_POR_DEFECTO };
