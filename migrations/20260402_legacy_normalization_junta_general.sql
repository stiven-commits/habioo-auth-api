BEGIN;

-- =========================================
-- Migracion legacy Junta General <-> Individual
-- Fecha: 2026-04-02
-- Objetivo:
-- 1) Normalizar tipo/jerarquia en condominios
-- 2) Poblar/normalizar junta_general_miembros
-- 3) Crear/reusar proveedor de Junta General en cada individual vinculada
-- Re-ejecutable: SI (idempotente)
-- =========================================

-- 0) Columnas base en condominios (si faltan)
ALTER TABLE condominios ADD COLUMN IF NOT EXISTS tipo varchar(40);
ALTER TABLE condominios ADD COLUMN IF NOT EXISTS junta_general_id integer REFERENCES condominios(id) ON DELETE SET NULL;
ALTER TABLE condominios ADD COLUMN IF NOT EXISTS cuota_participacion numeric(10,6);

-- 1) Normalizar RIF legacy de condominios
UPDATE condominios c
SET rif = NULLIF(UPPER(REGEXP_REPLACE(COALESCE(c.rif, ''), '[^A-Z0-9]', '', 'g')), '')
WHERE c.rif IS DISTINCT FROM NULLIF(UPPER(REGEXP_REPLACE(COALESCE(c.rif, ''), '[^A-Z0-9]', '', 'g')), '');

-- 2) Normalizar tipo legacy
UPDATE condominios c
SET tipo = CASE
    WHEN LOWER(BTRIM(COALESCE(c.tipo, ''))) = 'junta general' THEN 'Junta General'
    WHEN LOWER(BTRIM(COALESCE(c.tipo, ''))) = 'junta individual' THEN 'Junta Individual'
    ELSE 'Junta Individual'
END;

-- 3) Si alguien es padre de otras juntas, debe ser Junta General
UPDATE condominios g
SET tipo = 'Junta General'
WHERE EXISTS (
    SELECT 1
    FROM condominios i
    WHERE i.junta_general_id = g.id
);

-- 4) Regla jerarquica: una Junta General no depende de otra
UPDATE condominios c
SET junta_general_id = NULL
WHERE c.tipo = 'Junta General'
  AND c.junta_general_id IS NOT NULL;

-- 5) Evitar auto-vinculos invalidos
UPDATE condominios c
SET junta_general_id = NULL
WHERE c.junta_general_id = c.id;

-- 6) Si existe junta_general_id, forzar que el padre quede marcado como Junta General
UPDATE condominios g
SET tipo = 'Junta General'
WHERE g.id IN (
    SELECT DISTINCT i.junta_general_id
    FROM condominios i
    WHERE i.junta_general_id IS NOT NULL
);

-- 7) Esquema base Junta General (si falta)
CREATE TABLE IF NOT EXISTS junta_general_miembros (
    id SERIAL PRIMARY KEY,
    junta_general_id integer NOT NULL REFERENCES condominios(id) ON DELETE CASCADE,
    condominio_individual_id integer NULL REFERENCES condominios(id) ON DELETE SET NULL,
    nombre_referencia varchar(255) NOT NULL,
    rif varchar(32) NOT NULL,
    cuota_participacion numeric(10,6) NULL,
    activo boolean NOT NULL DEFAULT true,
    es_fantasma boolean NOT NULL DEFAULT true,
    codigo_invitacion varchar(64) NULL,
    codigo_expira_at timestamp NULL,
    vinculado_at timestamp NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    UNIQUE (junta_general_id, rif)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_junta_general_miembros_codigo_invitacion
ON junta_general_miembros (codigo_invitacion)
WHERE codigo_invitacion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_junta_general_miembros_general
ON junta_general_miembros (junta_general_id);

-- Trigger anti-colision: no permitir miembro con mismo RIF de su Junta General
CREATE OR REPLACE FUNCTION validar_rif_miembro_junta_general()
RETURNS trigger AS $$
DECLARE
    rif_general text;
    norm_miembro text;
    norm_general text;
BEGIN
    SELECT rif INTO rif_general
    FROM condominios
    WHERE id = NEW.junta_general_id
    LIMIT 1;

    norm_miembro := UPPER(REGEXP_REPLACE(COALESCE(NEW.rif, ''), '[^A-Z0-9]', '', 'g'));
    norm_general := UPPER(REGEXP_REPLACE(COALESCE(rif_general, ''), '[^A-Z0-9]', '', 'g'));

    IF norm_miembro <> '' AND norm_general <> '' AND norm_miembro = norm_general THEN
        RAISE EXCEPTION 'RIF_MIEMBRO_IGUAL_JUNTA_GENERAL';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_rif_miembro_junta_general
ON junta_general_miembros;

CREATE TRIGGER tr_validar_rif_miembro_junta_general
BEFORE INSERT OR UPDATE OF rif, junta_general_id
ON junta_general_miembros
FOR EACH ROW
EXECUTE FUNCTION validar_rif_miembro_junta_general();

-- 8) Poblar normalizar miembros desde relaciones legacy (junta_general_id)
INSERT INTO junta_general_miembros (
    junta_general_id,
    condominio_individual_id,
    nombre_referencia,
    rif,
    cuota_participacion,
    activo,
    es_fantasma,
    vinculado_at
)
SELECT
    i.junta_general_id,
    i.id,
    COALESCE(NULLIF(BTRIM(i.nombre_legal), ''), NULLIF(BTRIM(i.nombre), ''), CONCAT('Junta ', i.id::text)) AS nombre_referencia,
    UPPER(REGEXP_REPLACE(COALESCE(i.rif, CONCAT('J', i.id::text)), '[^A-Z0-9]', '', 'g')) AS rif,
    i.cuota_participacion,
    true,
    false,
    COALESCE(i.created_at, now())
FROM condominios i
INNER JOIN condominios g ON g.id = i.junta_general_id
WHERE i.junta_general_id IS NOT NULL
ON CONFLICT (junta_general_id, rif)
DO UPDATE SET
    condominio_individual_id = EXCLUDED.condominio_individual_id,
    nombre_referencia = EXCLUDED.nombre_referencia,
    cuota_participacion = EXCLUDED.cuota_participacion,
    activo = true,
    es_fantasma = false,
    vinculado_at = COALESCE(junta_general_miembros.vinculado_at, EXCLUDED.vinculado_at),
    updated_at = now();

-- 9) Indices/constraints proveedores para coexistencia por condominio
ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_identificador_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_proveedores_condominio_identificador
ON proveedores (condominio_id, identificador);
CREATE INDEX IF NOT EXISTS idx_proveedores_identificador
ON proveedores (identificador);

-- 10) Proveedor Junta General en cada individual vinculada
INSERT INTO proveedores (
    condominio_id,
    identificador,
    nombre,
    email,
    telefono1,
    telefono2,
    direccion,
    estado_venezuela,
    rubro,
    activo
)
SELECT
    i.id AS condominio_id,
    UPPER(REGEXP_REPLACE(COALESCE(g.rif, ''), '[^A-Z0-9]', '', 'g')) AS identificador,
    COALESCE(NULLIF(BTRIM(g.nombre_legal), ''), NULLIF(BTRIM(g.nombre), ''), 'Junta General') AS nombre,
    NULL,
    NULL,
    NULL,
    NULL,
    COALESCE(NULLIF(BTRIM(i.estado_venezuela), ''), NULLIF(BTRIM(g.estado_venezuela), ''), 'Distrito Capital') AS estado_venezuela,
    'Junta General' AS rubro,
    true AS activo
FROM condominios i
INNER JOIN condominios g ON g.id = i.junta_general_id
WHERE i.junta_general_id IS NOT NULL
  AND COALESCE(BTRIM(g.rif), '') <> ''
ON CONFLICT (condominio_id, identificador)
DO UPDATE SET
    nombre = EXCLUDED.nombre,
    estado_venezuela = EXCLUDED.estado_venezuela,
    rubro = 'Junta General',
    activo = true;

COMMIT;

-- Resumen rapido post-migracion
-- SELECT tipo, COUNT(*) FROM condominios GROUP BY tipo ORDER BY tipo;
-- SELECT COUNT(*) FROM junta_general_miembros WHERE activo = true;
-- SELECT COUNT(*) FROM proveedores WHERE rubro = 'Junta General' AND activo = true;
