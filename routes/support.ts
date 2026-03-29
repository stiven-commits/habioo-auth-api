import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { AuthenticatedUser } from '../types/auth';

const crypto: typeof import('crypto') = require('crypto');
const jwt: typeof import('jsonwebtoken') = require('jsonwebtoken');

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface SoporteCondominioRow {
    condominio_id: number;
    nombre_junta: string;
    rif_junta: string | null;
    admin_user_id: number | null;
    admin_nombre: string | null;
    admin_cedula: string | null;
    total_inmuebles: string;
}

interface SoporteEntrarBody {
    condominio_id?: number | string;
    motivo?: string;
}

interface AdminCondominioRow {
    condominio_id: number;
    nombre_junta: string;
    admin_user_id: number;
    admin_nombre: string;
    admin_cedula: string;
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
                  NULLIF(BTRIM(c.rif), '') AS rif_junta,
                  u.id AS admin_user_id,
                  NULLIF(BTRIM(u.nombre), '') AS admin_nombre,
                  NULLIF(BTRIM(u.cedula), '') AS admin_cedula,
                  COUNT(p.id)::text AS total_inmuebles
                FROM condominios c
                LEFT JOIN users u ON u.id = c.admin_user_id
                LEFT JOIN propiedades p ON p.condominio_id = c.id
                GROUP BY c.id, c.nombre_legal, c.nombre, c.rif, u.id, u.nombre, u.cedula
                ORDER BY c.id DESC
                `
            );

            return res.json({ status: 'success', data: result.rows });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al cargar condominios.';
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
                  u.id AS admin_user_id,
                  COALESCE(NULLIF(BTRIM(u.nombre), ''), 'Administrador') AS admin_nombre,
                  COALESCE(NULLIF(BTRIM(u.cedula), ''), 'J000000000') AS admin_cedula
                FROM condominios c
                INNER JOIN users u ON u.id = c.admin_user_id
                WHERE c.id = $1
                LIMIT 1
                `,
                [condominioId]
            );
            const selected = adminRes.rows[0];
            if (!selected) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado o sin administrador asignado.' });
            }

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
                    selected.admin_user_id,
                    selected.condominio_id,
                    motivo,
                    ipOrigen,
                    userAgent,
                    expiresAt.toISOString(),
                ]
            );

            const tokenPayload: AuthenticatedUser = {
                id: selected.admin_user_id,
                cedula: selected.admin_cedula,
                nombre: selected.admin_nombre,
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
                    id: selected.admin_user_id,
                    cedula: selected.admin_cedula,
                    nombre: selected.admin_nombre,
                },
                session,
                condominio: {
                    id: selected.condominio_id,
                    nombre: selected.nombre_junta,
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
