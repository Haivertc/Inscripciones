-- Consistencia con Materias (control de cupos).
-- 1) Idempotency-Key: un reintento del cliente con la misma clave no crea otra fila.
-- 2) UNIQUE (estudiante_id, curso_id): una sola fila por estudiante y curso, así
--    dos peticiones simultáneas no pueden inscribir dos veces al mismo estudiante.
--
-- Si ya existen duplicados, la migración FALLA a propósito y no borra nada: hay que
-- revisarlos a mano (consulta en el README, sección "Migración de consistencia"),
-- marcar como resuelta la migración fallida y volver a ejecutarla.
-- Todo el script corre en una sola transacción implícita: si falla, no queda nada aplicado.

-- Verificación previa: aborta con un mensaje claro si hay duplicados
DO $$
DECLARE
  pares    INTEGER;
  ejemplos TEXT;
BEGIN
  SELECT COUNT(*),
         string_agg(format('(estudiante_id=%s, curso_id=%s, filas=%s)', estudiante_id, curso_id, filas), ', ')
    INTO pares, ejemplos
    FROM (
      SELECT estudiante_id, curso_id, COUNT(*) AS filas
        FROM "inscripciones"
       GROUP BY estudiante_id, curso_id
      HAVING COUNT(*) > 1
       ORDER BY estudiante_id, curso_id
       LIMIT 10
    ) AS duplicados;

  IF pares > 0 THEN
    RAISE EXCEPTION 'Migracion consistencia_cupos abortada: hay inscripciones duplicadas por (estudiante_id, curso_id). Primeros casos: %. Resuelvelos a mano con la consulta del README; esta migracion no borra datos.', ejemplos;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "inscripciones" ADD COLUMN "idempotency_key" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "inscripciones_idempotency_key_key" ON "inscripciones"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_insc" ON "inscripciones"("estudiante_id", "curso_id");
