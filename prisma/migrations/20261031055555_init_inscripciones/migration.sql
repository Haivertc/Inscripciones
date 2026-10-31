-- Migración inicial del módulo Inscripciones (MongoDB -> PostgreSQL).
-- Regla de aislamiento: estudiante_id y curso_id referencian entidades de OTROS
-- microservicios, por eso son texto sin llave foránea. Las únicas FK son internas
-- (notas e historial -> inscripciones) y se eliminan en cascada.

-- CreateTable
CREATE TABLE "inscripciones" (
    "id" VARCHAR(24) NOT NULL,
    "estudiante_id" VARCHAR(64) NOT NULL,
    "curso_id" VARCHAR(64) NOT NULL,
    "periodo" VARCHAR(20) NOT NULL,
    "estado" VARCHAR(30) NOT NULL DEFAULT 'activa',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas" (
    "id" VARCHAR(24) NOT NULL,
    "inscripcion_id" VARCHAR(24) NOT NULL,
    "tipo" VARCHAR(100) NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_estados" (
    "id" VARCHAR(24) NOT NULL,
    "inscripcion_id" VARCHAR(24) NOT NULL,
    "estado_anterior" VARCHAR(30),
    "estado_nuevo" VARCHAR(30) NOT NULL,
    "motivo" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historial_estados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inscripciones_estudiante_id_idx" ON "inscripciones"("estudiante_id");

-- CreateIndex
CREATE INDEX "inscripciones_curso_id_idx" ON "inscripciones"("curso_id");

-- CreateIndex
CREATE INDEX "notas_inscripcion_id_idx" ON "notas"("inscripcion_id");

-- CreateIndex
CREATE INDEX "historial_estados_inscripcion_id_idx" ON "historial_estados"("inscripcion_id");

-- AddForeignKey
ALTER TABLE "notas" ADD CONSTRAINT "notas_inscripcion_id_fkey" FOREIGN KEY ("inscripcion_id") REFERENCES "inscripciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estados" ADD CONSTRAINT "historial_estados_inscripcion_id_fkey" FOREIGN KEY ("inscripcion_id") REFERENCES "inscripciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
