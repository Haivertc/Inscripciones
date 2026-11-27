const { solicitar, unirUrl, ServicioNoDisponibleError } = require('./httpClient');

const SERVICIO = 'Materias';

const baseUrl = () => {
  if (!process.env.MATERIAS_URL) {
    throw new ServicioNoDisponibleError(SERVICIO, 'MATERIAS_URL no configurada');
  }
  return process.env.MATERIAS_URL;
};

const rutaCurso = (id) => `/api/materias/cursos/${encodeURIComponent(id)}`;

// GET idempotente: 1 reintento ante timeout o error de red
const obtenerCurso = (id) =>
  solicitar(SERVICIO, 'GET', unirUrl(baseUrl(), rutaCurso(id)), { reintentos: 1 });

// reservar/liberar NO son idempotentes: un reintento tras un timeout podría
// descontar (o devolver) el cupo dos veces. Por eso van sin reintento automático.
const reservarCupo = (id) =>
  solicitar(SERVICIO, 'POST', unirUrl(baseUrl(), `${rutaCurso(id)}/reservar-cupo`), { reintentos: 0 });

const liberarCupo = (id) =>
  solicitar(SERVICIO, 'POST', unirUrl(baseUrl(), `${rutaCurso(id)}/liberar-cupo`), { reintentos: 0 });

module.exports = { obtenerCurso, reservarCupo, liberarCupo, SERVICIO };
