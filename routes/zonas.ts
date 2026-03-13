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
}

interface IZonaBaseRow {
    id: number;
    nombre: string;
    activa: boolean;
    tiene_gastos: boolean;
}

interface IPropiedadRow {
    id: number;
    identificador: string;
}

interface IZonaResponseRow extends IZonaBaseRow {
    propiedades?: IPropiedadRow[];
    propiedades_ids?: number[];
}

interface ZonasParams {
    id?: string;
}

interface CreateZonaBody {
    nombre: string;
    propiedades_ids?: number[];
}

interface UpdateZonaBody {
    nombre: string;
    activa: boolean;
    propiedades_ids?: number[];
}

interface InsertZonaRow {
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

const registerZonasRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    app.get('/zonas', verifyToken, async (req: Request, res: Response) => {
        try {
            const authUser = asAuthUser(req.user);
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [authUser.id]);
            const zRes = await pool.query<IZonaBaseRow>(
                'SELECT z.id, z.nombre, z.activa, (SELECT COUNT(*) FROM gastos g WHERE g.zona_id = z.id) > 0 as tiene_gastos FROM zonas z WHERE z.condominio_id = $1 ORDER BY z.activa DESC, z.nombre ASC',
                [c.rows[0].id]
            );
            const zonas: IZonaResponseRow[] = zRes.rows;
            for (const z of zonas) {
                const pRes = await pool.query<IPropiedadRow>('SELECT p.id, p.identificador FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1', [z.id]);
                z.propiedades = pRes.rows;
                z.propiedades_ids = pRes.rows.map((p: IPropiedadRow) => p.id);
            }
            const aRes = await pool.query<IPropiedadRow>('SELECT id, identificador FROM propiedades WHERE condominio_id = $1 ORDER BY identificador ASC', [c.rows[0].id]);
            res.json({ status: 'success', zonas, todas_propiedades: aRes.rows });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/zonas', verifyToken, async (req: Request<{}, unknown, CreateZonaBody>, res: Response) => {
        const { nombre, propiedades_ids } = req.body;
        try {
            const authUser = asAuthUser(req.user);
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [authUser.id]);
            const z = await pool.query<InsertZonaRow>('INSERT INTO zonas (condominio_id, nombre, activa) VALUES ($1, $2, true) RETURNING id', [c.rows[0].id, nombre]);
            if (propiedades_ids) {
                for (const p of propiedades_ids) {
                    await pool.query('INSERT INTO propiedades_zonas (zona_id, propiedad_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [z.rows[0].id, p]);
                }
            }
            res.json({ status: 'success', message: 'Zona agregada exitosamente' });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/zonas/:id', verifyToken, async (req: Request<ZonasParams, unknown, UpdateZonaBody>, res: Response) => {
        const { nombre, activa, propiedades_ids } = req.body;
        try {
            await pool.query('BEGIN');
            await pool.query('UPDATE zonas SET nombre = $1, activa = $2 WHERE id = $3', [nombre, activa, req.params.id]);
            if (Array.isArray(propiedades_ids)) {
                await pool.query('DELETE FROM propiedades_zonas WHERE zona_id = $1', [req.params.id]);
                for (const pId of propiedades_ids) {
                    await pool.query('INSERT INTO propiedades_zonas (zona_id, propiedad_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, pId]);
                }
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Zona actualizada' });
        } catch (err: unknown) {
            await pool.query('ROLLBACK');
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });

    app.delete('/zonas/:id', verifyToken, async (req: Request<ZonasParams>, res: Response) => {
        try {
            await pool.query('DELETE FROM zonas WHERE id = $1', [req.params.id]);
            res.json({ status: 'success' });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerZonasRoutes };

