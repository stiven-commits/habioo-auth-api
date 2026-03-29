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

const mapUserForResponse = (user: IUserRow): LoginResponseUser => ({
    id: user.id,
    cedula: user.cedula,
    nombre: user.nombre,
});

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

            const result = await pool.query<IUserRow>('SELECT * FROM users WHERE cedula = $1', [cedulaLimpia]);
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

            res.json({ status: 'success', token, user: mapUserForResponse(user), session });
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

