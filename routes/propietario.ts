import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

const express: typeof import('express') = require('express');
const bcrypt: typeof import('bcryptjs') = require('bcryptjs');
const { pool }: { pool: Pool } = require('../config/db');
const { verifyToken }: {
  verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
} = require('../middleware/verifyToken');

interface AuthUserPayload {
  id: number;
}

interface ApiOk<T = Record<string, unknown>> {
  status: 'success';
  data?: T;
  message?: string;
}

interface ApiErr {
  status: 'error';
  message: string;
}

type ApiRes<T = Record<string, unknown>> = ApiOk<T> | ApiErr;

interface MisPropiedadesRow {
  id_propiedad: number;
  identificador: string;
  nombre_condominio: string;
  id_condominio: number;
  saldo_actual: string | number | null;
}

interface GastoComunRow {
  id: number;
  condominio_id: number;
  concepto: string;
  monto_bs: string | number;
  monto_usd: string | number;
  total_cuotas: number;
  fecha_gasto: string | Date;
  nota: string | null;
  clasificacion: string | null;
}

interface MisRecibosRow {
  id: number;
  propiedad_id: number;
  mes_cobro: string;
  monto_usd: string | number;
  monto_pagado_usd: string | number;
  estado: string;
  fecha_emision: string | Date;
  fecha_vencimiento: string | Date | null;
}

interface EstadoCuentaInmuebleRow {
  tipo: string;
  ref_id: number;
  concepto: string;
  cargo: string | number;
  abono: string | number;
  monto_bs: string | number | null;
  tasa_cambio: string | number | null;
  estado_recibo: string | null;
  fecha_operacion: string | Date;
  fecha_registro: string | Date;
}

interface EstadoCuentaRow {
  id: number;
  fecha: string | Date;
  tipo: string;
  monto: string | number;
  tasa_cambio: string | number | null;
  nota: string | null;
  concepto?: string | null;
  referencia?: string | null;
  referencia_id: number | null;
  fondo_id: number;
  fondo_nombre: string;
  fondo_moneda: string | null;
  cuenta_bancaria_id: number | null;
  banco_nombre: string | null;
  banco_apodo: string | null;
  banco_origen?: string | null;
  cedula_origen?: string | null;
}

interface FondoPrincipalRow {
  id: number;
  cuenta_bancaria_id: number;
  nombre: string;
  moneda: string | null;
  saldo_actual: string | number;
  visible_propietarios?: boolean;
  nombre_banco?: string | null;
  apodo?: string | null;
}

interface CuentaPrincipalRow {
  id: number;
  nombre_banco: string | null;
  apodo: string | null;
  tipo: string | null;
  es_predeterminada: boolean | null;
  acepta_transferencia?: boolean | null;
  acepta_pago_movil?: boolean | null;
  pago_movil_telefono?: string | null;
  pago_movil_cedula_rif?: string | null;
}

interface CuentaCondominioRow {
  id: number;
  nombre_banco: string | null;
  apodo: string | null;
  tipo: string | null;
  es_predeterminada: boolean | null;
  acepta_transferencia?: boolean | null;
  acepta_pago_movil?: boolean | null;
  pago_movil_telefono?: string | null;
  pago_movil_cedula_rif?: string | null;
}

interface NotificacionPagoRow {
  id: number;
  propiedad_id: number;
  recibo_id: number | null;
  referencia: string | null;
  monto_origen: string | number | null;
  monto_usd: string | number | null;
  estado: string;
  fecha_pago: string | Date | null;
  created_at: string | Date | null;
  nota: string | null;
  identificador: string;
  nombre_condominio: string;
}

interface PropietarioPerfilRow {
  id: number;
  nombre: string | null;
  cedula: string | null;
  email: string | null;
  telefono: string | null;
  email_secundario?: string | null;
  telefono_secundario?: string | null;
}

interface PerfilRelacionUserRow {
  id: number;
  nombre: string | null;
  cedula: string | null;
  email: string | null;
  telefono: string | null;
  email_secundario: string | null;
  telefono_secundario: string | null;
}

interface PerfilRolRow {
  rol: string;
}

interface UserIdRow {
  id: number;
}

interface PerfilRelacionesData {
  propiedad_id: number;
  rol_actual: string | null;
  propietario: PerfilRelacionUserRow | null;
  residente: PerfilRelacionUserRow | null;
  copropietarios: PerfilRelacionUserRow[];
}

interface CorteFondoRow {
  id: number;
  condominio_id: number;
  anio: number;
  mes: number;
  fondo_id: number;
  cuenta_bancaria_id: number | null;
  nombre_fondo: string;
  nombre_banco: string | null;
  apodo_cuenta: string | null;
  moneda: string;
  saldo_actual: string | number;
  saldo_bs: string | number;
  saldo_usd: string | number;
  tasa_referencia: string | number | null;
  visible_propietarios: boolean;
  created_at: string | Date;
}

interface CortePeriodoRow {
  anio: number;
  mes: number;
}

const router = express.Router();

const getAuthUser = (req: Request): AuthUserPayload | null => {
  const authUser = req.user as AuthUserPayload | undefined;
  if (!authUser || typeof authUser.id !== 'number') return null;
  return authUser;
};

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeNullableText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str : null;
};

const userHasCondominioAccess = async (userId: number, condominioId: number): Promise<boolean> => {
  const result = await pool.query<{ exists: number }>(
    `
      SELECT 1 AS exists
      FROM usuarios_propiedades up
      INNER JOIN propiedades p ON p.id = up.propiedad_id
      WHERE up.user_id = $1
        AND p.condominio_id = $2
        AND COALESCE(up.acceso_portal, true) = true
      LIMIT 1
    `,
    [userId, condominioId],
  );
  return result.rows.length > 0;
};

const userHasPropiedadAccess = async (userId: number, propiedadId: number): Promise<boolean> => {
  const result = await pool.query<{ exists: number }>(
    `
      SELECT 1 AS exists
      FROM usuarios_propiedades up
      WHERE up.user_id = $1
        AND up.propiedad_id = $2
        AND COALESCE(up.acceso_portal, true) = true
      LIMIT 1
    `,
    [userId, propiedadId],
  );
  return result.rows.length > 0;
};

router.get('/mis-propiedades', verifyToken, async (req: Request, res: Response<ApiRes<MisPropiedadesRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const result = await pool.query<MisPropiedadesRow>(
      `
        SELECT
          p.id AS id_propiedad,
          p.identificador,
          COALESCE(c.nombre_legal, c.nombre, 'Condominio') AS nombre_condominio,
          p.condominio_id AS id_condominio,
          COALESCE(p.saldo_actual, 0) AS saldo_actual
        FROM usuarios_propiedades up
        INNER JOIN propiedades p ON p.id = up.propiedad_id
        INNER JOIN condominios c ON c.id = p.condominio_id
        WHERE up.user_id = $1
          AND COALESCE(up.acceso_portal, true) = true
        ORDER BY p.condominio_id ASC, p.identificador ASC
      `,
      [authUser.id],
    );

    res.json({ status: 'success', data: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener propiedades.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/gastos/:condominio_id', verifyToken, async (req: Request, res: Response<ApiRes<GastoComunRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const condominioId = toPositiveInt(req.params.condominio_id);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'condominio_id inválido.' });
      return;
    }

    const hasAccess = await userHasCondominioAccess(authUser.id, condominioId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver gastos de este condominio.' });
      return;
    }

    const result = await pool.query<GastoComunRow>(
      `
        SELECT
          g.id,
          g.condominio_id,
          g.concepto,
          COALESCE(g.monto_bs, 0) AS monto_bs,
          COALESCE(g.monto_usd, 0) AS monto_usd,
          COALESCE(g.total_cuotas, 1) AS total_cuotas,
          g.fecha_gasto,
          g.nota,
          g.clasificacion
        FROM gastos g
        WHERE g.condominio_id = $1
          AND COALESCE(g.tipo, 'Comun') = 'Comun'
        ORDER BY g.fecha_gasto DESC, g.id DESC
      `,
      [condominioId],
    );

    res.json({ status: 'success', data: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener gastos.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/mis-recibos/:propiedad_id', verifyToken, async (req: Request, res: Response<ApiRes<MisRecibosRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const propiedadId = toPositiveInt(req.params.propiedad_id);
    if (!propiedadId) {
      res.status(400).json({ status: 'error', message: 'propiedad_id inválido.' });
      return;
    }

    const hasAccess = await userHasPropiedadAccess(authUser.id, propiedadId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver recibos de este inmueble.' });
      return;
    }

    const result = await pool.query<MisRecibosRow>(
      `
        SELECT
          r.id,
          r.propiedad_id,
          r.mes_cobro,
          COALESCE(r.monto_usd, 0) AS monto_usd,
          COALESCE(r.monto_pagado_usd, 0) AS monto_pagado_usd,
          r.estado,
          r.fecha_emision,
          r.fecha_vencimiento
        FROM recibos r
        WHERE r.propiedad_id = $1
        ORDER BY r.fecha_emision DESC, r.id DESC
      `,
      [propiedadId],
    );

    res.json({ status: 'success', data: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener recibos.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/estado-cuenta-inmueble/:propiedad_id', verifyToken, async (req: Request, res: Response<ApiRes<EstadoCuentaInmuebleRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const propiedadId = toPositiveInt(req.params.propiedad_id);
    if (!propiedadId) {
      res.status(400).json({ status: 'error', message: 'propiedad_id inválido.' });
      return;
    }

    const hasAccess = await userHasPropiedadAccess(authUser.id, propiedadId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver estado de cuenta de este inmueble.' });
      return;
    }

    const recibos = await pool.query<EstadoCuentaInmuebleRow>(
      `
        SELECT
          'RECIBO' AS tipo,
          r.id AS ref_id,
          CASE
            WHEN COALESCE(r.n8n_pdf_url, '') LIKE 'IMPORTACION_SILENCIOSA:%'
              THEN regexp_replace(COALESCE(r.n8n_pdf_url, ''), '^IMPORTACION_SILENCIOSA:\\s*', '')
            WHEN r.estado = 'Pagado' THEN 'Recibo: ' || r.mes_cobro
            ELSE 'Aviso de Cobro: ' || r.mes_cobro
          END AS concepto,
          COALESCE(r.monto_usd, 0) AS cargo,
          0 AS abono,
          NULL::numeric AS monto_bs,
          NULL::numeric AS tasa_cambio,
          r.estado AS estado_recibo,
          (r.fecha_emision AT TIME ZONE 'UTC') AS fecha_operacion,
          (r.fecha_emision AT TIME ZONE 'UTC') AS fecha_registro
        FROM recibos r
        WHERE r.propiedad_id = $1
      `,
      [propiedadId],
    );

    const pagos = await pool.query<EstadoCuentaInmuebleRow>(
      `
        SELECT
          'PAGO' AS tipo,
          p.id AS ref_id,
          'Pago Ref: ' || COALESCE(p.referencia, p.id::text) AS concepto,
          0 AS cargo,
          COALESCE(p.monto_usd, 0) AS abono,
          COALESCE(p.monto_origen, 0) AS monto_bs,
          p.tasa_cambio,
          NULL::text AS estado_recibo,
          (p.fecha_pago::timestamp AT TIME ZONE 'America/Caracas') AS fecha_operacion,
          COALESCE(
            p.created_at AT TIME ZONE 'UTC',
            p.fecha_pago::timestamp AT TIME ZONE 'America/Caracas'
          ) AS fecha_registro
        FROM pagos p
        WHERE p.propiedad_id = $1
          AND p.estado = 'Validado'
      `,
      [propiedadId],
    );

    const ajustes = await pool.query<EstadoCuentaInmuebleRow>(
      `
        SELECT
          'AJUSTE' AS tipo,
          h.id AS ref_id,
          TRIM(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(COALESCE(h.nota, 'Ajuste manual'), '\\s*\\|\\s*\\[(bs_raw|tasa_raw):[^\\]]+\\]', '', 'gi'),
                    '\\s*\\|\\s*ajuste_historial_id:\\d+',
                    '',
                    'gi'
                  ),
                  '\\s*\\|\\s*Inmueble:[^|]*', '', 'gi'
                ),
                '\\s*\\|\\s*Ajuste desde Cuentas por Cobrar[^|]*', '', 'gi'
              ),
              '\\s*\\|\\s*(Bs|Tasa)\\s*[0-9\\.,]+', '', 'gi'
            )
          ) AS concepto,
          CASE
            WHEN h.tipo IN ('CARGAR_DEUDA', 'DEUDA') OR (h.tipo = 'SALDO_INICIAL' AND COALESCE(h.nota, '') LIKE '%(DEUDA)%')
              THEN COALESCE(h.monto, 0)
            ELSE 0
          END AS cargo,
          CASE
            WHEN h.tipo IN ('AGREGAR_FAVOR', 'FAVOR') OR (h.tipo = 'SALDO_INICIAL' AND COALESCE(h.nota, '') LIKE '%(FAVOR)%')
              THEN COALESCE(h.monto, 0)
            ELSE 0
          END AS abono,
          COALESCE(
            h.monto_bs,
            NULLIF(
              split_part(split_part(COALESCE(h.nota, ''), '[bs_raw:', 2), ']', 1),
              ''
            )::numeric,
            NULLIF(
              replace(
                replace(substring(COALESCE(h.nota, '') FROM '[Bb][Ss][[:space:]]*([0-9][0-9\\.,]*)'), '.', ''),
                ',',
                '.'
              ),
              ''
            )::numeric,
            p_ajuste.monto_origen
          ) AS monto_bs,
          COALESCE(
            h.tasa_cambio,
            NULLIF(
              split_part(split_part(COALESCE(h.nota, ''), '[tasa_raw:', 2), ']', 1),
              ''
            )::numeric,
            NULLIF(
              replace(
                replace(substring(COALESCE(h.nota, '') FROM '[Tt][Aa][Ss][Aa][[:space:]]*([0-9][0-9\\.,]*)'), '.', ''),
                ',',
                '.'
              ),
              ''
            )::numeric,
            p_ajuste.tasa_cambio
          ) AS tasa_cambio,
          NULL::text AS estado_recibo,
          (h.fecha AT TIME ZONE 'UTC') AS fecha_operacion,
          (h.fecha AT TIME ZONE 'UTC') AS fecha_registro
        FROM historial_saldos_inmuebles h
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(p.monto_origen, 0)::numeric AS monto_origen,
            p.tasa_cambio
          FROM pagos p
          WHERE p.propiedad_id = h.propiedad_id
            AND COALESCE(p.nota, '') ILIKE ('%ajuste_historial_id:' || h.id::text || '%')
          ORDER BY COALESCE(p.created_at, p.fecha_pago::timestamp) DESC, p.id DESC
          LIMIT 1
        ) p_ajuste ON TRUE
        WHERE h.propiedad_id = $1
      `,
      [propiedadId],
    );

    const movimientos = [...recibos.rows, ...pagos.rows, ...ajustes.rows]
      .sort((a, b) => new Date(a.fecha_registro).getTime() - new Date(b.fecha_registro).getTime());

    res.json({ status: 'success', data: movimientos });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener estado de cuenta del inmueble.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/estado-cuenta/:condominio_id', verifyToken, async (req: Request, res: Response<ApiRes<EstadoCuentaRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const condominioId = toPositiveInt(req.params.condominio_id);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'condominio_id inválido.' });
      return;
    }

    const hasAccess = await userHasCondominioAccess(authUser.id, condominioId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver estado de cuenta de este condominio.' });
      return;
    }

    const cuentaId = toPositiveInt(req.query.cuenta_id);
    let cuentaFilterSql = '';
    const params: Array<number | string> = [condominioId];

    if (cuentaId) {
      const cuentaAccess = await pool.query<{ id: number }>(
        `
          SELECT cb.id
          FROM cuentas_bancarias cb
          WHERE cb.id = $1
            AND cb.condominio_id = $2
            AND COALESCE(cb.activo, true) = true
          LIMIT 1
        `,
        [cuentaId, condominioId],
      );
      if (cuentaAccess.rows.length === 0) {
        res.status(403).json({ status: 'error', message: 'No autorizado para ver esa cuenta bancaria.' });
        return;
      }
      params.push(cuentaId);
      cuentaFilterSql = ` AND cb.id = $${params.length} `;
    }

    const result = await pool.query<EstadoCuentaRow>(
      `
        WITH movimientos_base AS (
          SELECT
            mf.id,
            mf.fecha,
            CASE
              WHEN UPPER(COALESCE(mf.tipo, '')) IN ('EGRESO', 'SALIDA', 'DEBITO', 'DESCUENTO', 'PAGO_PROVEEDOR', 'EGRESO_PAGO')
                OR COALESCE(mf.nota, '') ILIKE 'Egreso manual libro mayor%'
                THEN 'EGRESO'
              ELSE 'INGRESO'
            END AS tipo,
            COALESCE(mf.monto, 0) AS monto,
            mf.tasa_cambio,
            mf.nota,
            CASE
              WHEN p.id IS NOT NULL
                THEN (
                  CASE
                    WHEN p.recibo_id IS NOT NULL
                      THEN ('Pago de Recibo #' || p.recibo_id::text || ' - Inmueble: ' || COALESCE(pr.identificador, 'N/A'))
                    ELSE ('Pago Ref: ' || COALESCE(NULLIF(BTRIM(p.referencia), ''), p.id::text) || ' - Inmueble: ' || COALESCE(pr.identificador, 'N/A'))
                  END
                )
              ELSE COALESCE(mf.nota, f.nombre, 'Movimiento')
            END AS concepto,
            COALESCE(p.referencia, NULLIF(mf.referencia_id::text, '')) AS referencia,
            mf.referencia_id,
            f.id AS fondo_id,
            f.nombre AS fondo_nombre,
            f.moneda AS fondo_moneda,
            cb.id AS cuenta_bancaria_id,
            cb.nombre_banco AS banco_nombre,
            cb.apodo AS banco_apodo,
            p.banco_origen,
            p.cedula_origen
          FROM movimientos_fondos mf
          INNER JOIN fondos f ON f.id = mf.fondo_id
          LEFT JOIN cuentas_bancarias cb ON cb.id = f.cuenta_bancaria_id
          LEFT JOIN pagos p ON p.id = mf.referencia_id
          LEFT JOIN propiedades pr ON pr.id = p.propiedad_id
          WHERE f.condominio_id = $1
            AND COALESCE(f.visible_propietarios, true) = true
            ${cuentaFilterSql}
        ),
        transferencias_salida AS (
          SELECT
            (1000000000 + t.id) AS id,
            t.fecha,
            'EGRESO'::text AS tipo,
            COALESCE(t.monto_origen, 0) AS monto,
            t.tasa_cambio,
            t.nota,
            ('Transferencia enviada a ' || COALESCE(cb_dest.nombre_banco, 'Cuenta destino') || ' - Fondo: ' || COALESCE(f_dest.nombre, 'N/A')) AS concepto,
            t.referencia,
            NULL::int AS referencia_id,
            f_orig.id AS fondo_id,
            f_orig.nombre AS fondo_nombre,
            f_orig.moneda AS fondo_moneda,
            cb_orig.id AS cuenta_bancaria_id,
            cb_orig.nombre_banco AS banco_nombre,
            cb_orig.apodo AS banco_apodo,
            NULL::text AS banco_origen,
            NULL::text AS cedula_origen
          FROM transferencias t
          INNER JOIN fondos f_orig ON f_orig.id = t.fondo_origen_id
          INNER JOIN fondos f_dest ON f_dest.id = t.fondo_destino_id
          LEFT JOIN cuentas_bancarias cb_orig ON cb_orig.id = f_orig.cuenta_bancaria_id
          LEFT JOIN cuentas_bancarias cb_dest ON cb_dest.id = f_dest.cuenta_bancaria_id
          WHERE t.condominio_id = $1
            AND COALESCE(f_orig.visible_propietarios, true) = true
            ${cuentaFilterSql.replace(/cb\./g, 'cb_orig.')}
        )
        SELECT *
        FROM (
          SELECT * FROM movimientos_base
          UNION ALL
          SELECT * FROM transferencias_salida
        ) mov
        ORDER BY mov.fecha DESC, mov.id DESC
      `,
      params,
    );

    res.json({ status: 'success', data: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener estado de cuenta.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/cuentas/:condominio_id', verifyToken, async (req: Request, res: Response<ApiRes<CuentaCondominioRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const condominioId = toPositiveInt(req.params.condominio_id);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'condominio_id inválido.' });
      return;
    }

    const hasAccess = await userHasCondominioAccess(authUser.id, condominioId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver cuentas de este condominio.' });
      return;
    }

    const result = await pool.query<CuentaCondominioRow>(
      `
        SELECT
          cb.id,
          cb.nombre_banco,
          cb.apodo,
          cb.tipo,
          cb.es_predeterminada,
          cb.acepta_transferencia,
          cb.acepta_pago_movil,
          cb.pago_movil_telefono,
          cb.pago_movil_cedula_rif
        FROM cuentas_bancarias cb
        INNER JOIN fondos f ON f.cuenta_bancaria_id = cb.id
        WHERE cb.condominio_id = $1
          AND COALESCE(cb.activo, true) = true
          AND COALESCE(f.activo, true) = true
          AND COALESCE(f.visible_propietarios, true) = true
        GROUP BY
          cb.id, cb.nombre_banco, cb.apodo, cb.tipo, cb.es_predeterminada,
          cb.acepta_transferencia, cb.acepta_pago_movil, cb.pago_movil_telefono, cb.pago_movil_cedula_rif
        ORDER BY
          CASE WHEN COALESCE(cb.es_predeterminada, false) THEN 0 ELSE 1 END,
          cb.id ASC
      `,
      [condominioId],
    );

    res.json({ status: 'success', data: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener cuentas bancarias.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/fondos-principal/:condominio_id', verifyToken, async (req: Request, res: Response<ApiRes<FondoPrincipalRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const condominioId = toPositiveInt(req.params.condominio_id);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'condominio_id inválido.' });
      return;
    }

    const hasAccess = await userHasCondominioAccess(authUser.id, condominioId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver fondos de este condominio.' });
      return;
    }

    const cuentaPrincipal = await pool.query<CuentaPrincipalRow>(
      `
        SELECT
          cb.id,
          cb.nombre_banco,
          cb.apodo,
          cb.tipo,
          cb.es_predeterminada,
          cb.acepta_transferencia,
          cb.acepta_pago_movil,
          cb.pago_movil_telefono,
          cb.pago_movil_cedula_rif
        FROM cuentas_bancarias cb
        INNER JOIN fondos f ON f.cuenta_bancaria_id = cb.id
        WHERE cb.condominio_id = $1
          AND COALESCE(cb.activo, true) = true
          AND COALESCE(f.activo, true) = true
        GROUP BY
          cb.id, cb.nombre_banco, cb.apodo, cb.tipo, cb.es_predeterminada,
          cb.acepta_transferencia, cb.acepta_pago_movil, cb.pago_movil_telefono, cb.pago_movil_cedula_rif
        ORDER BY
          CASE WHEN COALESCE(cb.es_predeterminada, false) THEN 0 ELSE 1 END,
          cb.id ASC
        LIMIT 1
      `,
      [condominioId],
    );

    if (cuentaPrincipal.rows.length === 0) {
      res.json({ status: 'success', data: [] });
      return;
    }

    const cuentaId = cuentaPrincipal.rows[0]?.id;
    const fondos = await pool.query<FondoPrincipalRow>(
      `
        SELECT
          f.id,
          f.cuenta_bancaria_id,
          COALESCE(f.nombre, 'Fondo') AS nombre,
          f.moneda,
          COALESCE(f.saldo_actual, 0) AS saldo_actual,
          COALESCE(f.visible_propietarios, true) AS visible_propietarios
        FROM fondos f
        WHERE f.condominio_id = $1
          AND f.cuenta_bancaria_id = $2
          AND COALESCE(f.activo, true) = true
          AND COALESCE(f.visible_propietarios, true) = true
        ORDER BY f.id ASC
      `,
      [condominioId, cuentaId],
    );

    res.json({ status: 'success', data: fondos.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener fondos principales.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/fondos/:condominio_id', verifyToken, async (req: Request, res: Response<ApiRes<FondoPrincipalRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const condominioId = toPositiveInt(req.params.condominio_id);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'condominio_id inválido.' });
      return;
    }

    const hasAccess = await userHasCondominioAccess(authUser.id, condominioId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver fondos de este condominio.' });
      return;
    }

    const fondos = await pool.query<FondoPrincipalRow>(
      `
        SELECT
          f.id,
          f.cuenta_bancaria_id,
          COALESCE(f.nombre, 'Fondo') AS nombre,
          f.moneda,
          COALESCE(f.saldo_actual, 0) AS saldo_actual,
          COALESCE(f.visible_propietarios, true) AS visible_propietarios,
          cb.nombre_banco,
          cb.apodo
        FROM fondos f
        LEFT JOIN cuentas_bancarias cb ON cb.id = f.cuenta_bancaria_id
        WHERE f.condominio_id = $1
          AND COALESCE(f.visible_propietarios, true) = true
          AND COALESCE(f.activo, true) = true
        ORDER BY f.id ASC
      `,
      [condominioId],
    );

    res.json({ status: 'success', data: fondos.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener fondos.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/estado-cuenta-cortes/:condominio_id', verifyToken, async (req: Request, res: Response<ApiRes<{ cortes: CorteFondoRow[]; periodos: CortePeriodoRow[] }>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const condominioId = toPositiveInt(req.params.condominio_id);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'condominio_id inválido.' });
      return;
    }

    const hasAccess = await userHasCondominioAccess(authUser.id, condominioId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver cortes de este condominio.' });
      return;
    }

    const anio = toPositiveInt(req.query.anio);
    const mes = toPositiveInt(req.query.mes);
    const cuentaId = toPositiveInt(req.query.cuenta_id);

    const params: Array<number> = [condominioId];
    let whereExtra = '';

    if (anio) {
      params.push(anio);
      whereExtra += ` AND cef.anio = $${params.length}`;
    }
    if (mes) {
      params.push(mes);
      whereExtra += ` AND cef.mes = $${params.length}`;
    }
    if (cuentaId) {
      params.push(cuentaId);
      whereExtra += ` AND cef.cuenta_bancaria_id = $${params.length}`;
    }

    const periodos = await pool.query<CortePeriodoRow>(
      `
      SELECT DISTINCT cef.anio, cef.mes
      FROM cortes_estado_cuenta_fondos cef
      WHERE cef.condominio_id = $1
        AND COALESCE(cef.visible_propietarios, true) = true
      ORDER BY cef.anio DESC, cef.mes DESC
      `,
      [condominioId],
    );

    const cortes = await pool.query<CorteFondoRow>(
      `
      SELECT
        cef.id,
        cef.condominio_id,
        cef.anio,
        cef.mes,
        cef.fondo_id,
        cef.cuenta_bancaria_id,
        cef.nombre_fondo,
        cef.nombre_banco,
        cef.apodo_cuenta,
        cef.moneda,
        COALESCE(cef.saldo_actual, 0) AS saldo_actual,
        COALESCE(cef.saldo_bs, 0) AS saldo_bs,
        COALESCE(cef.saldo_usd, 0) AS saldo_usd,
        cef.tasa_referencia,
        COALESCE(cef.visible_propietarios, true) AS visible_propietarios,
        cef.created_at
      FROM cortes_estado_cuenta_fondos cef
      WHERE cef.condominio_id = $1
        AND COALESCE(cef.visible_propietarios, true) = true
        ${whereExtra}
      ORDER BY cef.anio DESC, cef.mes DESC, cef.nombre_fondo ASC
      `,
      params,
    );

    res.json({
      status: 'success',
      data: {
        cortes: cortes.rows,
        periodos: periodos.rows,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener cortes del estado de cuenta.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/cuenta-principal/:condominio_id', verifyToken, async (req: Request, res: Response<ApiRes<CuentaPrincipalRow>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const condominioId = toPositiveInt(req.params.condominio_id);
    if (!condominioId) {
      res.status(400).json({ status: 'error', message: 'condominio_id inválido.' });
      return;
    }

    const hasAccess = await userHasCondominioAccess(authUser.id, condominioId);
    if (!hasAccess) {
      res.status(403).json({ status: 'error', message: 'No autorizado para ver cuentas de este condominio.' });
      return;
    }

    const result = await pool.query<CuentaPrincipalRow>(
      `
        SELECT
          cb.id,
          cb.nombre_banco,
          cb.apodo,
          cb.tipo,
          cb.es_predeterminada,
          cb.acepta_transferencia,
          cb.acepta_pago_movil,
          cb.pago_movil_telefono,
          cb.pago_movil_cedula_rif
        FROM cuentas_bancarias cb
        INNER JOIN fondos f ON f.cuenta_bancaria_id = cb.id
        WHERE cb.condominio_id = $1
          AND COALESCE(cb.activo, true) = true
          AND COALESCE(f.activo, true) = true
          AND COALESCE(f.visible_propietarios, true) = true
        GROUP BY
          cb.id, cb.nombre_banco, cb.apodo, cb.tipo, cb.es_predeterminada,
          cb.acepta_transferencia, cb.acepta_pago_movil, cb.pago_movil_telefono, cb.pago_movil_cedula_rif
        ORDER BY
          CASE WHEN COALESCE(cb.es_predeterminada, false) THEN 0 ELSE 1 END,
          cb.id ASC
        LIMIT 1
      `,
      [condominioId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ status: 'error', message: 'No hay cuenta principal activa para este condominio.' });
      return;
    }

    res.json({ status: 'success', data: result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener cuenta principal.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/notificaciones', verifyToken, async (req: Request, res: Response<ApiRes<NotificacionPagoRow[]>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const propiedadIdFilter = toPositiveInt(req.query.propiedad_id);
    let filterSql = '';
    const params: Array<number | string> = [authUser.id];

    if (propiedadIdFilter) {
      params.push(propiedadIdFilter);
      filterSql = ` AND p.id = $${params.length} `;
    }

    const result = await pool.query<NotificacionPagoRow>(
      `
        SELECT
          pa.id,
          pa.propiedad_id,
          pa.recibo_id,
          pa.referencia,
          COALESCE(pa.monto_origen, 0) AS monto_origen,
          COALESCE(pa.monto_usd, 0) AS monto_usd,
          pa.estado,
          pa.fecha_pago,
          pa.created_at,
          pa.nota,
          p.identificador,
          COALESCE(c.nombre_legal, c.nombre, 'Condominio') AS nombre_condominio
        FROM pagos pa
        INNER JOIN propiedades p ON p.id = pa.propiedad_id
        INNER JOIN condominios c ON c.id = p.condominio_id
        INNER JOIN usuarios_propiedades up ON up.propiedad_id = p.id
        WHERE up.user_id = $1
          AND COALESCE(up.acceso_portal, true) = true
          AND pa.estado IN ('PendienteAprobacion', 'Rechazado', 'Validado')
          ${filterSql}
        ORDER BY COALESCE(pa.created_at, pa.fecha_pago) DESC, pa.id DESC
        LIMIT 200
      `,
      params,
    );

    res.json({ status: 'success', data: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener notificaciones.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/perfil', verifyToken, async (req: Request, res: Response<ApiRes<PropietarioPerfilRow>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const result = await pool.query<PropietarioPerfilRow>(
      `
        SELECT
          u.id,
          u.nombre,
          u.cedula,
          u.email,
          u.email_secundario,
          u.telefono,
          u.telefono_secundario
        FROM users u
        WHERE u.id = $1
        LIMIT 1
      `,
      [authUser.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ status: 'error', message: 'Usuario no encontrado.' });
      return;
    }

    res.json({ status: 'success', data: result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener el perfil del propietario.';
    res.status(500).json({ status: 'error', message });
  }
});

router.get('/perfil-relaciones', verifyToken, async (req: Request, res: Response<ApiRes<PerfilRelacionesData>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const propiedadIdQuery = toPositiveInt((req.query as { propiedad_id?: unknown }).propiedad_id);
    let propiedadId = propiedadIdQuery;

    if (propiedadId) {
      const hasAccess = await userHasPropiedadAccess(authUser.id, propiedadId);
      if (!hasAccess) {
        res.status(403).json({ status: 'error', message: 'No tienes acceso a ese inmueble.' });
        return;
      }
    } else {
      const defaultPropRes = await pool.query<{ propiedad_id: number }>(
        `
          SELECT up.propiedad_id
          FROM usuarios_propiedades up
          WHERE up.user_id = $1
            AND COALESCE(up.acceso_portal, true) = true
          ORDER BY
            CASE
              WHEN up.rol = 'Propietario' THEN 1
              WHEN up.rol = 'Copropietario' THEN 2
              WHEN up.rol = 'Inquilino' THEN 3
              ELSE 9
            END,
            up.propiedad_id ASC
          LIMIT 1
        `,
        [authUser.id]
      );
      propiedadId = defaultPropRes.rows[0]?.propiedad_id || null;
      if (!propiedadId) {
        res.status(404).json({ status: 'error', message: 'No se encontró un inmueble asociado al usuario.' });
        return;
      }
    }

    const [rolActualRes, propietarioRes, residenteRes, copropsRes] = await Promise.all([
      pool.query<PerfilRolRow>(
        `
          SELECT up.rol
          FROM usuarios_propiedades up
          WHERE up.user_id = $1
            AND up.propiedad_id = $2
            AND COALESCE(up.acceso_portal, true) = true
          LIMIT 1
        `,
        [authUser.id, propiedadId]
      ),
      pool.query<PerfilRelacionUserRow>(
        `
          SELECT u.id, u.nombre, u.cedula, u.email, u.telefono, u.email_secundario, u.telefono_secundario
          FROM usuarios_propiedades up
          INNER JOIN users u ON u.id = up.user_id
          WHERE up.propiedad_id = $1
            AND up.rol = 'Propietario'
          LIMIT 1
        `,
        [propiedadId]
      ),
      pool.query<PerfilRelacionUserRow>(
        `
          SELECT u.id, u.nombre, u.cedula, u.email, u.telefono, u.email_secundario, u.telefono_secundario
          FROM usuarios_propiedades up
          INNER JOIN users u ON u.id = up.user_id
          WHERE up.propiedad_id = $1
            AND up.rol = 'Inquilino'
          LIMIT 1
        `,
        [propiedadId]
      ),
      pool.query<PerfilRelacionUserRow>(
        `
          SELECT u.id, u.nombre, u.cedula, u.email, u.telefono, u.email_secundario, u.telefono_secundario
          FROM usuarios_propiedades up
          INNER JOIN users u ON u.id = up.user_id
          WHERE up.propiedad_id = $1
            AND up.rol = 'Copropietario'
          ORDER BY u.nombre ASC NULLS LAST, u.cedula ASC NULLS LAST
        `,
        [propiedadId]
      ),
    ]);

    res.json({
      status: 'success',
      data: {
        propiedad_id: propiedadId,
        rol_actual: rolActualRes.rows[0]?.rol || null,
        propietario: propietarioRes.rows[0] || null,
        residente: residenteRes.rows[0] || null,
        copropietarios: copropsRes.rows,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener relaciones del inmueble.';
    res.status(500).json({ status: 'error', message });
  }
});

router.put('/perfil', verifyToken, async (req: Request, res: Response<ApiRes<PropietarioPerfilRow>>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const body = req.body as { cedula?: unknown; email?: unknown; email_secundario?: unknown; telefono?: unknown; telefono_secundario?: unknown };
    const cedula = normalizeNullableText(body.cedula)?.toUpperCase() ?? null;
    const email = normalizeNullableText(body.email)?.toLowerCase() ?? null;
    const emailSecundario = normalizeNullableText(body.email_secundario)?.toLowerCase() ?? null;
    const telefono = normalizeNullableText(body.telefono) ?? null;
    const telefonoSecundario = normalizeNullableText(body.telefono_secundario) ?? null;

    if (!cedula) {
      res.status(400).json({ status: 'error', message: 'La cédula es obligatoria.' });
      return;
    }
    if (!/^[VEJG][0-9]{5,9}$/i.test(cedula)) {
      res.status(400).json({ status: 'error', message: 'Formato de cédula inválido. Use V, E, J o G seguido de números.' });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ status: 'error', message: 'Formato de correo inválido.' });
      return;
    }
    if (emailSecundario && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSecundario)) {
      res.status(400).json({ status: 'error', message: 'Formato de correo secundario inválido.' });
      return;
    }
    if (telefono && !/^[0-9]{7,15}$/.test(telefono)) {
      res.status(400).json({ status: 'error', message: 'El teléfono debe contener solo números (7 a 15 dígitos).' });
      return;
    }
    if (telefonoSecundario && !/^[0-9]{7,15}$/.test(telefonoSecundario)) {
      res.status(400).json({ status: 'error', message: 'El teléfono alternativo debe contener solo números (7 a 15 dígitos).' });
      return;
    }

    const cedulaConflict = await pool.query<UserIdRow>(
      'SELECT id FROM users WHERE cedula = $1 AND id <> $2 LIMIT 1',
      [cedula, authUser.id]
    );
    if (cedulaConflict.rows.length > 0) {
      res.status(409).json({ status: 'error', message: 'La cédula ya está registrada por otro usuario.' });
      return;
    }

    if (email) {
      const emailConflict = await pool.query<UserIdRow>(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
        [email, authUser.id]
      );
      if (emailConflict.rows.length > 0) {
        res.status(409).json({ status: 'error', message: 'El correo ya está registrado por otro usuario.' });
        return;
      }
    }

    const updateRes = await pool.query<PropietarioPerfilRow>(
      `
        UPDATE users
        SET cedula = $1,
            email = $2,
            email_secundario = $3,
            telefono = $4,
            telefono_secundario = $5
        WHERE id = $6
        RETURNING id, nombre, cedula, email, email_secundario, telefono, telefono_secundario
      `,
      [cedula, email, emailSecundario, telefono, telefonoSecundario, authUser.id],
    );

    if (updateRes.rowCount === 0) {
      res.status(404).json({ status: 'error', message: 'Usuario no encontrado.' });
      return;
    }

    res.json({ status: 'success', message: 'Perfil actualizado correctamente.', data: updateRes.rows[0] });
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error) {
      const code = String((error as { code?: string }).code || '');
      if (code === '23505') {
        res.status(409).json({ status: 'error', message: 'La cédula o el correo ya están registrados por otro usuario.' });
        return;
      }
    }
    const message = error instanceof Error ? error.message : 'Error al actualizar el perfil del propietario.';
    res.status(500).json({ status: 'error', message });
  }
});

router.put('/perfil/password', verifyToken, async (req: Request, res: Response<ApiRes>): Promise<void> => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.status(401).json({ status: 'error', message: 'Usuario no autenticado.' });
      return;
    }

    const body = req.body as { nueva_password?: unknown };
    const nuevaPassword = String(body.nueva_password ?? '').trim();
    if (!nuevaPassword) {
      res.status(400).json({ status: 'error', message: 'Debe enviar nueva_password.' });
      return;
    }
    if (nuevaPassword.length < 6) {
      res.status(400).json({ status: 'error', message: 'La clave debe tener al menos 6 caracteres.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(nuevaPassword, 10);
    const updateRes = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, authUser.id],
    );

    if (updateRes.rowCount === 0) {
      res.status(404).json({ status: 'error', message: 'Usuario no encontrado.' });
      return;
    }

    res.json({ status: 'success', message: 'Clave actualizada correctamente.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al actualizar la clave del propietario.';
    res.status(500).json({ status: 'error', message });
  }
});

module.exports = router;
