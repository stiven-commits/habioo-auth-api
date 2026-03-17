-- Permite registrar copropietarios en la relacion usuarios_propiedades.
ALTER TABLE usuarios_propiedades
DROP CONSTRAINT IF EXISTS usuarios_propiedades_rol_check;

ALTER TABLE usuarios_propiedades
ADD CONSTRAINT usuarios_propiedades_rol_check
CHECK (
  rol IN ('Propietario', 'Inquilino', 'Administrador', 'Copropietario')
);
