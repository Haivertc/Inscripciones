const { obtenerContexto } = require('./contextoPeticion');

// Eventos que requieren atención (ReservaIncierta, CompensacionFallida...).
// Una línea JSON por evento para poder buscarlos en los logs (p. ej. CloudWatch)
// y reparar a mano el cupo en Materias. trace_id permite cruzarlos con la línea
// del datalake de la misma petición.
const registrarEvento = (evento, datos = {}) => {
  const traceId = obtenerContexto()?.traceId ?? null;
  console.error(JSON.stringify({ evento, fecha: new Date().toISOString(), trace_id: traceId, ...datos }));
};

module.exports = { registrarEvento };
