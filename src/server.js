require('dotenv').config();

const app = require('./app');
const { dbConnect } = require('./config/db');

const PORT = process.env.PORT || 3003;

const startServer = async () => {
  // Sin estas URLs el POST de inscripciones responde 503 (no puede validar ni reservar cupo)
  ['ESTUDIANTES_URL', 'MATERIAS_URL'].forEach((variable) => {
    if (!process.env[variable]) {
      console.warn(`ADVERTENCIA: ${variable} no está definida; POST /api/inscripciones responderá 503`);
    }
  });

  try {
    await dbConnect();
    app.listen(PORT, () => {
      console.log(`Microservicio Inscripciones escuchando en el puerto ${PORT}`);
    });
  } catch (error) {
    console.error(`No se pudo iniciar el servidor: ${error.message}`);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

startServer();
