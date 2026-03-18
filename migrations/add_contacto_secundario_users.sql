-- ============================================================
-- MIGRACIÓN: Añadir correo secundario y teléfono alternativo
-- Tabla: users
-- Fecha: 2026-03-18
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_secundario  VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS telefono_secundario VARCHAR(50) DEFAULT NULL;

-- Comentarios descriptivos en las columnas
COMMENT ON COLUMN users.email_secundario    IS 'Correo electrónico secundario / alternativo del usuario';
COMMENT ON COLUMN users.telefono_secundario IS 'Teléfono alternativo o fijo del usuario';
