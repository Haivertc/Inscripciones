// Eventos que requieren atención (ReservaIncierta, CompensacionFallida...).
// Una línea JSON por evento para poder buscarlos en los logs (p. ej. CloudWatch)
// y reparar a mano el cupo en Materias.
const registrarEvento = (evento, datos = {}) => {
  console.error(JSON.stringify({ evento, fecha: new Date().toISOString(), ...datos }));
};

module.exports = { registrarEvento };
