import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

interface AuthUser {
    id: number;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface ICondominioAdminTipoRow {
    id: number;
    tipo: string | null;
}

interface IReciboHistorialRow {
    id: number;
    mes_cobro: string;
    monto_usd: string | number;
    monto_pagado_usd: string | number;
    deuda_pendiente: string | number;
    estado: string;
    fecha: string;
    apto: string;
    propietario: string | null;
}

interface IReciboAvisoRow {
    id: number;
    estado: string;
    inmueble_identificador: string;
    inmueble_alicuota: string | number;
    propietario_nombre: string | null;
    inquilino_nombre: string | null;
    condominio_nombre: string | null;
    condominio_nombre_legal: string | null;
    condominio_rif: string | null;
    admin_nombre: string | null;
    admin_rif: string | null;
    admin_correo: string | null;
    logo_url: string | null;
    logo_condominio_url: string | null;
    cuenta_principal_banco: string | null;
    cuenta_principal_numero: string | null;
    cuenta_principal_rif: string | null;
    cuenta_principal_telefono: string | null;
    cuenta_principal_acepta_pago_movil: boolean | null;
    cuenta_principal_pago_movil_telefono: string | null;
    cuenta_principal_pago_movil_rif: string | null;
    snapshot_jsonb: Record<string, unknown> | null;
}

const asAuthUser = (value: unknown): AuthUser => {
    if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as { id?: unknown }).id !== 'number'
    ) {
        throw new TypeError('Invalid authenticated user');
    }
    return value as AuthUser;
};

const asError = (value: unknown): Error => {
    return value instanceof Error ? value : new Error(String(value));
};

const registerRecibosRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    const adminHasInmueblesScope = async (adminUserId: number): Promise<boolean> => {
        const cRes = await pool.query<ICondominioAdminTipoRow>(
            'SELECT id, tipo FROM condominios WHERE admin_user_id = $1 LIMIT 1',
            [adminUserId]
        );
        const condo = cRes.rows[0];
        if (!condo?.id) return true;
        return String(condo.tipo || '').trim().toLowerCase() !== 'junta general';
    };

    app.get('/recibos-historial', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const canAccessInmuebles = await adminHasInmueblesScope(user.id);
            if (!canAccessInmuebles) {
                return res.status(403).json({ status: 'error', message: 'La Junta General no puede visualizar historial de recibos por inmueble.' });
            }
            const r = await pool.query<IReciboHistorialRow>(
                `SELECT
                    r.id,
                    r.mes_cobro,
                    r.monto_usd,
                    COALESCE(r.monto_pagado_usd, 0) AS monto_pagado_usd,
                    GREATEST(r.monto_usd - COALESCE(r.monto_pagado_usd, 0), 0) AS deuda_pendiente,
                    r.estado,
                    TO_CHAR(r.fecha_emision, 'DD/MM/YYYY') as fecha,
                    p.identificador as apto,
                    u.nombre as propietario
                 FROM recibos r
                 JOIN propiedades p ON r.propiedad_id = p.id
                 LEFT JOIN usuarios_propiedades up ON p.id = up.propiedad_id AND up.rol = 'Propietario'
                 LEFT JOIN users u ON up.user_id = u.id
                 JOIN condominios c ON p.condominio_id = c.id
                 WHERE c.admin_user_id = $1
                 ORDER BY r.id DESC`,
                [user.id]
            );
            res.json({ status: 'success', recibos: r.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/recibos/:id/aviso', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const canAccessInmuebles = await adminHasInmueblesScope(user.id);
            if (!canAccessInmuebles) {
                return res.status(403).json({ status: 'error', message: 'La Junta General no puede visualizar avisos por inmueble.' });
            }
            const reciboId = parseInt(String(req.params.id || ''), 10);
            if (!Number.isFinite(reciboId) || reciboId <= 0) {
                return res.status(400).json({ status: 'error', message: 'ID de recibo invalido.' });
            }

            const result = await pool.query<IReciboAvisoRow>(
                `SELECT
                    r.id,
                    r.estado,
                    p.identificador AS inmueble_identificador,
                    p.alicuota AS inmueble_alicuota,
                    upo.nombre AS propietario_nombre,
                    upi.nombre AS inquilino_nombre,
                    c.nombre AS condominio_nombre,
                    c.nombre_legal AS condominio_nombre_legal,
                    c.rif AS condominio_rif,
                    c.admin_nombre,
                    c.admin_rif,
                    c.admin_correo,
                    c.logo_url,
                    c.logo_condominio_url,
                    cbp.nombre_banco AS cuenta_principal_banco,
                    cbp.numero_cuenta AS cuenta_principal_numero,
                    cbp.cedula_rif AS cuenta_principal_rif,
                    cbp.telefono AS cuenta_principal_telefono,
                    cbp.acepta_pago_movil AS cuenta_principal_acepta_pago_movil,
                    cbp.pago_movil_telefono AS cuenta_principal_pago_movil_telefono,
                    cbp.pago_movil_cedula_rif AS cuenta_principal_pago_movil_rif,
                    r.snapshot_jsonb
                 FROM recibos r
                 JOIN propiedades p ON p.id = r.propiedad_id
                 LEFT JOIN LATERAL (
                    SELECT u.nombre
                    FROM usuarios_propiedades up
                    JOIN users u ON u.id = up.user_id
                    WHERE up.propiedad_id = p.id
                      AND up.rol = 'Propietario'
                    ORDER BY up.id ASC
                    LIMIT 1
                 ) upo ON true
                 LEFT JOIN LATERAL (
                    SELECT u.nombre
                    FROM usuarios_propiedades up
                    JOIN users u ON u.id = up.user_id
                    WHERE up.propiedad_id = p.id
                      AND up.rol = 'Inquilino'
                    ORDER BY up.id ASC
                    LIMIT 1
                 ) upi ON true
                 JOIN condominios c ON c.id = p.condominio_id
                 LEFT JOIN LATERAL (
                    SELECT
                      cb.nombre_banco,
                      cb.numero_cuenta,
                      cb.cedula_rif,
                      cb.telefono,
                      cb.acepta_pago_movil,
                      cb.pago_movil_telefono,
                      cb.pago_movil_cedula_rif
                    FROM cuentas_bancarias cb
                    WHERE cb.condominio_id = c.id
                      AND COALESCE(cb.activo, true) = true
                    ORDER BY COALESCE(cb.es_predeterminada, false) DESC, cb.id ASC
                    LIMIT 1
                 ) cbp ON true
                 WHERE r.id = $1
                   AND (
                     c.admin_user_id = $2
                     OR EXISTS (
                       SELECT 1
                       FROM usuarios_propiedades up_perm
                       WHERE up_perm.propiedad_id = p.id
                         AND up_perm.user_id = $2
                         AND COALESCE(up_perm.acceso_portal, true) = true
                     )
                   )
                 LIMIT 1`,
                [reciboId, user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Recibo no encontrado.' });
            }

            const recibo = result.rows[0];
            if (!recibo.snapshot_jsonb) {
                return res.status(404).json({ status: 'error', message: 'Este recibo no tiene snapshot guardado.' });
            }

            const estadoRaw = String(recibo.estado || '').trim();
            const estadoRecibo =
                ['Pagado', 'Solvente', 'Recibo', 'Validado'].includes(estadoRaw)
                    ? 'Pagado'
                    : ['Abonado', 'Abonado Parcial', 'Parcial'].includes(estadoRaw)
                        ? 'Abonado'
                        : 'Pendiente';

            const propietario = recibo.propietario_nombre || 'Sin propietario';
            const inquilino = recibo.inquilino_nombre || null;
            const titularMostrado = inquilino ? `${propietario} / Inquilino: ${inquilino}` : propietario;

            const snapshotInmueble = (recibo.snapshot_jsonb as Record<string, unknown>).inmueble as Record<string, unknown> | undefined;
            const snapshotAdministradora = (recibo.snapshot_jsonb as Record<string, unknown>).administradora as Record<string, unknown> | undefined;
            const snapshotCondominio = (recibo.snapshot_jsonb as Record<string, unknown>).condominio as Record<string, unknown> | undefined;

            const condominioNombre = String(
                snapshotCondominio?.nombre
                || recibo.condominio_nombre_legal
                || recibo.condominio_nombre
                || ''
            );
            const condominioRif = String(snapshotCondominio?.rif || recibo.condominio_rif || '');

            const administradoraNombre = String(
                snapshotAdministradora?.nombre
                || recibo.admin_nombre
                || condominioNombre
                || ''
            );
            const administradoraRif = String(snapshotAdministradora?.rif || recibo.admin_rif || '');
            const administradoraCorreo = String(snapshotAdministradora?.correo || recibo.admin_correo || '');
            const administradoraLogo = snapshotAdministradora?.logo_url || recibo.logo_url || null;
            const condominioLogo = snapshotCondominio?.logo_url || recibo.logo_condominio_url || null;
            const cuentaPrincipalSnapshot = (recibo.snapshot_jsonb as Record<string, unknown>).cuenta_principal as Record<string, unknown> | undefined;

            const aviso = {
                ...recibo.snapshot_jsonb,
                estado_recibo: estadoRecibo,
                administradora: {
                    ...(snapshotAdministradora || {}),
                    nombre: administradoraNombre,
                    rif: administradoraRif,
                    correo: administradoraCorreo,
                    logo_url: administradoraLogo,
                },
                condominio: {
                    ...(snapshotCondominio || {}),
                    nombre: condominioNombre,
                    rif: condominioRif,
                    logo_url: condominioLogo,
                },
                cuenta_principal: {
                    ...(cuentaPrincipalSnapshot || {}),
                    nombre_banco: String(cuentaPrincipalSnapshot?.nombre_banco || recibo.cuenta_principal_banco || ''),
                    numero_cuenta: String(cuentaPrincipalSnapshot?.numero_cuenta || recibo.cuenta_principal_numero || ''),
                    cedula_rif: String(cuentaPrincipalSnapshot?.cedula_rif || recibo.cuenta_principal_rif || ''),
                    telefono: String(cuentaPrincipalSnapshot?.telefono || recibo.cuenta_principal_telefono || ''),
                    acepta_pago_movil: Boolean(
                        typeof cuentaPrincipalSnapshot?.acepta_pago_movil === 'boolean'
                            ? cuentaPrincipalSnapshot?.acepta_pago_movil
                            : recibo.cuenta_principal_acepta_pago_movil
                    ),
                    pago_movil_telefono: String(cuentaPrincipalSnapshot?.pago_movil_telefono || recibo.cuenta_principal_pago_movil_telefono || ''),
                    pago_movil_cedula_rif: String(cuentaPrincipalSnapshot?.pago_movil_cedula_rif || recibo.cuenta_principal_pago_movil_rif || ''),
                },
                inmueble: {
                    ...(snapshotInmueble || {}),
                    identificador: String(snapshotInmueble?.identificador || recibo.inmueble_identificador || ''),
                    alicuota: Number(snapshotInmueble?.alicuota ?? recibo.inmueble_alicuota ?? 0),
                    propietario: String(snapshotInmueble?.propietario || propietario),
                    inquilino: snapshotInmueble?.inquilino ?? inquilino,
                    titular_mostrado: String(snapshotInmueble?.titular_mostrado || titularMostrado),
                },
            };

            res.json({ status: 'success', aviso });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ status: 'error', message: error.message });
        }
    });
};

module.exports = { registerRecibosRoutes };

