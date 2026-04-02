# Migracion Legacy Junta General (Oficial)

Archivo SQL:
- `habioo-auth/migrations/20260402_legacy_normalization_junta_general.sql`

## Objetivo
Normalizar datos existentes (legacy) para el modelo Junta General <-> Junta Individual sin romper operacion actual:
1. Tipos de junta (`Junta General` / `Junta Individual`).
2. Jerarquia (`condominios.junta_general_id`).
3. Miembros en `junta_general_miembros`.
4. Proveedor "Junta General" dentro de cada individual vinculada.

## Caracteristicas
- Re-ejecutable (idempotente).
- Incluye trigger DB para bloquear miembro con el mismo RIF de su Junta General.
- No elimina datos historicos.
- Si un miembro ya tiene historial, conserva trazabilidad.

## Ejecucion
Ejecutar en PostgreSQL con un usuario que tenga permisos DDL/DML:

```sql
\i habioo-auth/migrations/20260402_legacy_normalization_junta_general.sql
```

O pegando el contenido completo en su cliente SQL.

## Verificaciones recomendadas
```sql
SELECT tipo, COUNT(*)
FROM condominios
GROUP BY tipo
ORDER BY tipo;

SELECT junta_general_id, COUNT(*) AS total_miembros
FROM junta_general_miembros
WHERE activo = true
GROUP BY junta_general_id
ORDER BY junta_general_id;

SELECT condominio_id, identificador, nombre, rubro, activo
FROM proveedores
WHERE rubro = 'Junta General'
ORDER BY condominio_id, id DESC;
```

## Notas
- Si alguna junta legacy no tiene RIF en `condominios`, no se crea proveedor para ese caso hasta completar el RIF.
- El trigger `tr_validar_rif_miembro_junta_general` evita definitivamente colisiones de RIF entre general y miembro.
