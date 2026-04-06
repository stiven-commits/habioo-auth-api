import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

interface AuthUser {
    id: number;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface ICondominioIdRow {
    id: number;
    tipo?: string | null;
}

interface IPropiedadAdminRow extends Record<string, unknown> {
    id: number;
    identificador: string;
    alicuota: string | number;
    saldo_actual: string | number;
    prop_id: number | null;
    prop_nombre: string | null;
    prop_cedula: string | null;
    prop_email: string | null;
    prop_telefono: string | null;
    inq_id: number | null;
    inq_nombre: string | null;
    inq_cedula: string | null;
    inq_email: string | null;
    inq_telefono: string | null;
    inq_acceso_portal: boolean;
    can_delete: boolean;
}

interface IMovimientoEstadoCuentaRow {
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

interface IUserIdRow {
    id: number;
}

interface IUserProfileRow {
    id: number;
    cedula: string;
    nombre: string | null;
    email: string | null;
    telefono: string | null;
}

interface IPropiedadIdRow {
    id: number;
}

interface IPropiedadInsertedRow {
    id: number;
    identificador: string;
}

interface ILinkIdRow {
    id: number;
}

interface ICountRow {
    count: string;
}

interface IPropietarioExistenteRow {
    id: number;
    cedula: string;
    nombre: string | null;
    email: string | null;
    telefono: string | null;
}

interface PGError {
    code?: string;
    message: string;
}

interface PropiedadEstadoCuentaParams {
    id?: string;
}

interface CopropietarioParams {
    id?: string;
    linkId?: string;
}

interface InmuebleLote {
    identificador: string;
    alicuota?: string | number;
    saldo_inicial?: string | number;
    cedula?: string;
    nombre?: string;
    correo?: string;
    telefono?: string;
}

interface DeudaLote {
    identificador: string;
    concepto?: string;
    monto_total?: string | number;
    monto_abonado?: string | number;
    saldo?: string | number;
}

interface PropiedadesLoteBody {
    propiedades: InmuebleLote[];
    deudas?: DeudaLote[];
}

interface PropiedadAdminBody {
    identificador: string;
    alicuota?: string | number;
    zona_id?: string | number | null;
    prop_nombre?: string;
    prop_cedula?: string;
    prop_email?: string | null;
    prop_email_secundario?: string | null;
    prop_telefono?: string | null;
    prop_telefono_secundario?: string | null;
    prop_password?: string;
    tiene_inquilino?: boolean;
    inq_nombre?: string;
    inq_cedula?: string;
    inq_email?: string | null;
    inq_telefono?: string | null;
    inq_password?: string;
    inq_permitir_acceso?: boolean;
    monto_saldo_inicial?: string | number;
    tiene_deuda_inicial?: boolean;
    deudas_iniciales?: Array<{
        concepto?: string;
        monto_deuda?: string | number;
        monto_abono?: string | number;
    }>;
    propietario_modo?: 'NUEVO' | 'EXISTENTE';
    propietario_existente_id?: string | number | null;
}

interface PropiedadEditBody {
    identificador: string;
    alicuota?: string | number;
    zona_id?: string | number | null;
    prop_nombre?: string;
    prop_cedula?: string;
    prop_email?: string | null;
    prop_email_secundario?: string | null;
    prop_telefono?: string | null;
    prop_telefono_secundario?: string | null;
    prop_password?: string;
    tiene_inquilino?: boolean;
    inq_nombre?: string;
    inq_cedula?: string;
    inq_email?: string | null;
    inq_telefono?: string | null;
    inq_password?: string;
    inq_permitir_acceso?: boolean;
}

interface AjustarSaldoBody {
    monto?: string | number;
    tipo_ajuste: string;
    nota?: string;
    fecha_operacion?: string;
    referencia_origen?: string;
    banco_origen?: string;
    monto_bs?: string | number;
    tasa_cambio?: string | number;
    cuenta_bancaria_id?: number | null;
    es_gasto_extra?: boolean;
    gasto_extra_id?: number | null;
    subtipo_favor?: 'directo' | 'distribuido';
}

interface CopropietarioBody {
    cedula?: string;
    nombre?: string;
    email?: string | null;
    telefono?: string | null;
    acceso_portal?: boolean;
}

interface CopropietarioRow {
    id: number;
    user_id: number;
    propiedad_id: number;
    rol: string;
    acceso_portal: boolean;
    cedula: string;
    nombre: string | null;
    email: string | null;
    telefono: string | null;
}

interface IHistorialSaldoIdRow {
    id: number;
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

const asString = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new TypeError('Invalid string value');
    }
    return value;
};

const asError = (value: unknown): Error => {
    return value instanceof Error ? value : new Error(String(value));
};

const asPgError = (value: unknown): PGError => {
    if (typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string') {
        return value as PGError;
    }
    return { message: String(value) };
};

const normalizeWhitespace = (value: unknown): string =>
    String(value ?? '').trim().replace(/\s+/g, ' ');

const toTitleCase = (value: unknown): string =>
    normalizeWhitespace(value)
        .toLowerCase()
        .split(' ')
        .map((word) =>
            word
                .split('-')
                .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
                .join('-')
        )
        .join(' ');

const normalizeIdentifier = (value: unknown): string => normalizeWhitespace(value).toUpperCase();
const normalizeDoc = (value: unknown): string => normalizeWhitespace(value).toUpperCase();

const registerPropiedadesRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {

    const getCondominioByAdmin = async (adminUserId: number): Promise<ICondominioIdRow | null> => {
        const c = await pool.query<ICondominioIdRow>('SELECT id, tipo FROM condominios WHERE admin_user_id = $1 LIMIT 1', [adminUserId]);
        return c.rows[0] || null;
    };

    const resolveCondominioIdForInmuebles = async (adminUserId: number, res: Response): Promise<number | null> => {
        const condo = await getCondominioByAdmin(adminUserId);
        if (!condo?.id) {
            res.status(400).json({ error: 'No existe un condominio asociado a este usuario administrador.' });
            return null;
        }
        if (String(condo.tipo || '').trim().toLowerCase() === 'junta general') {
            res.status(403).json({ error: 'La Junta General no puede visualizar ni gestionar inmuebles.' });
            return null;
        }
        return condo.id;
    };

    const isValidEmail = (value: string | null | undefined): boolean => {
        if (!value) return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
    };

    const userHasLinksOutsideProperty = async (userId: number, propiedadId: number): Promise<boolean> => {
        const r = await pool.query<{ ok: number }>(
            `SELECT 1 AS ok
             FROM usuarios_propiedades
             WHERE user_id = $1
               AND propiedad_id <> $2
             LIMIT 1`,
            [userId, propiedadId]
        );
        return r.rows.length > 0;
    };

    const updateUserIfExclusiveToProperty = async (
        userId: number,
        propiedadId: number,
        values: { cedula?: string; nombre?: string; email?: string | null; telefono?: string | null; password?: string | null },
        failIfShared = false
    ): Promise<boolean> => {
        const hasExternalLinks = await userHasLinksOutsideProperty(userId, propiedadId);
        if (hasExternalLinks) {
            if (failIfShared) {
                throw new Error('El usuario está vinculado a otros inmuebles. Edite sus datos globales desde el perfil de usuario para evitar conflictos.');
            }
            return false;
        }

        const currentRes = await pool.query<IUserProfileRow>('SELECT id, cedula, nombre, email, telefono FROM users WHERE id = $1 LIMIT 1', [userId]);
        if (currentRes.rows.length === 0) return false;
        const current = currentRes.rows[0];

        const nextCedula = values.cedula ?? current.cedula;
        const nextNombre = values.nombre ?? (current.nombre || '');
        const nextEmail = values.email !== undefined ? values.email : current.email;
        const nextTelefono = values.telefono !== undefined ? values.telefono : current.telefono;

        await pool.query(
            'UPDATE users SET cedula = $1, nombre = $2, email = $3, telefono = $4 WHERE id = $5',
            [nextCedula, nextNombre, nextEmail, nextTelefono, userId]
        );
        if (values.password) {
            await pool.query('UPDATE users SET password = $1 WHERE id = $2', [values.password, userId]);
        }
        return true;
    };

    // 1. OBTENER PROPIEDADES
    app.get('/propiedades-admin', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) return;
            const r = await pool.query<IPropiedadAdminRow>(`
                SELECT p.id, p.identificador, p.alicuota,
                    ROUND(COALESCE(saldo_calc.saldo_calculado, p.saldo_actual, 0)::numeric, 2) AS saldo_actual,
                    u1.id as prop_id, u1.nombre as prop_nombre, u1.cedula as prop_cedula, u1.email as prop_email, u1.telefono as prop_telefono,
                    u2.id as inq_id, u2.nombre as inq_nombre, u2.cedula as inq_cedula, u2.email as inq_email, u2.telefono as inq_telefono,
                    COALESCE(up2.acceso_portal, true) as inq_acceso_portal,
                    NOT EXISTS (SELECT 1 FROM recibos r WHERE r.propiedad_id = p.id) as can_delete
                FROM propiedades p
                LEFT JOIN LATERAL (
                    SELECT
                        CASE
                            WHEN EXISTS (SELECT 1 FROM recibos r WHERE r.propiedad_id = p.id)
                              OR EXISTS (
                                    SELECT 1
                                    FROM historial_saldos_inmuebles h
                                    WHERE h.propiedad_id = p.id
                                      AND (
                                        h.tipo IN ('CARGAR_DEUDA', 'DEUDA', 'AGREGAR_FAVOR', 'FAVOR')
                                        OR (
                                            h.tipo = 'SALDO_INICIAL'
                                            AND (
                                                COALESCE(h.nota, '') ILIKE '%(DEUDA)%'
                                                OR (
                                                    COALESCE(h.nota, '') NOT ILIKE '%(FAVOR)%'
                                                    AND COALESCE(h.monto, 0) >= 0
                                                )
                                            )
                                        )
                                        OR (
                                            h.tipo = 'SALDO_INICIAL'
                                            AND (
                                                COALESCE(h.nota, '') ILIKE '%(FAVOR)%'
                                                OR (
                                                    COALESCE(h.nota, '') NOT ILIKE '%(DEUDA)%'
                                                    AND COALESCE(h.monto, 0) < 0
                                                )
                                            )
                                        )
                                      )
                                )
                              OR EXISTS (
                                    SELECT 1
                                    FROM pagos pa
                                    WHERE pa.propiedad_id = p.id
                                      AND pa.estado = 'Validado'
                                      AND COALESCE(pa.es_ajuste_historico, false) = false
                                )
                            THEN
                                COALESCE((
                                    SELECT SUM(COALESCE(r.monto_usd, 0))
                                    FROM recibos r
                                    WHERE r.propiedad_id = p.id
                                ), 0)
                                + COALESCE((
                                    SELECT SUM(
                                        CASE
                                            WHEN h.tipo IN ('CARGAR_DEUDA', 'DEUDA')
                                                THEN ABS(COALESCE(h.monto, 0))
                                            WHEN h.tipo = 'SALDO_INICIAL'
                                                 AND (
                                                     COALESCE(h.nota, '') ILIKE '%(DEUDA)%'
                                                     OR (
                                                         COALESCE(h.nota, '') NOT ILIKE '%(FAVOR)%'
                                                         AND COALESCE(h.monto, 0) >= 0
                                                     )
                                                 )
                                                THEN ABS(COALESCE(h.monto, 0))
                                            WHEN h.tipo IN ('AGREGAR_FAVOR', 'FAVOR')
                                                THEN -ABS(COALESCE(h.monto, 0))
                                            WHEN h.tipo = 'SALDO_INICIAL'
                                                 AND (
                                                     COALESCE(h.nota, '') ILIKE '%(FAVOR)%'
                                                     OR (
                                                         COALESCE(h.nota, '') NOT ILIKE '%(DEUDA)%'
                                                         AND COALESCE(h.monto, 0) < 0
                                                     )
                                                 )
                                                THEN -ABS(COALESCE(h.monto, 0))
                                            ELSE 0
                                        END
                                    )
                                    FROM historial_saldos_inmuebles h
                                    WHERE h.propiedad_id = p.id
                                ), 0)
                                - COALESCE((
                                     SELECT SUM(COALESCE(pa.monto_usd, 0))
                                     FROM pagos pa
                                     WHERE pa.propiedad_id = p.id
                                       AND pa.estado = 'Validado'
                                       AND COALESCE(pa.es_ajuste_historico, false) = false
                                 ), 0)
                            ELSE NULL
                        END AS saldo_calculado
                 ) saldo_calc ON TRUE
                LEFT JOIN usuarios_propiedades up1 ON p.id = up1.propiedad_id AND up1.rol = 'Propietario' LEFT JOIN users u1 ON up1.user_id = u1.id 
                LEFT JOIN usuarios_propiedades up2 ON p.id = up2.propiedad_id AND up2.rol = 'Inquilino' LEFT JOIN users u2 ON up2.user_id = u2.id
                WHERE p.condominio_id = $1 ORDER BY p.identificador ASC
            `, [condominioId]);
            const gastosRes = await pool.query<ICountRow>('SELECT COUNT(*)::text AS count FROM gastos WHERE condominio_id = $1', [condominioId]);
            const totalGastos = parseInt(gastosRes.rows[0]?.count || '0', 10) || 0;
            res.json({
                status: 'success',
                propiedades: r.rows,
                can_delete_all: totalGastos === 0
            });
        } catch (err: unknown) { const error = asError(err); res.status(500).json({ error: error.message }); }
    });

    // 1.1 OBTENER PROPIETARIOS YA REGISTRADOS EN EL CONDOMINIO
    app.get('/propiedades-admin/propietarios-existentes', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) return;

            const result = await pool.query<IPropietarioExistenteRow>(`
                SELECT DISTINCT
                    u.id,
                    u.cedula,
                    u.nombre,
                    u.email,
                    u.telefono
                FROM usuarios_propiedades up
                INNER JOIN propiedades p ON p.id = up.propiedad_id
                INNER JOIN users u ON u.id = up.user_id
                WHERE up.rol = 'Propietario'
                  AND p.condominio_id = $1
                ORDER BY u.nombre ASC NULLS LAST, u.cedula ASC
            `, [condominioId]);

            res.json({ status: 'success', propietarios: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    // 1.2 LISTAR COPROPIETARIOS DE UN INMUEBLE
    app.get('/propiedades-admin/:id/copropietarios', verifyToken, async (req: Request<PropiedadEstadoCuentaParams>, res: Response, _next: NextFunction) => {
        const propiedadIdRaw = asString(req.params.id);
        const propiedadId = parseInt(propiedadIdRaw, 10);
        if (!Number.isFinite(propiedadId) || propiedadId <= 0) {
            return res.status(400).json({ error: 'ID de inmueble inválido.' });
        }

        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) return;

            const propRes = await pool.query<IPropiedadIdRow>(
                'SELECT id FROM propiedades WHERE id = $1 AND condominio_id = $2 LIMIT 1',
                [propiedadId, condominioId]
            );
            if (propRes.rows.length === 0) {
                return res.status(404).json({ error: 'Inmueble no encontrado.' });
            }

            const result = await pool.query<CopropietarioRow>(
                `SELECT
                    up.id,
                    up.user_id,
                    up.propiedad_id,
                    up.rol,
                    COALESCE(up.acceso_portal, true) AS acceso_portal,
                    u.cedula,
                    u.nombre,
                    u.email,
                    u.telefono
                 FROM usuarios_propiedades up
                 INNER JOIN users u ON u.id = up.user_id
                 WHERE up.propiedad_id = $1
                   AND up.rol = 'Copropietario'
                 ORDER BY up.id ASC`,
                [propiedadId]
            );

            return res.json({ status: 'success', copropietarios: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ error: error.message });
        }
    });

    // 1.3 AGREGAR COPROPIETARIO A UN INMUEBLE
    app.post('/propiedades-admin/:id/copropietarios', verifyToken, async (req: Request<PropiedadEstadoCuentaParams, unknown, CopropietarioBody>, res: Response, _next: NextFunction) => {
        const propiedadIdRaw = asString(req.params.id);
        const propiedadId = parseInt(propiedadIdRaw, 10);
        if (!Number.isFinite(propiedadId) || propiedadId <= 0) {
            return res.status(400).json({ error: 'ID de inmueble inválido.' });
        }

        const cedulaNormalized = normalizeDoc(req.body?.cedula);
        const nombreNormalized = toTitleCase(req.body?.nombre);
        const correo = (req.body?.email || '').trim() || null;
        const telefono = normalizeWhitespace(req.body?.telefono) || null;
        const accesoPortal = req.body?.acceso_portal !== false;

        if (!cedulaNormalized || !nombreNormalized) {
            return res.status(400).json({ error: 'Cédula y nombre del copropietario son obligatorios.' });
        }
        if (!isValidEmail(correo)) {
            return res.status(400).json({ error: 'Email del copropietario inválido.' });
        }

        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');

            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) {
                await pool.query('ROLLBACK');
                return;
            }

            const propRes = await pool.query<IPropiedadIdRow>(
                'SELECT id FROM propiedades WHERE id = $1 AND condominio_id = $2 LIMIT 1',
                [propiedadId, condominioId]
            );
            if (propRes.rows.length === 0) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ error: 'Inmueble no encontrado.' });
            }

            const ownerRes = await pool.query<{ cedula: string }>(
                `SELECT u.cedula
                 FROM usuarios_propiedades up
                 INNER JOIN users u ON u.id = up.user_id
                 WHERE up.propiedad_id = $1
                   AND up.rol = 'Propietario'
                 ORDER BY up.id ASC
                 LIMIT 1`,
                [propiedadId]
            );
            if (ownerRes.rows.length > 0 && normalizeDoc(ownerRes.rows[0].cedula) === cedulaNormalized) {
                await pool.query('ROLLBACK');
                return res.status(409).json({ error: 'Este usuario ya es el propietario principal del inmueble.' });
            }

            let userId: number;
            const userByCedula = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1 LIMIT 1', [cedulaNormalized]);
            if (userByCedula.rows.length > 0) {
                userId = userByCedula.rows[0].id;
                await updateUserIfExclusiveToProperty(
                    userId,
                    propiedadId,
                    { nombre: nombreNormalized, email: correo, telefono },
                    false
                );
            } else {
                if (correo) {
                    const userByEmail = await pool.query<{ id: number }>(
                        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
                        [correo]
                    );
                    if (userByEmail.rows.length > 0) {
                        await pool.query('ROLLBACK');
                        return res.status(409).json({ error: 'El correo ingresado ya pertenece a otro usuario. Use otro correo o la cédula correcta.' });
                    }
                }

                const insertUser = await pool.query<IUserIdRow>(
                    'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                    [cedulaNormalized, nombreNormalized, correo, telefono, cedulaNormalized]
                );
                userId = insertUser.rows[0].id;
            }

            const existingAnyRole = await pool.query<{ id: number; rol: string }>(
                'SELECT id, rol FROM usuarios_propiedades WHERE propiedad_id = $1 AND user_id = $2 LIMIT 1',
                [propiedadId, userId]
            );

            if (existingAnyRole.rows.length > 0) {
                const currentRole = String(existingAnyRole.rows[0].rol || '');
                if (currentRole === 'Copropietario') {
                    await pool.query(
                        'UPDATE usuarios_propiedades SET acceso_portal = $1 WHERE id = $2',
                        [accesoPortal, existingAnyRole.rows[0].id]
                    );
                    await pool.query('COMMIT');
                    return res.json({ status: 'success', message: 'Copropietario actualizado correctamente.' });
                }
                await pool.query('ROLLBACK');
                return res.status(409).json({ error: `Este usuario ya está vinculado al inmueble como ${currentRole}.` });
            }

            await pool.query(
                'INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol, acceso_portal) VALUES ($1, $2, $3, $4)',
                [userId, propiedadId, 'Copropietario', accesoPortal]
            );

            await pool.query('COMMIT');
            return res.json({ status: 'success', message: 'Copropietario agregado correctamente.' });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            if (error.code === '23505' && error.message.includes('email')) {
                return res.status(400).json({ error: 'El correo ingresado ya pertenece a otro usuario en el sistema. Debe usar un correo distinto.' });
            }
            return res.status(500).json({ error: error.message });
        }
    });

    // 1.4 EDITAR COPROPIETARIO DE UN INMUEBLE
    app.put('/propiedades-admin/:id/copropietarios/:linkId', verifyToken, async (req: Request<CopropietarioParams, unknown, CopropietarioBody>, res: Response, _next: NextFunction) => {
        const propiedadIdRaw = asString(req.params.id);
        const linkIdRaw = asString(req.params.linkId);
        const propiedadId = parseInt(propiedadIdRaw, 10);
        const linkId = parseInt(linkIdRaw, 10);
        if (!Number.isFinite(propiedadId) || propiedadId <= 0 || !Number.isFinite(linkId) || linkId <= 0) {
            return res.status(400).json({ error: 'Parámetros inválidos.' });
        }

        const cedulaNormalized = normalizeDoc(req.body?.cedula);
        const nombreNormalized = toTitleCase(req.body?.nombre);
        const correo = (req.body?.email || '').trim() || null;
        const telefono = normalizeWhitespace(req.body?.telefono) || null;
        const accesoPortal = req.body?.acceso_portal !== false;

        if (!cedulaNormalized || !nombreNormalized) {
            return res.status(400).json({ error: 'Cédula y nombre del copropietario son obligatorios.' });
        }
        if (!isValidEmail(correo)) {
            return res.status(400).json({ error: 'Email del copropietario inválido.' });
        }

        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');

            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) {
                await pool.query('ROLLBACK');
                return;
            }

            const copropRes = await pool.query<{ id: number; user_id: number }>(
                `SELECT up.id, up.user_id
                 FROM usuarios_propiedades up
                 INNER JOIN propiedades p ON p.id = up.propiedad_id
                 WHERE up.id = $1
                   AND up.propiedad_id = $2
                   AND up.rol = 'Copropietario'
                   AND p.condominio_id = $3
                 LIMIT 1`,
                [linkId, propiedadId, condominioId]
            );

            if (copropRes.rows.length === 0) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ error: 'Copropietario no encontrado para este inmueble.' });
            }

            const userId = copropRes.rows[0].user_id;

            const cedulaConflict = await pool.query<{ id: number }>(
                'SELECT id FROM users WHERE cedula = $1 AND id <> $2 LIMIT 1',
                [cedulaNormalized, userId]
            );
            if (cedulaConflict.rows.length > 0) {
                await pool.query('ROLLBACK');
                return res.status(409).json({ error: 'La cédula ingresada ya pertenece a otro usuario.' });
            }

            if (correo) {
                const emailConflict = await pool.query<{ id: number }>(
                    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
                    [correo, userId]
                );
                if (emailConflict.rows.length > 0) {
                    await pool.query('ROLLBACK');
                    return res.status(409).json({ error: 'El correo ingresado ya pertenece a otro usuario.' });
                }
            }

            await updateUserIfExclusiveToProperty(
                userId,
                propiedadId,
                { cedula: cedulaNormalized, nombre: nombreNormalized, email: correo, telefono },
                true
            );

            await pool.query(
                'UPDATE usuarios_propiedades SET acceso_portal = $1 WHERE id = $2',
                [accesoPortal, linkId]
            );

            await pool.query('COMMIT');
            return res.json({ status: 'success', message: 'Copropietario actualizado correctamente.' });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            if (error.message.includes('vinculado a otros inmuebles')) {
                return res.status(409).json({ error: error.message });
            }
            if (error.code === '23505') {
                return res.status(409).json({ error: 'No se pudo actualizar porque cédula o correo ya existen en otro usuario.' });
            }
            return res.status(500).json({ error: error.message });
        }
    });

    // 1.5 ELIMINAR COPROPIETARIO DE UN INMUEBLE
    app.delete('/propiedades-admin/:id/copropietarios/:linkId', verifyToken, async (req: Request<CopropietarioParams>, res: Response, _next: NextFunction) => {
        const propiedadIdRaw = asString(req.params.id);
        const linkIdRaw = asString(req.params.linkId);
        const propiedadId = parseInt(propiedadIdRaw, 10);
        const linkId = parseInt(linkIdRaw, 10);
        if (!Number.isFinite(propiedadId) || propiedadId <= 0 || !Number.isFinite(linkId) || linkId <= 0) {
            return res.status(400).json({ error: 'Parámetros inválidos.' });
        }

        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) return;

            const result = await pool.query<{ id: number }>(
                `DELETE FROM usuarios_propiedades up
                 USING propiedades p
                 WHERE up.id = $1
                   AND up.propiedad_id = $2
                   AND up.rol = 'Copropietario'
                   AND p.id = up.propiedad_id
                   AND p.condominio_id = $3
                 RETURNING up.id`,
                [linkId, propiedadId, condominioId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Copropietario no encontrado para este inmueble.' });
            }

            return res.json({ status: 'success', message: 'Copropietario eliminado correctamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ error: error.message });
        }
    });

    app.delete('/propiedades-admin/eliminar-todos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) return;

            const gastosRes = await pool.query<ICountRow>('SELECT COUNT(*)::text AS count FROM gastos WHERE condominio_id = $1', [condominioId]);
            const totalGastos = parseInt(gastosRes.rows[0]?.count || '0', 10) || 0;
            if (totalGastos > 0) {
                return res.status(400).json({ error: 'No se puede eliminar inmuebles porque ya existen gastos cargados en el sistema.' });
            }

            await pool.query('BEGIN');

            await pool.query(
                `DELETE FROM pagos p
                 USING recibos r, propiedades pr
                 WHERE p.recibo_id = r.id
                   AND r.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM pagos p
                 USING propiedades pr
                 WHERE p.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM recibos r
                 USING propiedades pr
                 WHERE r.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM historial_saldos_inmuebles
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM usuarios_propiedades
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM propiedades_zonas
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condominioId]
            );

            const deletedRes = await pool.query<ICountRow>(
                `WITH deleted AS (
                    DELETE FROM propiedades
                    WHERE condominio_id = $1
                    RETURNING id
                 )
                 SELECT COUNT(*)::text AS count FROM deleted`,
                [condominioId]
            );

            await pool.query('COMMIT');

            const totalEliminados = parseInt(deletedRes.rows[0]?.count || '0', 10) || 0;
            res.json({ status: 'success', message: `Se eliminaron ${totalEliminados} inmuebles.` });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    // 2. ESTADO DE CUENTA
    app.get('/propiedades-admin/:id/estado-cuenta', verifyToken, async (req: Request<PropiedadEstadoCuentaParams>, res: Response, _next: NextFunction) => {
        const propiedadId = asString(req.params.id);
        try {
            // 1. Cargos (Recibos / Deudas)
            const recibos = await pool.query<IMovimientoEstadoCuentaRow>(
                `SELECT
                    'RECIBO' as tipo,
                    id as ref_id,
                    CASE
                      WHEN COALESCE(n8n_pdf_url, '') LIKE 'IMPORTACION_SILENCIOSA:%'
                        THEN regexp_replace(COALESCE(n8n_pdf_url, ''), '^IMPORTACION_SILENCIOSA:\\s*', '')
                      WHEN estado = 'Pagado' THEN 'Recibo: ' || mes_cobro
                      ELSE 'Aviso de Cobro: ' || mes_cobro
                    END as concepto,
                    monto_usd as cargo,
                    0 as abono,
                    NULL::numeric as monto_bs,
                    NULL::numeric as tasa_cambio,
                    estado as estado_recibo,
                    (fecha_emision AT TIME ZONE 'UTC') as fecha_operacion,
                    (fecha_emision AT TIME ZONE 'UTC') as fecha_registro
                 FROM recibos
                 WHERE propiedad_id = $1`,
                [propiedadId]
            );

            // ðŸ’¡ 2. Abonos (Pagos) - CORREGIDO: Ahora busca directamente por propiedad_id
            const pagos = await pool.query<IMovimientoEstadoCuentaRow>(
                `SELECT
                    'PAGO' as tipo,
                    id as ref_id,
                    'Pago Ref: ' || referencia as concepto,
                    0 as cargo,
                    monto_usd as abono,
                    COALESCE(monto_origen, 0) as monto_bs,
                    tasa_cambio,
                    NULL::text as estado_recibo,
                    (fecha_pago::timestamp AT TIME ZONE 'America/Caracas') as fecha_operacion,
                    COALESCE(
                      created_at AT TIME ZONE 'UTC',
                      fecha_pago::timestamp AT TIME ZONE 'America/Caracas'
                    ) as fecha_registro
                 FROM pagos
                 WHERE propiedad_id = $1
                   AND estado = 'Validado'
                   AND COALESCE(es_ajuste_historico, false) = false`,
                [propiedadId]
            );

            // 3. Ajustes Manuales (Saldos a favor / Deudas cargadas a mano)
            const ajustes = await pool.query<IMovimientoEstadoCuentaRow>(
                `SELECT
                    'AJUSTE' as tipo,
                    h.id as ref_id,
                    TRIM(
                      regexp_replace(
                        regexp_replace(
                          regexp_replace(
                            regexp_replace(
                              regexp_replace(COALESCE(h.nota, ''), '\\s*\\|\\s*\\[(bs_raw|tasa_raw):[^\\]]+\\]', '', 'gi'),
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
                    ) as concepto,
                    CASE
                        WHEN h.tipo IN ('CARGAR_DEUDA', 'DEUDA') THEN ABS(COALESCE(h.monto, 0))
                        WHEN h.tipo = 'SALDO_INICIAL'
                             AND (
                                 COALESCE(h.nota, '') ILIKE '%(DEUDA)%'
                                 OR (
                                     COALESCE(h.nota, '') NOT ILIKE '%(FAVOR)%'
                                     AND COALESCE(h.monto, 0) >= 0
                                 )
                             )
                            THEN ABS(COALESCE(h.monto, 0))
                        ELSE 0
                    END as cargo,
                    CASE
                        WHEN h.tipo IN ('AGREGAR_FAVOR', 'FAVOR') THEN ABS(COALESCE(h.monto, 0))
                        WHEN h.tipo = 'SALDO_INICIAL'
                             AND (
                                 COALESCE(h.nota, '') ILIKE '%(FAVOR)%'
                                 OR (
                                     COALESCE(h.nota, '') NOT ILIKE '%(DEUDA)%'
                                     AND COALESCE(h.monto, 0) < 0
                                 )
                             )
                            THEN ABS(COALESCE(h.monto, 0))
                        ELSE 0
                    END as abono,
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
                    ) as monto_bs,
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
                    ) as tasa_cambio,
                    NULL::text as estado_recibo,
                    COALESCE(
                      p_hist.fecha_pago::timestamp AT TIME ZONE 'America/Caracas',
                      (h.fecha AT TIME ZONE 'UTC')
                    ) as fecha_operacion,
                    (h.fecha AT TIME ZONE 'UTC') as fecha_registro
                 FROM historial_saldos_inmuebles h
                 LEFT JOIN pagos p_hist
                   ON p_hist.id = NULLIF((regexp_match(COALESCE(h.nota, ''), '#([0-9]+)'))[1], '')::int
                  AND p_hist.propiedad_id = h.propiedad_id
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
                   AND NOT (
                     h.tipo IN ('AGREGAR_FAVOR', 'FAVOR')
                     AND COALESCE(h.nota, '') ILIKE 'Pago validado%'
                   )`,
                [propiedadId]
            );

            const movimientos: IMovimientoEstadoCuentaRow[] = [...recibos.rows, ...pagos.rows, ...ajustes.rows];

            // Ordenamos cronolÃ³gicamente
            movimientos.sort((a, b) => new Date(a.fecha_registro).getTime() - new Date(b.fecha_registro).getTime());

            res.json({ status: 'success', movimientos });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    // 3. CARGA MASIVA BIMODAL (PROPIEDADES + DEUDAS) CON IMPORTACION SILENCIOSA
    app.post('/propiedades-admin/lote', verifyToken, async (req: Request<{}, unknown, PropiedadesLoteBody>, res: Response, _next: NextFunction) => {
        const propiedades = Array.isArray(req.body?.propiedades) ? req.body.propiedades : [];
        const deudas = Array.isArray(req.body?.deudas) ? req.body.deudas : [];

        if (propiedades.length === 0) {
            return res.status(400).json({ error: 'No se enviaron propiedades válidas.' });
        }

        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');

            const condoId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condoId) {
                await pool.query('ROLLBACK');
                return;
            }
            // 1) Regla de alícuotas no-mixtas.
            const alicuotasLote: number[] = propiedades.map((item) => {
                const alicuotaRaw = String(item?.alicuota ?? '0').replace(',', '.').trim();
                const alicuotaNum = parseFloat(alicuotaRaw);
                return Number.isNaN(alicuotaNum) ? 0 : alicuotaNum;
            });
            const allAlicuotasCero = alicuotasLote.every((alicuota: number) => alicuota === 0);
            const allAlicuotasMayorCero = alicuotasLote.every((alicuota: number) => alicuota > 0);
            if (!allAlicuotasCero && !allAlicuotasMayorCero) {
                throw new Error('El archivo Excel contiene alícuotas mixtas. O todos los inmuebles tienen alícuota 0 (partes iguales), o todos deben tener una alícuota mayor a 0.');
            }

            // 2) Bulk INSERT de propiedades + RETURNING id, identificador.
            const propValues: unknown[] = [];
            const propPlaceholders: string[] = [];
            propiedades.forEach((item: InmuebleLote, idx: number) => {
                const offset = idx * 4;
                const identificador = normalizeIdentifier(item.identificador);
                const alicuotaNum = parseFloat(String(item.alicuota ?? '0').replace(',', '.')) || 0;
                const saldoBase = parseFloat(String(item.saldo_inicial ?? '0').replace(',', '.')) || 0;
                propValues.push(condoId, identificador, alicuotaNum, saldoBase);
                propPlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
            });

            const insertPropsRes = await pool.query<IPropiedadInsertedRow>(
                `
                INSERT INTO propiedades (condominio_id, identificador, alicuota, saldo_actual)
                VALUES ${propPlaceholders.join(', ')}
                RETURNING id, identificador
                `,
                propValues
            );

            // 3) Mapa identificador -> propiedad_id.
            const propiedadIdByIdentificador = new Map<string, number>();
            insertPropsRes.rows.forEach((row) => {
                const key = normalizeIdentifier(row.identificador);
                propiedadIdByIdentificador.set(key, row.id);
            });

            // Mantener traza de saldo inicial del inmueble.
            for (const item of propiedades) {
                const saldoBase = parseFloat(String(item.saldo_inicial ?? '0').replace(',', '.')) || 0;
                if (saldoBase === 0) continue;
                const key = normalizeIdentifier(item.identificador);
                const propiedadId = propiedadIdByIdentificador.get(key);
                if (!propiedadId) continue;
                const tipoSaldo = saldoBase > 0 ? 'DEUDA' : 'FAVOR';
                await pool.query(
                    'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
                    [propiedadId, 'SALDO_INICIAL', Math.abs(saldoBase), `Carga masiva Excel (${tipoSaldo})`]
                );
            }

            // Vincular propietario (nombre + cedula) por cada inmueble cargado.
            for (const item of propiedades) {
                const key = normalizeIdentifier(item.identificador);
                const propiedadId = propiedadIdByIdentificador.get(key);
                if (!propiedadId) continue;

                const cedula = normalizeDoc(item.cedula);
                const nombre = toTitleCase(item.nombre);
                if (!cedula || !nombre) continue;

                const correoRaw = String(item.correo || '').trim().toLowerCase();
                const telefono = String(item.telefono || '').trim();
                const correo = isValidEmail(correoRaw) && correoRaw ? correoRaw : null;
                const telefonoFinal = telefono || null;

                let userId: number;
                const userRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1 LIMIT 1', [cedula]);
                if (userRes.rows.length === 0) {
                    const insertUser = await pool.query<IUserIdRow>(
                        'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [cedula, nombre, correo, telefonoFinal, cedula]
                    );
                    userId = insertUser.rows[0].id;
                } else {
                    userId = userRes.rows[0].id;
                    await updateUserIfExclusiveToProperty(
                        userId,
                        propiedadId,
                        { nombre, email: correo, telefono: telefonoFinal },
                        false
                    );
                }

                const linkUpdate = await pool.query(
                    'UPDATE usuarios_propiedades SET user_id = $1 WHERE propiedad_id = $2 AND rol = $3',
                    [userId, propiedadId, 'Propietario']
                );
                if (linkUpdate.rowCount === 0) {
                    await pool.query(
                        'INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)',
                        [userId, propiedadId, 'Propietario']
                    );
                }
            }

            // 4) Aplicar saldo importado por inmueble (deuda/favor/al dia) desde la hoja saldos_bases.
            const saldoPorPropiedad = new Map<number, number>();
            for (const deuda of deudas) {
                const key = normalizeIdentifier(deuda.identificador);
                const propiedadId = propiedadIdByIdentificador.get(key);
                if (!propiedadId) continue;

                const saldoRaw = String(deuda.saldo ?? '').trim();
                if (saldoRaw !== '') {
                    const saldoNum = parseFloat(saldoRaw.replace(',', '.'));
                    if (!Number.isNaN(saldoNum) && saldoNum !== 0) {
                        saldoPorPropiedad.set(propiedadId, saldoNum);
                    }
                }
            }

            for (const [propiedadId, saldo] of saldoPorPropiedad.entries()) {
                await pool.query('UPDATE propiedades SET saldo_actual = $1 WHERE id = $2', [saldo, propiedadId]);
                if (saldo !== 0) {
                    const tipoSaldo = saldo > 0 ? 'DEUDA' : 'FAVOR';
                    await pool.query(
                        'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
                        [propiedadId, 'SALDO_INICIAL', Math.abs(saldo), `Importacion Estado_Cuenta (${tipoSaldo})`]
                    );
                }
            }

            // 5) Importacion silenciosa:
            // no se generan recibos historicos ni avisos de cobro, solo se ajusta saldo inicial/importado.

            await pool.query('COMMIT');
            res.json({
                status: 'success',
                message: `${propiedades.length} inmuebles cargados correctamente (sin generar avisos de cobro).`,
                propiedades_insertadas: propiedades.length,
                deudas_procesadas: 0
            });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            if (error.code === '23505' && error.message.includes('identificador')) {
                return res.status(400).json({ error: 'Uno de los inmuebles (Apto/Casa) del archivo ya existe en el sistema.' });
            }
            if (error.code === '23505' && error.message.includes('email')) {
                return res.status(400).json({ error: 'Uno de los correos en el archivo ya está en uso.' });
            }
            if (error.message.includes('alícuotas mixtas')) {
                return res.status(400).json({ error: error.message });
            }
            res.status(500).json({ error: error.message });
        }
    });

    // 4. CREAR PROPIEDAD INDIVIDUAL
    app.post('/propiedades-admin', verifyToken, async (req: Request<{}, unknown, PropiedadAdminBody>, res: Response, _next: NextFunction) => {
        const {
            identificador,
            alicuota,
            zona_id,
            prop_nombre,
            prop_cedula,
            prop_email,
            prop_email_secundario,
            prop_telefono,
            prop_telefono_secundario,
            prop_password,
            tiene_inquilino,
            inq_nombre,
            inq_cedula,
            inq_email,
            inq_telefono,
            inq_password,
            inq_permitir_acceso,
            monto_saldo_inicial,
            tiene_deuda_inicial,
            deudas_iniciales,
            propietario_modo,
            propietario_existente_id
        } = req.body;
        const ownerEmail = (prop_email || '').trim() || null;
        const tenantEmail = (inq_email || '').trim() || null;
        const identificadorNormalized = normalizeIdentifier(identificador);
        const propCedulaNormalized = normalizeDoc(prop_cedula);
        const propNombreNormalized = toTitleCase(prop_nombre);
        const inqCedulaNormalized = normalizeDoc(inq_cedula);
        const inqNombreNormalized = toTitleCase(inq_nombre);
        const propietarioModo = propietario_modo === 'EXISTENTE' ? 'EXISTENTE' : 'NUEVO';
        const propietarioExistenteId = Number(propietario_existente_id);
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;
        const parseMoney = (value: string | number | undefined | null): number => {
            const parsed = parseFloat(String(value ?? '0').replace(',', '.'));
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const deudaItems = Array.isArray(deudas_iniciales) ? deudas_iniciales : [];
        const deudaItemsNormalizados = deudaItems.map((item) => {
            const montoDeuda = Math.max(parseMoney(item?.monto_deuda), 0);
            const montoAbono = Math.max(parseMoney(item?.monto_abono), 0);
            const montoNeto = Math.max(montoDeuda - montoAbono, 0);
            return {
                concepto: String(item?.concepto || '').trim(),
                montoDeuda,
                montoAbono,
                montoNeto
            };
        }).filter((item) => item.montoDeuda > 0 || item.montoAbono > 0 || item.concepto);
        const usarDeudaInicial = Boolean(tiene_deuda_inicial) && deudaItemsNormalizados.length > 0;
        const saldoBase = usarDeudaInicial
            ? deudaItemsNormalizados.reduce((acc, item) => acc + item.montoNeto, 0)
            : parseMoney(monto_saldo_inicial);
        if (!isValidEmail(ownerEmail)) return res.status(400).json({ error: 'Email del propietario invÃ¡lido.' });
        if (!isValidEmail(tenantEmail)) return res.status(400).json({ error: 'Email del inquilino invÃ¡lido.' });

        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');
            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) {
                await pool.query('ROLLBACK');
                return;
            }

            let userId: number | null = null;
            if (propietarioModo === 'EXISTENTE') {
                if (!Number.isFinite(propietarioExistenteId) || propietarioExistenteId <= 0) {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({ error: 'Debe seleccionar un propietario existente válido.' });
                }

                const propietarioRes = await pool.query<IUserIdRow>(`
                    SELECT u.id
                    FROM users u
                    INNER JOIN usuarios_propiedades up ON up.user_id = u.id AND up.rol = 'Propietario'
                    INNER JOIN propiedades p ON p.id = up.propiedad_id
                    WHERE u.id = $1
                      AND p.condominio_id = $2
                    LIMIT 1
                `, [propietarioExistenteId, condominioId]);

                if (propietarioRes.rows.length === 0) {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({ error: 'El propietario seleccionado no pertenece a este condominio.' });
                }

                userId = propietarioRes.rows[0].id;
            } else if (propCedulaNormalized && propNombreNormalized) {
                const userRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1', [propCedulaNormalized]);
                if (userRes.rows.length > 0) {
                    await pool.query('ROLLBACK');
                    return res.status(409).json({ error: 'La cédula ingresada ya existe. Use "Propietario Existente" para vincularlo.' });
                }

                // Si el correo ya existe en el sistema, reutilizamos ese usuario para evitar duplicados.
                if (ownerEmail) {
                    const userByEmailRes = await pool.query<{ id: number; cedula: string }>(
                        'SELECT id, cedula FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
                        [ownerEmail]
                    );
                    if (userByEmailRes.rows.length > 0) {
                        if (normalizeDoc(userByEmailRes.rows[0].cedula) !== propCedulaNormalized) {
                            await pool.query('ROLLBACK');
                            return res.status(409).json({ error: 'El correo ingresado pertenece a otro usuario con cédula distinta. Use "Propietario Existente".' });
                        }
                        userId = userByEmailRes.rows[0].id;
                    }
                }

                if (!userId) {
                    const insertRes = await pool.query<IUserIdRow>(
                        'INSERT INTO users (cedula, nombre, email, email_secundario, telefono, telefono_secundario, password) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                        [propCedulaNormalized, propNombreNormalized, ownerEmail, prop_email_secundario || null, prop_telefono || null, prop_telefono_secundario || null, prop_password || propCedulaNormalized]
                    );
                    userId = insertRes.rows[0].id;
                }
            }

            const propRes = await pool.query<IPropiedadIdRow>('INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id, saldo_actual) VALUES ($1, $2, $3, $4, $5) RETURNING id', [condominioId, identificadorNormalized, alicuotaNum, zona_id || null, saldoBase]);
            const nuevaPropId = propRes.rows[0].id;

            if (usarDeudaInicial) {
                for (const item of deudaItemsNormalizados) {
                    if (item.montoNeto <= 0) continue;
                    const concepto = item.concepto || 'Deuda anterior importada';
                    const nota = `Saldo inicial cargado al crear el inmueble (DEUDA) - ${concepto} | Monto deuda: ${item.montoDeuda.toFixed(2)} | Abono: ${item.montoAbono.toFixed(2)}`;
                    await pool.query(
                        'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
                        [nuevaPropId, 'SALDO_INICIAL', item.montoNeto, nota]
                    );
                }
            } else if (saldoBase !== 0) {
                const tipoSaldo = saldoBase > 0 ? 'DEUDA' : 'FAVOR';
                await pool.query('INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', [nuevaPropId, 'SALDO_INICIAL', Math.abs(saldoBase), `Saldo inicial cargado al crear el inmueble (${tipoSaldo})`]);
            }
            if (userId) await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, nuevaPropId, 'Propietario']);

            if (tiene_inquilino && inqCedulaNormalized && inqNombreNormalized) {
                const inqPermitirAcceso = inq_permitir_acceso !== false;
                let tenantRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1', [inqCedulaNormalized]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query<IUserIdRow>('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [inqCedulaNormalized, inqNombreNormalized, tenantEmail, inq_telefono || null, inq_password || inqCedulaNormalized]);
                } else {
                    const existingTenantId = tenantRes.rows[0].id;
                    await updateUserIfExclusiveToProperty(
                        existingTenantId,
                        nuevaPropId,
                        { nombre: inqNombreNormalized, email: tenantEmail, telefono: inq_telefono || null, password: inq_password || null },
                        false
                    );
                }
                await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol, acceso_portal) VALUES ($1, $2, $3, $4)', [tenantRes.rows[0].id, nuevaPropId, 'Inquilino', inqPermitirAcceso]);
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble guardado correctamente' });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            if (error.code === '23505' && error.message.includes('email')) return res.status(400).json({ error: 'El correo ingresado ya pertenece a otro usuario en el sistema. Debe usar un correo distinto.' });
            res.status(500).json({ error: error.message });
        }
    });

    // 5. EDITAR PROPIEDAD INDIVIDUAL
    app.put('/propiedades-admin/:id', verifyToken, async (req: Request<PropiedadEstadoCuentaParams, unknown, PropiedadEditBody>, res: Response, _next: NextFunction) => {
        const propiedadId = asString(req.params.id);
        const { identificador, alicuota, zona_id, prop_nombre, prop_cedula, prop_email, prop_email_secundario, prop_telefono, prop_telefono_secundario, prop_password, tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password, inq_permitir_acceso } = req.body;

        const ownerEmail = (prop_email || '').trim() || null;
        const ownerEmailSec = (prop_email_secundario || '').trim() || null;
        const ownerTelefonoSec = (prop_telefono_secundario || '').trim() || null;
        const tenantEmail = (inq_email || '').trim() || null;
        const identificadorNormalized = normalizeIdentifier(identificador);
        const propCedulaNormalized = normalizeDoc(prop_cedula);
        const propNombreNormalized = toTitleCase(prop_nombre);
        const inqCedulaNormalized = normalizeDoc(inq_cedula);
        const inqNombreNormalized = toTitleCase(inq_nombre);
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;
        if (!isValidEmail(ownerEmail)) return res.status(400).json({ error: 'Email del propietario inválido.' });
        if (!isValidEmail(tenantEmail)) return res.status(400).json({ error: 'Email del inquilino inválido.' });

        try {
            await pool.query('BEGIN');
            await pool.query('UPDATE propiedades SET identificador = $1, alicuota = $2, zona_id = $3 WHERE id = $4', [identificadorNormalized, alicuotaNum, zona_id || null, propiedadId]);

            if (propCedulaNormalized && propNombreNormalized) {
                const propiedadIdNum = parseInt(propiedadId, 10) || 0;
                const currentOwnerLinkRes = await pool.query<{ id: number; user_id: number }>(
                    'SELECT id, user_id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2 LIMIT 1',
                    [propiedadId, 'Propietario']
                );
                const currentOwnerUserId = currentOwnerLinkRes.rows[0]?.user_id || null;

                let userRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1', [propCedulaNormalized]);
                let userId: number | null = null;
                if (userRes.rows.length === 0) {
                    // Si el propietario actual ya está vinculado a este inmueble, actualizamos ese mismo usuario
                    // para evitar conflicto de correo único al cambiar únicamente la cédula.
                    if (currentOwnerUserId) {
                        const updatedCurrentOwner = await updateUserIfExclusiveToProperty(
                            currentOwnerUserId,
                            propiedadIdNum,
                            { cedula: propCedulaNormalized, nombre: propNombreNormalized, email: ownerEmail, telefono: prop_telefono || null, password: prop_password || null },
                            false
                        );

                        if (updatedCurrentOwner) {
                            await pool.query(
                                'UPDATE users SET email_secundario = $1, telefono_secundario = $2 WHERE id = $3',
                                [ownerEmailSec, ownerTelefonoSec, currentOwnerUserId]
                            );
                            userId = currentOwnerUserId;
                        } else {
                            return res.status(409).json({
                                error: 'No se pudo actualizar la cédula porque el usuario está vinculado a otros inmuebles. Edite este dato desde su perfil global o use un propietario existente.'
                            });
                        }
                    }

                    if (!userId) {
                        userRes = await pool.query<IUserIdRow>(
                            'INSERT INTO users (cedula, nombre, email, email_secundario, telefono, telefono_secundario, password) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                            [propCedulaNormalized, propNombreNormalized, ownerEmail, ownerEmailSec, prop_telefono || null, ownerTelefonoSec, prop_password || propCedulaNormalized]
                        );
                        userId = userRes.rows[0].id;
                    }
                } else {
                    const existingOwnerId = userRes.rows[0].id;
                    await updateUserIfExclusiveToProperty(
                        existingOwnerId,
                        propiedadIdNum,
                        { nombre: propNombreNormalized, email: ownerEmail, telefono: prop_telefono || null, password: prop_password || null },
                        false
                    );
                    // Actualizar campos secundarios adicionales
                    await pool.query(
                        'UPDATE users SET email_secundario = $1, telefono_secundario = $2 WHERE id = $3',
                        [ownerEmailSec, ownerTelefonoSec, existingOwnerId]
                    );
                    userId = existingOwnerId;
                }
                const linkRes = await pool.query<{ id: number; user_id: number }>('SELECT id, user_id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Propietario']);
                if (linkRes.rows.length > 0) { 
                    const oldUserId = linkRes.rows[0].user_id;
                    await pool.query('UPDATE usuarios_propiedades SET user_id = $1 WHERE id = $2', [userId, linkRes.rows[0].id]); 
                    
                    if (oldUserId !== userId) {
                        await pool.query(`
                            DELETE FROM users 
                            WHERE id = $1 
                              AND NOT EXISTS (SELECT 1 FROM usuarios_propiedades WHERE user_id = $1)
                              AND NOT EXISTS (SELECT 1 FROM condominios WHERE admin_user_id = $1)
                        `, [oldUserId]);
                    }
                }
                else { await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, propiedadId, 'Propietario']); }
            }

            if (tiene_inquilino && inqCedulaNormalized && inqNombreNormalized) {
                const inqPermitirAcceso = inq_permitir_acceso !== false;
                let tenantRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1', [inqCedulaNormalized]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query<IUserIdRow>('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [inqCedulaNormalized, inqNombreNormalized, tenantEmail, inq_telefono || null, inq_password || inqCedulaNormalized]);
                } else {
                    const existingTenantId = tenantRes.rows[0].id;
                    const propiedadIdNum = parseInt(propiedadId, 10) || 0;
                    await updateUserIfExclusiveToProperty(
                        existingTenantId,
                        propiedadIdNum,
                        { nombre: inqNombreNormalized, email: tenantEmail, telefono: inq_telefono || null, password: inq_password || null },
                        false
                    );
                }
                const tenantId = tenantRes.rows[0].id;
                const tenantLink = await pool.query<{ id: number; user_id: number }>('SELECT id, user_id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
                if (tenantLink.rows.length > 0) { 
                    const oldTenantId = tenantLink.rows[0].user_id;
                    await pool.query('UPDATE usuarios_propiedades SET user_id = $1, acceso_portal = $2 WHERE id = $3', [tenantId, inqPermitirAcceso, tenantLink.rows[0].id]); 
                    
                    if (oldTenantId !== tenantId) {
                        await pool.query(`
                            DELETE FROM users 
                            WHERE id = $1 
                              AND NOT EXISTS (SELECT 1 FROM usuarios_propiedades WHERE user_id = $1)
                              AND NOT EXISTS (SELECT 1 FROM condominios WHERE admin_user_id = $1)
                        `, [oldTenantId]);
                    }
                }
                else { await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol, acceso_portal) VALUES ($1, $2, $3, $4)', [tenantId, propiedadId, 'Inquilino', inqPermitirAcceso]); }
            } else {
                const tenantLinks = await pool.query<{ user_id: number }>('SELECT user_id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
                await pool.query('DELETE FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
                
                for (const row of tenantLinks.rows) {
                    await pool.query(`
                        DELETE FROM users 
                        WHERE id = $1 
                          AND NOT EXISTS (SELECT 1 FROM usuarios_propiedades WHERE user_id = $1)
                          AND NOT EXISTS (SELECT 1 FROM condominios WHERE admin_user_id = $1)
                    `, [row.user_id]);
                }
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble actualizado correctamente' });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            if (error.code === '23505' && error.message.includes('email')) return res.status(400).json({ error: 'El correo ingresado ya pertenece a otro usuario en el sistema. Debe usar un correo distinto.' });
            res.status(500).json({ error: error.message });
        }
    });

    // 6. ELIMINAR PROPIEDAD INDIVIDUAL (solo si no tiene avisos/recibos)
    app.delete('/propiedades-admin/:id', verifyToken, async (req: Request<PropiedadEstadoCuentaParams>, res: Response, _next: NextFunction) => {
        const propiedadIdRaw = asString(req.params.id);
        const propiedadId = parseInt(propiedadIdRaw, 10);
        if (!Number.isFinite(propiedadId) || propiedadId <= 0) {
            return res.status(400).json({ error: 'ID de inmueble inválido.' });
        }

        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForInmuebles(user.id, res);
            if (!condominioId) return;

            const propRes = await pool.query<IPropiedadIdRow>(
                'SELECT id FROM propiedades WHERE id = $1 AND condominio_id = $2 LIMIT 1',
                [propiedadId, condominioId]
            );
            if (propRes.rows.length === 0) {
                return res.status(404).json({ error: 'Inmueble no encontrado.' });
            }

            const recibosRes = await pool.query<ICountRow>(
                'SELECT COUNT(*)::text AS count FROM recibos WHERE propiedad_id = $1',
                [propiedadId]
            );
            const totalRecibos = parseInt(recibosRes.rows[0]?.count || '0', 10) || 0;
            if (totalRecibos > 0) {
                return res.status(400).json({ error: 'No se puede eliminar este inmueble porque ya tiene avisos/recibos generados.' });
            }

            await pool.query('BEGIN');
            await pool.query('DELETE FROM pagos WHERE propiedad_id = $1', [propiedadId]);
            await pool.query('DELETE FROM historial_saldos_inmuebles WHERE propiedad_id = $1', [propiedadId]);
            
            const usersToDelete = await pool.query<{ user_id: number }>('SELECT user_id FROM usuarios_propiedades WHERE propiedad_id = $1', [propiedadId]);
            await pool.query('DELETE FROM usuarios_propiedades WHERE propiedad_id = $1', [propiedadId]);
            
            await pool.query('DELETE FROM propiedades_zonas WHERE propiedad_id = $1', [propiedadId]);
            await pool.query('DELETE FROM propiedades WHERE id = $1 AND condominio_id = $2', [propiedadId, condominioId]);
            
            for (const row of usersToDelete.rows) {
                await pool.query(`
                    DELETE FROM users 
                    WHERE id = $1 
                      AND NOT EXISTS (SELECT 1 FROM usuarios_propiedades WHERE user_id = $1)
                      AND NOT EXISTS (SELECT 1 FROM condominios WHERE admin_user_id = $1)
                `, [row.user_id]);
            }
            
            await pool.query('COMMIT');

            res.json({ status: 'success', message: 'Inmueble eliminado correctamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    // 7. AJUSTAR SALDO MANUALMENTE
    app.post('/propiedades-admin/:id/ajustar-saldo', verifyToken, async (req: Request<PropiedadEstadoCuentaParams, unknown, AjustarSaldoBody>, res: Response, _next: NextFunction) => {
        const propiedadId = asString(req.params.id);
        const { monto, tipo_ajuste, nota, fecha_operacion, referencia_origen, banco_origen, monto_bs, tasa_cambio, cuenta_bancaria_id, es_gasto_extra, gasto_extra_id, subtipo_favor } = req.body;
        const montoNum = parseFloat((monto || '0').toString().replace(',', '.')) || 0;
        if (montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

        const fechaOperacionRaw = normalizeWhitespace(fecha_operacion);
        if (fechaOperacionRaw && !/^\d{4}-\d{2}-\d{2}$/.test(fechaOperacionRaw)) {
            return res.status(400).json({ error: 'fecha_operacion inválida. Use formato YYYY-MM-DD.' });
        }
        const fechaOperacionYmd = fechaOperacionRaw || null;
        const referenciaOrigen = normalizeWhitespace(referencia_origen);
        const bancoOrigen = normalizeWhitespace(banco_origen);
        if (!referenciaOrigen) {
            return res.status(400).json({ error: 'referencia_origen es requerida.' });
        }
        if (!bancoOrigen) {
            return res.status(400).json({ error: 'banco_origen es requerido.' });
        }

        const tipoAjusteRaw = String(tipo_ajuste || '').trim().toUpperCase();
        const esCargaDeuda = tipoAjusteRaw === 'CARGAR_DEUDA' || tipoAjusteRaw === 'DEUDA';
        const esAgregarFavor = tipoAjusteRaw === 'AGREGAR_FAVOR' || tipoAjusteRaw === 'FAVOR';
        if (!esCargaDeuda && !esAgregarFavor) {
            return res.status(400).json({ error: 'tipo_ajuste inválido.' });
        }

        const tipoAjusteCanonico = esCargaDeuda ? 'CARGAR_DEUDA' : 'AGREGAR_FAVOR';

        try {
            await pool.query('BEGIN');
            const notaBaseRaw = (nota || 'Ajuste manual del administrador').trim();
            const notaExtras: string[] = [];
            if (referenciaOrigen) notaExtras.push(`Ref origen: ${referenciaOrigen}`);
            if (bancoOrigen) notaExtras.push(`Banco origen: ${bancoOrigen}`);
            const notaBase = notaExtras.length > 0 ? `${notaBaseRaw} | ${notaExtras.join(' | ')}` : notaBaseRaw;
            const operador = esCargaDeuda ? '+' : '-';
            await pool.query(`UPDATE propiedades SET saldo_actual = saldo_actual ${operador} $1 WHERE id = $2`, [montoNum, propiedadId]);

            const tiposCompatibles = tipoAjusteCanonico === 'CARGAR_DEUDA'
                ? ['CARGAR_DEUDA', 'DEUDA']
                : ['AGREGAR_FAVOR', 'FAVOR'];
            let historialInsertado = false;
            let historialId: number | null = null;
            let ultimoErrorHistorial: unknown = null;

            for (const tipoHistorial of tiposCompatibles) {
                try {
                    const historialRes = await pool.query<IHistorialSaldoIdRow>(
                        `INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, monto_bs, tasa_cambio, nota, fecha)
                         VALUES ($1, $2, $3, $4, $5, $6, (COALESCE($7::date, CURRENT_DATE) + time '12:00:00'))
                         RETURNING id`,
                        [
                            propiedadId,
                            tipoHistorial,
                            montoNum,
                            (typeof monto_bs === 'number' || typeof monto_bs === 'string') ? (parseFloat(String(monto_bs).replace(',', '.')) || null) : null,
                            (typeof tasa_cambio === 'number' || typeof tasa_cambio === 'string') ? (parseFloat(String(tasa_cambio).replace(',', '.')) || null) : null,
                            notaBase,
                            fechaOperacionYmd
                        ]
                    );
                    historialId = historialRes.rows?.[0]?.id || null;
                    historialInsertado = true;
                    break;
                } catch (err: unknown) {
                    const pgError = asPgError(err);
                    const esErrorCompatibilidadTipo = pgError.code === '22P02' || pgError.code === '23514' || pgError.code === '22001';
                    if (!esErrorCompatibilidadTipo) {
                        throw err;
                    }
                    ultimoErrorHistorial = err;
                }
            }
            if (!historialInsertado && ultimoErrorHistorial) {
                throw ultimoErrorHistorial;
            }
            
            if (tipoAjusteCanonico === 'AGREGAR_FAVOR' && !es_gasto_extra) {
                // FIFO: cerrar recibos pendientes con el monto del ajuste
                const r2 = (n: number) => Math.round(n * 100) / 100;
                const recibosPendientes = await pool.query<{ id: number; monto_usd: string; monto_pagado_usd: string }>(
                    `SELECT id, monto_usd, COALESCE(monto_pagado_usd, 0) AS monto_pagado_usd
                     FROM recibos
                     WHERE propiedad_id = $1
                       AND COALESCE(estado, '') NOT IN ('Pagado', 'Anulado')
                       AND (monto_usd - COALESCE(monto_pagado_usd, 0)) > 0
                     ORDER BY fecha_emision ASC, id ASC`,
                    [propiedadId]
                );
                let montoRestante = montoNum;
                for (const recibo of recibosPendientes.rows) {
                    if (montoRestante <= 0) break;
                    const pendiente = r2(parseFloat(String(recibo.monto_usd)) - parseFloat(String(recibo.monto_pagado_usd)));
                    const aplicar = Math.min(montoRestante, pendiente);
                    const nuevoPagado = r2(parseFloat(String(recibo.monto_pagado_usd)) + aplicar);
                    const nuevoEstado = nuevoPagado >= r2(parseFloat(String(recibo.monto_usd))) - 0.001 ? 'Pagado' : 'Abonado';
                    await pool.query(
                        'UPDATE recibos SET monto_pagado_usd = $1, estado = $2 WHERE id = $3',
                        [nuevoPagado, nuevoEstado, recibo.id]
                    );
                    montoRestante = r2(montoRestante - aplicar);
                }
            }

            if (tipoAjusteCanonico === 'AGREGAR_FAVOR' && cuenta_bancaria_id && !es_gasto_extra) {
                const resolveMovimientoFondoTipo = async (preferred: string[], fallback: string): Promise<string> => {
                    try {
                        const r = await pool.query<{ def: string }>(`
                            SELECT pg_get_constraintdef(oid) AS def
                            FROM pg_constraint
                            WHERE conname = 'movimientos_fondos_tipo_check'
                            LIMIT 1
                        `);
                        const def = r.rows?.[0]?.def || '';
                        const matches = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
                        const allowed = new Set(matches);
                        const selected = preferred.find((t) => allowed.has(t));
                        if (selected) return selected;
                        if (matches.length > 0) return matches[0];
                    } catch (_err) {
                        // fallback below
                    }
                    return fallback;
                };

                const tasaNum = parseFloat(String(tasa_cambio || '1')) || 1;
                const notaMovimiento = historialId
                    ? `${notaBase} | ajuste_historial_id:${historialId}`
                    : notaBase;
                const tipoMovimiento = await resolveMovimientoFondoTipo(['AJUSTE_INICIAL', 'INGRESO', 'ABONO', 'ENTRADA'], 'AJUSTE_INICIAL');
                const r2 = (n: number) => Math.round(n * 100) / 100;

                if (subtipo_favor === 'distribuido') {
                    // Distribuir por porcentaje entre todos los fondos de la cuenta
                    const fondosRes = await pool.query<{ id: number; moneda: string; porcentaje_asignacion: string; es_operativo: boolean }>(
                        'SELECT id, moneda, porcentaje_asignacion, es_operativo FROM fondos WHERE cuenta_bancaria_id = $1 AND activo = true ORDER BY es_operativo ASC, id ASC',
                        [cuenta_bancaria_id]
                    );
                    const fondos = fondosRes.rows;
                    if (fondos.length > 0) {
                        const noOperativos = fondos.filter((f) => !f.es_operativo);
                        const fondoOperativo = fondos.find((f) => f.es_operativo) || null;
                        let acumulado = 0;
                        const dist: Array<{ id: number; moneda: string; monto: number }> = [];
                        for (const f of noOperativos) {
                            const pct = parseFloat(String(f.porcentaje_asignacion || 0));
                            const parte = r2((montoNum * pct) / 100);
                            acumulado = r2(acumulado + parte);
                            dist.push({ id: f.id, moneda: f.moneda, monto: parte });
                        }
                        const remanente = r2(montoNum - acumulado);
                        if (fondoOperativo) {
                            dist.push({ id: fondoOperativo.id, moneda: fondoOperativo.moneda, monto: remanente });
                        } else if (dist.length > 0) {
                            dist[dist.length - 1].monto = r2(dist[dist.length - 1].monto + remanente);
                        }
                        for (const d of dist) {
                            if (d.monto <= 0) continue;
                            let montoFondo = d.monto;
                            const monedaFondo = String(d.moneda || '').toUpperCase();
                            if (monedaFondo === 'BS' || monedaFondo === 'BS.') {
                                montoFondo = parseFloat(String(monto_bs || '0')) > 0
                                    ? r2((parseFloat(String(monto_bs)) / montoNum) * d.monto)
                                    : r2(d.monto * tasaNum);
                            }
                            await pool.query('UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2', [montoFondo, d.id]);
                            await pool.query(
                                `INSERT INTO movimientos_fondos (fondo_id, tipo, monto, tasa_cambio, nota, fecha)
                                 VALUES ($1, $2, $3, $4, $5, (COALESCE($6::date, CURRENT_DATE) + time '12:00:00'))`,
                                [d.id, tipoMovimiento, montoFondo, tasaNum, notaMovimiento, fechaOperacionYmd]
                            );
                        }
                    }
                } else {
                    // Directo: 100% al fondo operativo principal
                    const fondosRes = await pool.query<{ id: number; moneda: string }>(
                        'SELECT id, moneda FROM fondos WHERE cuenta_bancaria_id = $1 AND activo = true ORDER BY es_operativo DESC, id ASC',
                        [cuenta_bancaria_id]
                    );
                    if (fondosRes.rows.length > 0) {
                        const f = fondosRes.rows[0];
                        let montoFondo = montoNum;
                        if (f.moneda === 'Bs' || f.moneda === 'BS') {
                            montoFondo = parseFloat(String(monto_bs || '0')) || r2(montoNum * tasaNum);
                        }
                        await pool.query('UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2', [montoFondo, f.id]);
                        await pool.query(
                            `INSERT INTO movimientos_fondos (fondo_id, tipo, monto, tasa_cambio, nota, fecha)
                             VALUES ($1, $2, $3, $4, $5, (COALESCE($6::date, CURRENT_DATE) + time '12:00:00'))`,
                            [f.id, tipoMovimiento, montoFondo, tasaNum, notaMovimiento, fechaOperacionYmd]
                        );
                    }
                }
            } else if (tipoAjusteCanonico === 'AGREGAR_FAVOR' && es_gasto_extra && gasto_extra_id) {
                // Abono directo para rebajar la deuda del gasto extra
                await pool.query(
                    'UPDATE gastos SET monto_pagado_usd = COALESCE(monto_pagado_usd, 0) + $1 WHERE id = $2',
                    [montoNum, gasto_extra_id]
                );
                // Registrar en la cuenta bancaria principal (100% al fondo operativo de esa cuenta)
                if (cuenta_bancaria_id) {
                    const r2ge = (n: number) => Math.round(n * 100) / 100;
                    const tasaNumGe = parseFloat(String(tasa_cambio || '1')) || 1;
                    const notaMovimiento = historialId
                        ? `${notaBase} | ajuste_historial_id:${historialId}`
                        : notaBase;
                    const fondoRes = await pool.query<{ id: number; moneda: string }>(
                        'SELECT id, moneda FROM fondos WHERE cuenta_bancaria_id = $1 AND activo = true ORDER BY es_operativo DESC, id ASC LIMIT 1',
                        [cuenta_bancaria_id]
                    );
                    if (fondoRes.rows.length > 0) {
                        const f = fondoRes.rows[0];
                        const monedaFondo = String(f.moneda || '').toUpperCase();
                        let montoFondo = montoNum;
                        if (monedaFondo === 'BS' || monedaFondo === 'BS.') {
                            montoFondo = parseFloat(String(monto_bs || '0')) > 0
                                ? r2ge(parseFloat(String(monto_bs)))
                                : r2ge(montoNum * tasaNumGe);
                        }
                        // Reutilizar resolveMovimientoFondoTipo inline
                        let tipoMovimiento = 'AJUSTE_INICIAL';
                        try {
                            const rConstraint = await pool.query<{ def: string }>(`
                                SELECT pg_get_constraintdef(oid) AS def
                                FROM pg_constraint
                                WHERE conname = 'movimientos_fondos_tipo_check'
                                LIMIT 1
                            `);
                            const def = rConstraint.rows?.[0]?.def || '';
                            const matches = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
                            const allowed = new Set(matches);
                            const preferred = ['AJUSTE_INICIAL', 'INGRESO', 'ABONO', 'ENTRADA'];
                            const selected = preferred.find((t) => allowed.has(t));
                            if (selected) tipoMovimiento = selected;
                            else if (matches.length > 0) tipoMovimiento = matches[0];
                        } catch (_) { /* usa fallback */ }
                        await pool.query('UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2', [montoFondo, f.id]);
                        await pool.query(
                            `INSERT INTO movimientos_fondos (fondo_id, tipo, monto, tasa_cambio, nota, fecha)
                             VALUES ($1, $2, $3, $4, $5, (COALESCE($6::date, CURRENT_DATE) + time '12:00:00'))`,
                            [f.id, tipoMovimiento, montoFondo, tasaNumGe, notaMovimiento, fechaOperacionYmd]
                        );
                    }
                }
            }
            
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Saldo ajustado exitosamente' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerPropiedadesRoutes };
