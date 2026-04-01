# QA Checklist - Junta General Fase 1

Este checklist valida la implementación de la jerarquía `Junta General -> Juntas Individuales` sin romper el flujo actual de `Junta Individual -> Inmuebles`.

## 1. Precondiciones

1. Ejecutar migración SQL `habioo-auth/migrations/20260401_junta_general_fase1.sql`.
2. Tener al menos:
- 1 condominio tipo `Junta General` con usuario administrador (cedula empieza por `J`).
- 1 condominio tipo `Junta Individual` con usuario administrador.
- 1 condominio tipo `Junta Individual` no registrado (fantasma, se creará como miembro sin vínculo).
3. Tener token JWT del admin de Junta General y otro token del admin de Junta Individual.
4. La Junta Individual vinculable debe tener moneda/flujo normal habilitado (USD/Bs) y módulo gastos activo.

## 2. Smoke test de permisos (bloqueos)

### 2.1 Junta General no puede manejar inmuebles

Con token de Junta General:

1. `GET /propiedades-admin` -> esperado `403`.
2. `POST /propiedades-admin` -> esperado `403`.
3. `GET /zonas` -> esperado `403`.
4. `POST /zonas` -> esperado `403`.

Validación: mensaje debe indicar que Junta General no puede gestionar inmuebles/zonas.

### 2.2 Junta Individual conserva capacidades existentes

Con token de Junta Individual:

1. `GET /propiedades-admin` -> esperado `200`.
2. `GET /zonas` -> esperado `200`.
3. Revisar que alta/edición de gasto siga igual (`POST /gastos`, `PUT /gastos/:id`).

## 3. Gestión de miembros de Junta General

Con token de Junta General:

### 3.1 Crear miembro fantasma

1. `POST /juntas-generales/miembros` con body:
```json
{
  "nombre_referencia": "Junta Torre Norte",
  "rif": "J-12345678-9",
  "cuota_participacion": 20
}
```
2. `GET /juntas-generales/miembros`.

Esperado:
- Miembro creado con `condominio_individual_id = null`.
- `es_fantasma = true`.

### 3.2 Crear miembro que ya existe en Habioo

1. `POST /juntas-generales/miembros` con RIF de una Junta Individual real.
2. `GET /juntas-generales/miembros`.

Esperado:
- Miembro con `condominio_individual_id` poblado.
- `es_fantasma = false`.
- Condominio individual actualizado con `junta_general_id`.
- Se crea/reusa proveedor de la General en la individual (match por RIF).

### 3.3 Generar código de invitación

1. `POST /juntas-generales/miembros/{id}/invitacion`.

Esperado:
- Retorna `codigo_invitacion` y `expira_at`.
- Persistido en tabla `junta_general_miembros`.

## 4. Vinculación por invitación (automática)

Con token de Junta Individual (no vinculada):

1. `POST /juntas-generales/aceptar-invitacion` con body:
```json
{ "codigo_invitacion": "<codigo>" }
```

Esperado:
- `200` éxito.
- `condominios.junta_general_id` actualizado en individual.
- `condominios.tipo` de individual queda en `Junta Individual`.
- `junta_general_miembros`: `es_fantasma=false`, `vinculado_at` con fecha, código limpiado.
- proveedor de Junta General creado/reusado en individual por RIF.
- notificación interna en `junta_general_notificaciones` para la individual.

## 5. Preliminar y cierre de ciclo - Junta General

Con token de Junta General:

### 5.1 Preliminar

1. Cargar gastos `Comun` o `Extra` pendientes en mes actual de la General.
2. `GET /preliminar`.

Esperado:
- `jerarquia_objetivo = "Juntas Individuales"`.
- `metodo_division` respeta regla actual o auto-resolución.
- total del preliminar correcto.

### 5.2 Cerrar ciclo

1. `POST /cerrar-ciclo`.

Esperado:
- Se crea 1 registro en `junta_general_avisos`.
- Se crean detalles en `junta_general_aviso_detalles` por miembro activo.
- Miembro fantasma queda estado `FANTASMA` sin gasto generado.
- Miembro vinculado genera 1 gasto en su junta individual:
- `gastos.origen_tipo = 'JUNTA_GENERAL'`
- `origen_aviso_general_id` y `origen_detalle_general_id` con trazabilidad
- concepto `Aviso Junta General - {periodo}`
- proveedor = Junta General por RIF
- Se crea cuota en `gastos_cuotas` de la individual para su `mes_actual`.
- `gastos_cuotas` de la General quedan `Procesado` y avanza `mes_actual`.

## 6. Validación en UI

### 6.1 Vista Junta General

1. Entrar con admin de Junta General.
2. Ir a `/junta-general`.

Esperado:
- Métricas cargan (generado, pagado, pendiente, morosidad).
- Tabla por junta individual muestra estado de cuenta.
- Se pueden registrar miembros y generar códigos.

### 6.2 Vista Cierres para Junta General

1. Ir a `/cierres` con junta general.

Esperado:
- No exige inmuebles para cierre.
- Permite cerrar ciclo con jerarquía Junta->Junta.

### 6.3 Notificaciones internas en header

1. Generar una notificación de Junta General (p.ej. vinculación o aviso recibido).
2. Esperar polling (hasta 15s).

Esperado:
- Aparece notificación flotante en el header.

## 7. Regresión de Junta Individual

Con token de Junta Individual:

1. Flujo gastos normal -> preliminar -> cierre.
2. Generación de avisos a inmuebles.
3. Pagos y estado de cuenta inmueble.

Esperado:
- Sin cambios funcionales inesperados.

## 8. Consultas rápidas de auditoría en BD

```sql
-- Miembros y vínculo
SELECT id, junta_general_id, condominio_individual_id, rif, cuota_participacion, es_fantasma, activo, vinculado_at
FROM junta_general_miembros
ORDER BY id DESC;

-- Avisos generales y detalles
SELECT * FROM junta_general_avisos ORDER BY id DESC;
SELECT * FROM junta_general_aviso_detalles ORDER BY id DESC;

-- Gastos generados en individuales por la general
SELECT id, condominio_id, proveedor_id, concepto, monto_usd, origen_tipo, origen_aviso_general_id, origen_detalle_general_id
FROM gastos
WHERE origen_tipo = 'JUNTA_GENERAL'
ORDER BY id DESC;

-- Proveedor por RIF en individual
SELECT id, condominio_id, identificador, nombre, activo
FROM proveedores
WHERE identificador = '<RIF_GENERAL_NORMALIZADO>'
ORDER BY condominio_id, id;
```

## 9. Criterio de salida (Done)

1. Todos los casos 2, 3, 4, 5 y 6 en verde.
2. Regresión del punto 7 en verde.
3. Sin errores TS/build:
- `habioo-auth`: `npx tsc --noEmit`
- `habioo-frontend`: `npm run build`
