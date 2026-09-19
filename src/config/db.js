const mongoose = require('mongoose');

const dbConnect = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('La variable de entorno MONGO_URI no está definida');
  }

  try {
    const conn = await mongoose.connect(uri);
    console.log(`MongoDB conectado: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`Error al conectar a MongoDB: ${error.message}`);
    throw error;
  }
};

module.exports = dbConnect;
