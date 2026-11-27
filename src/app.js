const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./config/swagger');
const inscripcionesRoutes = require('./routes/inscripciones.routes');
const { ERRORES, responderError } = require('./utils/errores');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'inscripciones' });
});

// Documentación
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Rutas
app.use('/api/inscripciones', inscripcionesRoutes);

// 404
app.use((req, res) => {
  responderError(res, 404, ERRORES.rutaNoExiste, `Ruta no encontrada: ${req.method} ${req.originalUrl}`);
});

// Manejador global de errores
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);

  if (err.type === 'entity.parse.failed') {
    return responderError(res, 400, ERRORES.validacion, 'JSON inválido en el cuerpo de la petición');
  }

  const status = err.status || 500;
  return responderError(
    res,
    status,
    status === 500 ? ERRORES.errorInterno : ERRORES.validacion,
    status === 500 ? 'Error interno del servidor' : err.message
  );
});

module.exports = app;
