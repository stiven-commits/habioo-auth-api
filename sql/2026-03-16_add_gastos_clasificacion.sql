-- Etiqueta funcional para clasificar gastos en fijos o variables
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS clasificacion VARCHAR(20);

-- Backfill de datos historicos
UPDATE gastos
SET clasificacion = 'Variable'
WHERE clasificacion IS NULL OR TRIM(clasificacion) = '';

-- Restriccion semantica
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'gastos_clasificacion_check'
  ) THEN
    ALTER TABLE gastos
      ADD CONSTRAINT gastos_clasificacion_check
      CHECK (clasificacion IN ('Fijo', 'Variable'));
  END IF;
END $$;

