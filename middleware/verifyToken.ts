import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../types/auth';
const jwt: typeof import('jsonwebtoken') = require('jsonwebtoken');

const SUPPORT_REFRESHED_TOKEN_HEADER = 'x-habioo-refreshed-token';
const SUPPORT_REFRESHED_EXPIRES_AT_HEADER = 'x-habioo-session-expires-at';

const getSupportSessionMinutes = (): number => {
    const raw = Number.parseInt(String(process.env.SUPPORT_SESSION_MINUTES || '20'), 10);
    if (!Number.isFinite(raw)) return 20;
    if (raw < 5) return 5;
    if (raw > 120) return 120;
    return raw;
};

const refreshSupportSessionToken = (user: AuthenticatedUser): { token: string; expiresAtIso: string } | null => {
    if (!user?.is_support_session || !user?.session_jti) return null;
    if (!process.env.JWT_SECRET) return null;

    const supportMinutes = getSupportSessionMinutes();
    const expiresAt = new Date(Date.now() + supportMinutes * 60_000);
    const payload: AuthenticatedUser = {
        id: user.id,
        cedula: String(user.cedula || ''),
        nombre: String(user.nombre || ''),
        condominio_id: user.condominio_id,
        is_admin: true,
        is_superuser: false,
        role: 'Administrador',
        is_support_session: true,
        support_superuser_id: user.support_superuser_id,
        support_superuser_nombre: user.support_superuser_nombre,
        support_condominio_id: user.support_condominio_id,
        session_jti: user.session_jti,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: `${supportMinutes}m` });
    return { token, expiresAtIso: expiresAt.toISOString() };
};

const verifyToken = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        res.status(403).json({ status: 'error', message: 'Acceso denegado.' });
        return;
    }

    try {
        const token = authHeader.split(' ')[1];
        if (!token) {
            res.status(401).json({ status: 'error', message: 'Token invalido.' });
            return;
        }

        req.user = jwt.verify(token, process.env.JWT_SECRET as string) as AuthenticatedUser;
        const refreshedSupportSession = refreshSupportSessionToken(req.user as AuthenticatedUser);
        if (refreshedSupportSession) {
            res.setHeader(SUPPORT_REFRESHED_TOKEN_HEADER, refreshedSupportSession.token);
            res.setHeader(SUPPORT_REFRESHED_EXPIRES_AT_HEADER, refreshedSupportSession.expiresAtIso);
        }
        next();
    } catch (_err: unknown) {
        res.status(401).json({ status: 'error', message: 'Token invalido.' });
    }
};

module.exports = { verifyToken };
