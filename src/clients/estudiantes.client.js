const { solicitar, unirUrl, ServicioNoDisponibleError } = require('./httpClient');

const SERVICIO = 'Estudiantes';

const baseUrl = () => {
  if (!process.env.ESTUDIANTES_URL) {
    throw new ServicioNoDisponibleError(SERVICIO, 'ESTUDIANTES_URL no configurada');
  }
  return process.env.ESTUDIANTES_URL;
};

// GET idempotente: 1 reintento ante timeout o error de red
const obtenerEstudiante = (id) =>
  solicitar(SERVICIO, 'GET', unirUrl(baseUrl(), `/api/estudiantes/${encodeURIComponent(id)}`), {
    reintentos: 1,
  });

module.exports = { obtenerEstudiante, SERVICIO };
