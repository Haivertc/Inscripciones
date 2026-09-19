require('dotenv').config();

const app = require('./app');
const dbConnect = require('./config/db');

const PORT = process.env.PORT || 8083;

const startServer = async () => {
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
