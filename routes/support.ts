import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { AuthenticatedUser } from '../types/auth';

const crypto: typeof import('crypto') = require('crypto');
const jwt: typeof import('jsonwebtoken') = require('jsonwebtoken');
const bcrypt: typeof import('bcryptjs') = require('bcryptjs');

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface SoporteCondominioRow {
    condominio_id: number;
    nombre_junta: string;
    tipo_junta: string | null;
    junta_general_id: number | null;
    nombre_junta_general: string | null;
    rif_junta: string | null;
    admin_user_id: number | null;
    admin_nombre: string | null;
    admin_cedula: string | null;
    total_inmuebles: string;
}

interface JuntaGeneralOptionRow {
    id: number;
    nombre_junta: string;
    rif_junta: string | null;
}

interface SupportCrearCondominioBody {
    tipo?: 'Junta General' | 'Junta Individual' | string;
    nombre_junta?: string;
    rif_junta?: string;
    admin_nombre?: string;
    admin_cedula?: string;
    admin_password?: string;
    admin_email?: string | null;
    admin_telefono?: string | null;
    estado_venezuela?: string | null;
    junta_general_id?: number | string | null;
    cuota_participacion?: number | string | null;
}

interface CreatedCondominioRow {
    id: number;
}

interface CreatedUserRow {
    id: number;
}

interface SoporteEntrarBody {
    condominio_id?: number | string;
    motivo?: string;
}

interface AdminCondominioRow {
    condominio_id: number;
    nombre_junta: string;
    tipo_junta: string | null;
    rif_junta: string | null;
    admin_user_id: number | null;
    admin_nombre: string | null;
    admin_cedula: string | null;
}

interface SoporteSessionInfo {
    role: 'Administrador';
    is_admin: true;
    is_superuser: false;
    condominio_id: number;
    is_support_session: true;
    support_superuser_id: number;
    support_superuser_nombre: string;
    support_condominio_id: number;
    session_jti: string;
    expires_at: string;
}

const asAuthenticatedUser = (value: unknown): AuthenticatedUser => {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('Usuario no autenticado');
    }
    return value as AuthenticatedUser;
};

const parsePositiveInt = (value: unknown): number | null => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
};

const isSuperUserToken = (user: AuthenticatedUser): boolean => {
    if (user.is_support_session) return false;
    if (user.role === 'SuperUsuario') return true;
    return Boolean(user.is_superuser);
};

const safeSupportMinutes = (): number => {
    const raw = Number.parseInt(String(process.env.SUPPORT_SESSION_MINUTES || '20'), 10);
    if (!Number.isFinite(raw)) return 20;
    if (raw < 5) return 5;
    if (raw > 120) return 120;
    return raw;
};

const normalizeDoc = (value: unknown): string => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeRif = (value: unknown): string => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeJuntaRif = (value: unknown): string => {
    const normalized = normalizeRif(value);
    if (!normalized) return '';
    return normalized.startsWith('J') ? normalized : `J${normalized}`;
};
const toNumber = (value: unknown): number => {
    const parsed = Number.parseFloat(String(value ?? '0').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
};

const {
    ensureJuntaGeneralSchema,
    ensureProveedorForJuntaGeneral,
}: {
    ensureJuntaGeneralSchema: (pool: Pool) => Promise<void>;
    ensureProveedorForJuntaGeneral: (pool: Pool, input: {
        condominioId: number;
        juntaGeneralNombre: string;
        juntaGeneralRif: string;
        estadoVenezuela: string;
    }) => Promise<number>;
} = require('../services/juntaGeneral');

const registerSupportRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    app.get('/support/condominios', verifyToken, async (req: Request, res: Response) => {
        try {
            const authUser = asAuthenticatedUser(req.user);
            if (!isSuperUserToken(authUser)) {
                return res.status(403).json({ status: 'error', message: 'No autorizado.' });
            }

            const result = await pool.query<SoporteCondominioRow>(
                `
                SELECT
                  c.id AS condominio_id,
                  COALESCE(NULLIF(BTRIM(c.nombre_legal), ''), NULLIF(BTRIM(c.nombre), ''), 'Condominio') AS nombre_junta,
                  c.tipo AS tipo_junta,
                  c.junta_general_id,
                  COALESCE(NULLIF(BTRIM(cg.nombre_legal), ''), NULLIF(BTRIM(cg.nombre), ''), 'Junta General') AS nombre_junta_general,
                  NULLIF(BTRIM(c.rif), '') AS rif_junta,
                  u.id AS admin_user_id,
                  NULLIF(BTRIM(u.nombre), '') AS admin_nombre,
                  NULLIF(BTRIM(u.cedula), '') AS admin_cedula,
                  COUNT(p.id)::text AS total_inmuebles
                FROM condominios c
                LEFT JOIN users u ON u.id = c.admin_user_id
                LEFT JOIN condominios cg ON cg.id = c.junta_general_id
                LEFT JOIN propiedades p ON p.condominio_id = c.id
                GROUP BY c.id, c.nombre_legal, c.nombre, c.rif, c.tipo, c.junta_general_id, cg.nombre_legal, cg.nombre, u.id, u.nombre, u.cedula
                ORDER BY c.id DESC
                `
            );

            return res.json({ status: 'success', data: result.rows });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al cargar condominios.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.get('/support/juntas-generales', verifyToken, async (req: Request, res: Response) => {
        try {
            const authUser = asAuthenticatedUser(req.user);
            if (!isSuperUserToken(authUser)) {
                return res.status(403).json({ status: 'error', message: 'No autorizado.' });
            }

            const result = await pool.query<JuntaGeneralOptionRow>(
                `
                SELECT
                  c.id,
                  COALESCE(NULLIF(BTRIM(c.nombre_legal), ''), NULLIF(BTRIM(c.nombre), ''), 'Junta General') AS nombre_junta,
                  NULLIF(BTRIM(c.rif), '') AS rif_junta
                FROM condominios c
                WHERE c.tipo = 'Junta General'
                ORDER BY c.id DESC
                `
            );

            return res.json({ status: 'success', data: result.rows });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al cargar juntas generales.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.post('/support/condominios/crear', verifyToken, async (req: Request<{}, unknown, SupportCrearCondominioBody>, res: Response) => {
        try {
            const authUser = asAuthenticatedUser(req.user);
            if (!isSuperUserToken(authUser)) {
                return res.status(403).json({ status: 'error', message: 'No autorizado.' });
            }

            await ensureJuntaGeneralSchema(pool);

            const tipoRaw = String(req.body?.tipo || '').trim();
            const tipo = tipoRaw === 'Junta General' ? 'Junta General' : 'Junta Individual';
            const nombreJunta = String(req.body?.nombre_junta || '').trim();
            const rifJunta = normalizeJuntaRif(req.body?.rif_junta);
            const adminNombre = String(req.body?.admin_nombre || '').trim();
            const adminCedula = normalizeDoc(req.body?.admin_cedula);
            const adminPassword = String(req.body?.admin_password || '').trim() || adminCedula;
            const adminEmail = String(req.body?.admin_email || '').trim() || null;
            const adminTelefono = String(req.body?.admin_telefono || '').trim() || null;
            const estadoVenezuela = String(req.body?.estado_venezuela || 'Distrito Capital').trim() || 'Distrito Capital';
            const juntaGeneralId = parsePositiveInt(req.body?.junta_general_id);
            const cuotaParticipacion = req.body?.cuota_participacion === null || req.body?.cuota_participacion === undefined
                ? null
                : toNumber(req.body?.cuota_participacion);

            if (!nombreJunta) {
                return res.status(400).json({ status: 'error', message: 'nombre_junta es requerido.' });
            }
            if (!rifJunta) {
                return res.status(400).json({ status: 'error', message: 'rif_junta es requerido.' });
            }
            if (!rifJunta.startsWith('J')) {
                return res.status(400).json({ status: 'error', message: 'El RIF de la junta debe comenzar con J.' });
            }
            if ((adminNombre && !adminCedula) || (!adminNombre && adminCedula)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Para crear administradora debes indicar nombre y cédula, o dejar ambos vacíos.',
                });
            }
            if (tipo === 'Junta General' && juntaGeneralId) {
                return res.status(400).json({ status: 'error', message: 'Una Junta General no puede depender de otra junta general.' });
            }
            if (tipo === 'Junta Individual' && juntaGeneralId && cuotaParticipacion !== null && cuotaParticipacion < 0) {
                return res.status(400).json({ status: 'error', message: 'cuota_participacion no puede ser negativa.' });
            }

            await pool.query('BEGIN');

            const shouldCreateAdminUser = Boolean(adminNombre && adminCedula);
            let adminUserId: number | null = null;

            if (shouldCreateAdminUser) {
                const existingUser = await pool.query<{ id: number }>(
                    'SELECT id FROM users WHERE cedula = $1 LIMIT 1',
                    [adminCedula]
                );
                if (existingUser.rows.length > 0) {
                    await pool.query('ROLLBACK');
                    return res.status(409).json({ status: 'error', message: `Ya existe un usuario con cédula ${adminCedula}.` });
                }
            }

            const existingCondo = await pool.query<{ id: number }>(
                `SELECT id
                 FROM condominios
                 WHERE UPPER(REPLACE(COALESCE(rif, ''), '-', '')) = UPPER(REPLACE($1, '-', ''))
                 LIMIT 1`,
                [rifJunta]
            );
            if (existingCondo.rows.length > 0) {
                await pool.query('ROLLBACK');
                return res.status(409).json({ status: 'error', message: `Ya existe una junta registrada con RIF ${rifJunta}.` });
            }

            let generalData: { id: number; nombre_legal: string | null; nombre: string | null; rif: string | null; tipo: string | null; estado_venezuela: string | null } | null = null;
            if (tipo === 'Junta Individual' && juntaGeneralId) {
                const generalRes = await pool.query<{ id: number; nombre_legal: string | null; nombre: string | null; rif: string | null; tipo: string | null; estado_venezuela: string | null }>(
                    `SELECT id, nombre_legal, nombre, rif, tipo, estado_venezuela
                     FROM condominios
                     WHERE id = $1
                     LIMIT 1`,
                    [juntaGeneralId]
                );
                generalData = generalRes.rows[0] || null;
                if (!generalData) {
                    await pool.query('ROLLBACK');
                    return res.status(404).json({ status: 'error', message: 'La junta general seleccionada no existe.' });
                }
                if (generalData.tipo !== 'Junta General') {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({ status: 'error', message: 'El condominio seleccionado no es Junta General.' });
                }
            }

            if (shouldCreateAdminUser) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(adminPassword, salt);
                const userInsert = await pool.query<CreatedUserRow>(
                    `INSERT INTO users (cedula, nombre, password, email, telefono)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING id`,
                    [adminCedula, adminNombre, hashedPassword, adminEmail, adminTelefono]
                );
                adminUserId = userInsert.rows[0].id;
            }

            const condoInsert = await pool.query<CreatedCondominioRow>(
                `INSERT INTO condominios (
                    nombre, nombre_legal, rif, estado_venezuela, admin_user_id, tipo, junta_general_id, cuota_participacion
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id`,
                [
                    nombreJunta,
                    nombreJunta,
                    rifJunta,
                    estadoVenezuela,
                    adminUserId,
                    tipo,
                    tipo === 'Junta Individual' ? (juntaGeneralId || null) : null,
                    tipo === 'Junta Individual' ? cuotaParticipacion : null,
                ]
            );
            const condominioId = condoInsert.rows[0].id;

            if (tipo === 'Junta Individual' && generalData) {
                await pool.query(
                    `
                    INSERT INTO junta_general_miembros (
                        junta_general_id, condominio_individual_id, nombre_referencia, rif,
                        cuota_participacion, activo, es_fantasma, vinculado_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, true, false, now()
                    )
                    ON CONFLICT (junta_general_id, rif)
                    DO UPDATE SET
                        condominio_individual_id = EXCLUDED.condominio_individual_id,
                        nombre_referencia = EXCLUDED.nombre_referencia,
                        cuota_participacion = EXCLUDED.cuota_participacion,
                        activo = true,
                        es_fantasma = false,
                        vinculado_at = now(),
                        updated_at = now()
                    `,
                    [
                        generalData.id,
                        condominioId,
                        nombreJunta,
                        rifJunta,
                        cuotaParticipacion,
                    ]
                );

                await ensureProveedorForJuntaGeneral(pool, {
                    condominioId,
                    juntaGeneralNombre: String(generalData.nombre_legal || generalData.nombre || 'Junta General'),
                    juntaGeneralRif: String(generalData.rif || ''),
                    estadoVenezuela: String(estadoVenezuela || generalData.estado_venezuela || 'Distrito Capital'),
                });
            }

            await pool.query('COMMIT');

            return res.status(201).json({
                status: 'success',
                data: {
                    condominio_id: condominioId,
                    admin_user_id: adminUserId,
                    tipo,
                },
                message: 'Junta de condominio registrada correctamente.',
            });
        } catch (error: unknown) {
            await pool.query('ROLLBACK');
            const message = error instanceof Error ? error.message : 'Error al registrar junta.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.post('/support/entrar', verifyToken, async (req: Request<{}, unknown, SoporteEntrarBody>, res: Response) => {
        try {
            const authUser = asAuthenticatedUser(req.user);
            if (!isSuperUserToken(authUser)) {
                return res.status(403).json({ status: 'error', message: 'No autorizado.' });
            }

            const condominioId = parsePositiveInt(req.body?.condominio_id);
            if (!condominioId) {
                return res.status(400).json({ status: 'error', message: 'condominio_id inválido.' });
            }

            const adminRes = await pool.query<AdminCondominioRow>(
                `
                SELECT
                  c.id AS condominio_id,
                  COALESCE(NULLIF(BTRIM(c.nombre_legal), ''), NULLIF(BTRIM(c.nombre), ''), 'Condominio') AS nombre_junta,
                  c.tipo AS tipo_junta,
                  NULLIF(BTRIM(c.rif), '') AS rif_junta,
                  u.id AS admin_user_id,
                  NULLIF(BTRIM(u.nombre), '') AS admin_nombre,
                  NULLIF(BTRIM(u.cedula), '') AS admin_cedula
                FROM condominios c
                LEFT JOIN users u ON u.id = c.admin_user_id
                WHERE c.id = $1
                LIMIT 1
                `,
                [condominioId]
            );
            const selected = adminRes.rows[0];
            if (!selected) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            }

            let effectiveAdminUserId = selected.admin_user_id;
            let effectiveAdminNombre = selected.admin_nombre;
            let effectiveAdminCedula = selected.admin_cedula;

            if (!effectiveAdminUserId) {
                await pool.query('BEGIN');
                try {
                    const lockedCondo = await pool.query<AdminCondominioRow>(
                        `
                        SELECT
                          c.id AS condominio_id,
                          COALESCE(NULLIF(BTRIM(c.nombre_legal), ''), NULLIF(BTRIM(c.nombre), ''), 'Condominio') AS nombre_junta,
                          c.tipo AS tipo_junta,
                          NULLIF(BTRIM(c.rif), '') AS rif_junta,
                          u.id AS admin_user_id,
                          NULLIF(BTRIM(u.nombre), '') AS admin_nombre,
                          NULLIF(BTRIM(u.cedula), '') AS admin_cedula
                        FROM condominios c
                        LEFT JOIN users u ON u.id = c.admin_user_id
                        WHERE c.id = $1
                        FOR UPDATE OF c
                        `,
                        [condominioId]
                    );
                    const current = lockedCondo.rows[0];
                    if (!current) {
                        await pool.query('ROLLBACK');
                        return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
                    }

                    if (current.admin_user_id) {
                        effectiveAdminUserId = current.admin_user_id;
                        effectiveAdminNombre = current.admin_nombre;
                        effectiveAdminCedula = current.admin_cedula;
                    } else {
                        const baseCedula = normalizeDoc(current.rif_junta || `J${current.condominio_id}`);
                        let generatedCedula = baseCedula || `J${current.condominio_id}`;
                        let seq = 1;
                        while (true) {
                            const existsUser = await pool.query<{ id: number }>(
                                'SELECT id FROM users WHERE cedula = $1 LIMIT 1',
                                [generatedCedula]
                            );
                            if (existsUser.rows.length === 0) break;
                            generatedCedula = `${baseCedula || `J${current.condominio_id}`}${seq}`;
                            seq += 1;
                        }

                        const generatedNombre = `Administrador ${current.nombre_junta}`;
                        const generatedPassword = generatedCedula;
                        const salt = await bcrypt.genSalt(10);
                        const hashedPassword = await bcrypt.hash(generatedPassword, salt);
                        const createdUser = await pool.query<CreatedUserRow>(
                            `INSERT INTO users (cedula, nombre, password, email, telefono)
                             VALUES ($1, $2, $3, NULL, NULL)
                             RETURNING id`,
                            [generatedCedula, generatedNombre, hashedPassword]
                        );
                        const newAdminId = createdUser.rows[0].id;

                        await pool.query(
                            `UPDATE condominios
                             SET admin_user_id = $1
                             WHERE id = $2`,
                            [newAdminId, current.condominio_id]
                        );

                        effectiveAdminUserId = newAdminId;
                        effectiveAdminNombre = generatedNombre;
                        effectiveAdminCedula = generatedCedula;
                    }

                    await pool.query('COMMIT');
                } catch (error: unknown) {
                    await pool.query('ROLLBACK');
                    const message = error instanceof Error ? error.message : 'No se pudo preparar el acceso de soporte.';
                    return res.status(500).json({ status: 'error', message });
                }
            }

            const safeAdminUserId = effectiveAdminUserId || authUser.id;
            const safeAdminNombre = String(effectiveAdminNombre || authUser.nombre || 'Soporte Habioo');
            const safeAdminCedula = String(effectiveAdminCedula || authUser.cedula || 'J000000000');

            const supportMinutes = safeSupportMinutes();
            const expiresAt = new Date(Date.now() + supportMinutes * 60_000);
            const sessionJti = crypto.randomUUID();
            const motivo = String(req.body?.motivo || '').trim().slice(0, 280) || null;
            const ipOrigen = String(req.ip || req.socket?.remoteAddress || '').trim() || null;
            const userAgent = String(req.headers['user-agent'] || '').trim() || null;

            await pool.query(
                `
                INSERT INTO support_session_audit
                  (session_jti, superuser_id, admin_user_id, condominio_id, motivo, ip_origen, user_agent, expires_at)
                VALUES
                  ($1, $2, $3, $4, $5, $6, $7, $8)
                `,
                [
                    sessionJti,
                    authUser.id,
                    safeAdminUserId,
                    selected.condominio_id,
                    motivo,
                    ipOrigen,
                    userAgent,
                    expiresAt.toISOString(),
                ]
            );

            const tokenPayload: AuthenticatedUser = {
                id: safeAdminUserId,
                cedula: safeAdminCedula,
                nombre: safeAdminNombre,
                condominio_id: selected.condominio_id,
                is_admin: true,
                is_superuser: false,
                role: 'Administrador',
                is_support_session: true,
                support_superuser_id: authUser.id,
                support_superuser_nombre: String(authUser.nombre || authUser.cedula || 'Soporte'),
                support_condominio_id: selected.condominio_id,
                session_jti: sessionJti,
            };

            const token = jwt.sign(tokenPayload, process.env.JWT_SECRET as string, { expiresIn: `${supportMinutes}m` });
            const session: SoporteSessionInfo = {
                role: 'Administrador',
                is_admin: true,
                is_superuser: false,
                condominio_id: selected.condominio_id,
                is_support_session: true,
                support_superuser_id: authUser.id,
                support_superuser_nombre: tokenPayload.support_superuser_nombre || 'Soporte',
                support_condominio_id: selected.condominio_id,
                session_jti: sessionJti,
                expires_at: expiresAt.toISOString(),
            };

            return res.json({
                status: 'success',
                token,
                user: {
                    id: safeAdminUserId,
                    cedula: safeAdminCedula,
                    nombre: safeAdminNombre,
                },
                session,
                condominio: {
                    id: selected.condominio_id,
                    nombre: selected.nombre_junta,
                    tipo: selected.tipo_junta,
                },
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al generar sesión de soporte.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.post('/support/salir', verifyToken, async (req: Request, res: Response) => {
        try {
            const authUser = asAuthenticatedUser(req.user);
            if (!authUser.is_support_session || !authUser.session_jti) {
                return res.json({ status: 'success', message: 'No hay sesión de soporte activa.' });
            }
            await pool.query(
                `
                UPDATE support_session_audit
                SET closed_at = NOW()
                WHERE session_jti = $1
                  AND closed_at IS NULL
                `,
                [authUser.session_jti]
            );
            return res.json({ status: 'success', message: 'Sesión de soporte cerrada.' });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al cerrar sesión de soporte.';
            return res.status(500).json({ status: 'error', message });
        }
    });
};

module.exports = { registerSupportRoutes };
