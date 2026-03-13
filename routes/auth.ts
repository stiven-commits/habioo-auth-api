import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

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
    created_at: Date;
}

interface IAdminAccessRow {
    '?column?': number;
}

interface IUsuarioPropiedadRow {
    rol: string | null;
    acceso_portal: boolean;
}

interface IMeUserRow {
    id: number;
    cedula: string;
    nombre: string;
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

            const cedulaLimpia = cedulaSafe.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const result = await pool.query<IUserRow>('SELECT * FROM users WHERE cedula = $1', [cedulaLimpia]);
            if (!result.rows[0] || !(await bcrypt.compare(passwordSafe, result.rows[0].password))) {
                return res.status(401).json({ status: 'error', message: 'Credenciales invalidas' });
            }

            const userId = result.rows[0].id;
            const adminRes = await pool.query<IAdminAccessRow>(
                'SELECT 1 FROM condominios WHERE admin_user_id = $1 LIMIT 1',
                [userId]
            );
            const hasAdminAccess = adminRes.rows.length > 0;

            if (!hasAdminAccess) {
                const upRes = await pool.query<IUsuarioPropiedadRow>(
                    'SELECT rol, COALESCE(acceso_portal, true) AS acceso_portal FROM usuarios_propiedades WHERE user_id = $1',
                    [userId]
                );
                const hasLinks = upRes.rows.length > 0;
                const hasPortalAccess = upRes.rows.some((r: IUsuarioPropiedadRow) => r.acceso_portal === true);
                if (hasLinks && !hasPortalAccess) {
                    return res.status(403).json({ status: 'error', message: 'Acceso al portal deshabilitado para este usuario.' });
                }
            }

            const token = jwt.sign(
                { id: result.rows[0].id, cedula: result.rows[0].cedula, nombre: result.rows[0].nombre },
                process.env.JWT_SECRET as string,
                { expiresIn: '24h' }
            );
            res.json({ status: 'success', token, user: result.rows[0] });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/me', verifyToken, async (req: Request, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const result = await pool.query<IMeUserRow>(
                'SELECT id, cedula, nombre, created_at FROM users WHERE id = $1',
                [user.id]
            );
            res.json({ status: 'success', user: result.rows[0] });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerAuthRoutes };

