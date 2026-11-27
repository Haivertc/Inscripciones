// Formato único de error del módulo: { message, errorType }.
// res.locals.errorType lo lee el middleware del datalake.

const ERRORES = {
  validacion: 'ValidacionFallida',
  inscripcionNoExiste: 'InscripcionNoExiste',
  notaNoExiste: 'NotaNoExiste',
  historialNoExiste: 'HistorialNoExiste',
  rutaNoExiste: 'RutaNoExiste',
  idempotencyKeyReutilizada: 'IdempotencyKeyReutilizada',
  estudianteNoExiste: 'EstudianteNoExiste',
  estudianteInactivo: 'EstudianteInactivo',
  cursoNoExiste: 'CursoNoExiste',
  cursoInactivo: 'CursoInactivo',
  cupoAgotado: 'CupoAgotado',
  inscripcionDuplicada: 'InscripcionDuplicada',
  cambioNoPermitido: 'CambioNoPermitido',
  servicioNoDisponible: 'ServicioNoDisponible',
  errorInterno: 'ErrorInterno',
};

// Error de negocio con su código HTTP; lo lanza la capa de servicio y lo responde el controlador
class ErrorApi extends Error {
  constructor(status, errorType, message) {
    super(message);
    this.name = 'ErrorApi';
    this.status = status;
    this.errorType = errorType;
  }
}

const responderError = (res, status, errorType, message) => {
  res.locals.errorType = errorType;
  return res.status(status).json({ message, errorType });
};

module.exports = { ERRORES, ErrorApi, responderError };
