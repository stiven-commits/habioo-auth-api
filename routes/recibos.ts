import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

interface AuthUser {
    id: number;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
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
    app.get('/recibos-historial', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
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
};

module.exports = { registerRecibosRoutes };

