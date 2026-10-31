const { PrismaClient } = require('@prisma/client');

// Instancia única compartida por todo el servicio
const prisma = new PrismaClient();

const dbConnect = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('La variable de entorno DATABASE_URL no está definida');
  }

  try {
    await prisma.$connect();
    console.log('PostgreSQL conectado mediante Prisma');
  } catch (error) {
    console.error(`Error al conectar a PostgreSQL: ${error.message}`);
    throw error;
  }
};

module.exports = { prisma, dbConnect };
