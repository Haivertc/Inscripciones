// Contexto de la petición en curso (trace_id, usuario y rol) disponible en cualquier
// punto del flujo asíncrono sin pasarlo por parámetro. Lo establece el middleware
// del datalake y lo lee el cliente HTTP para reenviarlo a Estudiantes y Materias.
const { AsyncLocalStorage } = require('node:async_hooks');

const almacen = new AsyncLocalStorage();

// fn se ejecuta (y todo lo asíncrono que inicie) con este contexto
const ejecutarConContexto = (contexto, fn) => almacen.run(contexto, fn);

// { traceId, userId, role } o undefined fuera de una petición
const obtenerContexto = () => almacen.getStore();

module.exports = { ejecutarConContexto, obtenerContexto };
