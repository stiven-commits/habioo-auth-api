import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../types/auth';
const jwt: typeof import('jsonwebtoken') = require('jsonwebtoken');

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
        next();
    } catch (_err: unknown) {
        res.status(401).json({ status: 'error', message: 'Token invalido.' });
    }
};

module.exports = { verifyToken };
