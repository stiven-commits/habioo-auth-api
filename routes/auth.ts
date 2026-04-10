import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { AuthenticatedUser } from '../types/auth';

const bcrypt: typeof import('bcryptjs') = require('bcryptjs');
const jwt: typeof import('jsonwebtoken') = require('jsonwebtoken');

interface IRegisterUserRow {
    id: number;
}

interface IUserRow {
    id: number;
    cedula: string;
    nombre: string;
    password: string;
    debe_cambiar_password: boolean | null;
    is_superuser: boolean | null;
    created_at: Date;
}

interface IUsuarioPropiedadRow {
    rol: string | null;
    acceso_portal: boolean;
}

interface IMeUserRow {
    id: number;
    cedula: string;
    nombre: string;
    is_superuser: boolean | null;
    created_at: Date;
}

interface RegisterBody {
    cedula: string;
    nombre: string;
    password: string;
}

interface LoginBody {
    cedula: string;
    password: string;
}

interface PublicJuntaGeneralRow {
    id: number;
    nombre_junta: string;
    rif_junta: string | null;
}

interface PublicRegistroCondominioBody {
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

interface AuthUser {
    id: number;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface LoginSessionPayload {
    role: 'Administrador' | 'Propietario' | 'SuperUsuario';
    is_admin: boolean;
    is_superuser: boolean;
    condominio_id: number | null;
    is_support_session: boolean;
    support_superuser_id: number | null;
    support_superuser_nombre: string | null;
    support_condominio_id: number | null;
    expires_at: string | null;
}

interface LoginResponseUser {
    id: number;
    cedula: string;
    nombre: string;
}

const asString = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new TypeError('Invalid string value');
    }
    return value;
};

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

const isBcryptHash = (value: string): boolean => /^\$2[aby]\$\d{2}\$/.test(value);

const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const loginAttemptsByKey = new Map<string, { fails: number; blockedUntil: number }>();

const deriveRole = (isSuperuser: boolean, isAdmin: boolean): 'Administrador' | 'Propietario' | 'SuperUsuario' => {
    if (isSuperuser) return 'SuperUsuario';
    return isAdmin ? 'Administrador' : 'Propietario';
};

const registerFailedAttempt = (key: string): void => {
    const now = Date.now();
    const current = loginAttemptsByKey.get(key) || { fails: 0, blockedUntil: 0 };
    const nextFails = current.fails + 1;
    const blockedUntil = nextFails >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_LOCK_WINDOW_MS : current.blockedUntil;
    loginAttemptsByKey.set(key, { fails: nextFails, blockedUntil });
};

const clearFailedAttempt = (key: string): void => {
    loginAttemptsByKey.delete(key);
};

const isAttemptBlocked = (key: string): boolean => {
    const current = loginAttemptsByKey.get(key);
    if (!current) return false;
    const now = Date.now();
    if (current.blockedUntil > now) return true;
    if (current.blockedUntil > 0 && current.blockedUntil <= now) {
        loginAttemptsByKey.delete(key);
    }
    return false;
};

const toNullableNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parsePositiveInt = (value: unknown): number | null => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
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

const mapUserForResponse = (user: IUserRow): LoginResponseUser => ({
    id: user.id,
    cedula: user.cedula,
    nombre: user.nombre,
});

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

const registerAuthRoutes = (
    app: Application,
    { pool, verifyToken }: AuthDependencies
): void => {
    app.post('/register', async (req: Request<{}, unknown, RegisterBody>, res: Response) => {
        const { cedula, nombre, password } = req.body;
        try {
            const cedulaSafe = asString(cedula);
            const nombreSafe = asString(nombre);
            const passwordSafe = asString(password);

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(passwordSafe, salt);
            const result = await pool.query<IRegisterUserRow>(
                'INSERT INTO users (cedula, nombre, password) VALUES ($1, $2, $3) RETURNING id',
                [cedulaSafe, nombreSafe, hashedPassword]
            );
            res.status(201).json({ status: 'success', user: result.rows[0] });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(400).json({ status: 'error', error: error.message });
        }
    });

    app.get('/condominios/juntas-generales-disponibles', async (_req: Request, res: Response) => {
        try {
            const result = await pool.query<PublicJuntaGeneralRow>(
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

    app.post('/condominios/registro', async (req: Request<{}, unknown, PublicRegistroCondominioBody>, res: Response) => {
        try {
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
            if (!adminNombre || !adminCedula) {
                return res.status(400).json({ status: 'error', message: 'Debes indicar nombre y cédula/RIF de la administradora.' });
            }
            if (tipo === 'Junta General' && juntaGeneralId) {
                return res.status(400).json({ status: 'error', message: 'Una Junta General no puede depender de otra junta general.' });
            }
            if (tipo === 'Junta Individual' && juntaGeneralId && cuotaParticipacion !== null && cuotaParticipacion < 0) {
                return res.status(400).json({ status: 'error', message: 'cuota_participacion no puede ser negativa.' });
            }

            await pool.query('BEGIN');

            const existingUser = await pool.query<{ id: number }>(
                'SELECT id FROM users WHERE cedula = $1 LIMIT 1',
                [adminCedula]
            );
            if (existingUser.rows.length > 0) {
                await pool.query('ROLLBACK');
                return res.status(409).json({ status: 'error', message: `Ya existe un usuario con cédula ${adminCedula}.` });
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

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(adminPassword, salt);
            const userInsert = await pool.query<CreatedUserRow>(
                `INSERT INTO users (cedula, nombre, password, email, telefono)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id`,
                [adminCedula, adminNombre, hashedPassword, adminEmail, adminTelefono]
            );
            const adminUserId = userInsert.rows[0].id;

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
                    [generalData.id, condominioId, nombreJunta, rifJunta, cuotaParticipacion]
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
            try {
                await pool.query('ROLLBACK');
            } catch {
                // noop: no active transaction
            }
            const message = error instanceof Error ? error.message : 'Error al registrar junta.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.post('/login', async (req: Request<{}, unknown, LoginBody>, res: Response) => {
        const { cedula, password } = req.body;
        try {
            const cedulaSafe = asString(cedula);
            const passwordSafe = asString(password);
            const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();

            const cedulaLimpia = cedulaSafe.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const attemptKey = `${cedulaLimpia}|${ip}`;
            if (isAttemptBlocked(attemptKey)) {
                return res.status(429).json({ status: 'error', message: 'Demasiados intentos. Intente nuevamente en unos minutos.' });
            }

            const result = await pool.query<IUserRow>(
                'SELECT id, cedula, nombre, password, debe_cambiar_password, is_superuser, created_at FROM users WHERE cedula = $1',
                [cedulaLimpia]
            );
            const user = result.rows[0];
            if (!user) {
                registerFailedAttempt(attemptKey);
                return res.status(401).json({ status: 'error', message: 'Credenciales invalidas' });
            }

            const storedPassword = user.password;
            let passwordValid = false;

            if (isBcryptHash(storedPassword)) {
                passwordValid = await bcrypt.compare(passwordSafe, storedPassword);
            } else {
                passwordValid = passwordSafe === storedPassword;
                if (passwordValid) {
                    const salt = await bcrypt.genSalt(10);
                    const hashedPassword = await bcrypt.hash(passwordSafe, salt);
                    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
                    user.password = hashedPassword;
                }
            }

            if (!passwordValid) {
                registerFailedAttempt(attemptKey);
                return res.status(401).json({ status: 'error', message: 'Credenciales invalidas' });
            }
            clearFailedAttempt(attemptKey);

            const userId = user.id;
            const adminRes = await pool.query<{ id: number }>(
                'SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1',
                [userId]
            );
            const hasAdminAccess = adminRes.rows.length > 0;
            const isSuperuser = Boolean(user.is_superuser);

            let condominioId: number | null = adminRes.rows[0]?.id ?? null;

            if (!hasAdminAccess && !isSuperuser) {
                const upRes = await pool.query<IUsuarioPropiedadRow>(
                    'SELECT rol, COALESCE(acceso_portal, true) AS acceso_portal FROM usuarios_propiedades WHERE user_id = $1',
                    [userId]
                );
                const hasLinks = upRes.rows.length > 0;
                const hasPortalAccess = upRes.rows.some((r: IUsuarioPropiedadRow) => r.acceso_portal === true);
                if (hasLinks && !hasPortalAccess) {
                    return res.status(403).json({ status: 'error', message: 'Acceso al portal deshabilitado para este usuario.' });
                }

                if (hasPortalAccess) {
                    const condoRes = await pool.query<{ condominio_id: number }>(
                        `
                            SELECT p.condominio_id
                            FROM usuarios_propiedades up
                            INNER JOIN propiedades p ON p.id = up.propiedad_id
                            WHERE up.user_id = $1
                              AND COALESCE(up.acceso_portal, true) = true
                              AND p.condominio_id IS NOT NULL
                            ORDER BY p.id ASC
                            LIMIT 1
                        `,
                        [userId]
                    );
                    condominioId = condoRes.rows[0]?.condominio_id ?? null;
                }
            }

            const role = deriveRole(isSuperuser, hasAdminAccess);
            const token = jwt.sign(
                {
                    id: user.id,
                    cedula: user.cedula,
                    nombre: user.nombre,
                    condominio_id: condominioId,
                    is_admin: hasAdminAccess,
                    is_superuser: isSuperuser,
                    role,
                    is_support_session: false,
                },
                process.env.JWT_SECRET as string,
                { expiresIn: '24h' }
            );

            const session: LoginSessionPayload = {
                role,
                is_admin: hasAdminAccess,
                is_superuser: isSuperuser,
                condominio_id: condominioId,
                is_support_session: false,
                support_superuser_id: null,
                support_superuser_nombre: null,
                support_condominio_id: null,
                expires_at: null,
            };

            res.json({
                status: 'success',
                token,
                user: mapUserForResponse(user),
                session,
                requiresPasswordChange: user.debe_cambiar_password === true,
            });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/me', verifyToken, async (req: Request, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const result = await pool.query<IMeUserRow>(
                'SELECT id, cedula, nombre, is_superuser, created_at FROM users WHERE id = $1',
                [user.id]
            );
            const dbUser = result.rows[0];
            const tokenUser = (req.user || {}) as AuthenticatedUser;
            const role = tokenUser.role || deriveRole(Boolean(tokenUser.is_superuser), Boolean(tokenUser.is_admin));
            const session: LoginSessionPayload = {
                role,
                is_admin: Boolean(tokenUser.is_admin),
                is_superuser: Boolean(tokenUser.is_superuser),
                condominio_id: toNullableNumber(tokenUser.condominio_id),
                is_support_session: Boolean(tokenUser.is_support_session),
                support_superuser_id: toNullableNumber(tokenUser.support_superuser_id),
                support_superuser_nombre: tokenUser.support_superuser_nombre ? String(tokenUser.support_superuser_nombre) : null,
                support_condominio_id: toNullableNumber(tokenUser.support_condominio_id),
                expires_at: Number.isFinite(Number(tokenUser.exp)) ? new Date(Number(tokenUser.exp) * 1000).toISOString() : null,
            };
            res.json({ status: 'success', user: dbUser, session });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerAuthRoutes };
