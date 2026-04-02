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
    const resolveCondominioIdForZonas = async (adminUserId: number, res: Response): Promise<number | null> => {
        const c = await pool.query<ICondominioIdRow>('SELECT id, tipo FROM condominios WHERE admin_user_id = $1 LIMIT 1', [adminUserId]);
        const condo = c.rows[0];
        if (!condo?.id) {
            res.status(400).json({ error: 'No existe un condominio asociado a este usuario administrador.' });
            return null;
        }
        return condo.id;
    };

    app.get('/zonas', verifyToken, async (req: Request, res: Response) => {
        try {
            const authUser = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForZonas(authUser.id, res);
            if (!condominioId) return;
            const condoRes = await pool.query<ICondominioIdRow>(
                'SELECT id, tipo FROM condominios WHERE id = $1 LIMIT 1',
                [condominioId]
            );
            const isJuntaGeneral = String(condoRes.rows[0]?.tipo || '').trim().toLowerCase() === 'junta general';
            const zRes = await pool.query<IZonaBaseRow>(
                'SELECT z.id, z.nombre, z.activa, (SELECT COUNT(*) FROM gastos g WHERE g.zona_id = z.id) > 0 as tiene_gastos FROM zonas z WHERE z.condominio_id = $1 ORDER BY z.activa DESC, z.nombre ASC',
                [condominioId]
            );
            const zonas: IZonaResponseRow[] = zRes.rows;

            if (isJuntaGeneral) {
                for (const z of zonas) {
                    const miembrosRes = await pool.query<IPropiedadRow>(
                        `
                        SELECT
                            m.id,
                            COALESCE(
                                NULLIF(TRIM(ci.nombre_legal), ''),
                                NULLIF(TRIM(ci.nombre), ''),
                                NULLIF(TRIM(m.nombre_referencia), ''),
                                m.rif
                            ) AS identificador
                        FROM junta_general_miembros m
                        LEFT JOIN condominios ci ON ci.id = m.condominio_individual_id
                        WHERE m.junta_general_id = $1
                          AND m.activo = true
                          AND m.zona_id = $2
                        ORDER BY identificador ASC
                        `,
                        [condominioId, z.id]
                    );
                    z.propiedades = miembrosRes.rows;
                    z.propiedades_ids = miembrosRes.rows.map((p: IPropiedadRow) => p.id);
                }

                const miembrosAllRes = await pool.query<IPropiedadRow>(
                    `
                    SELECT
                        m.id,
                        COALESCE(
                            NULLIF(TRIM(ci.nombre_legal), ''),
                            NULLIF(TRIM(ci.nombre), ''),
                            NULLIF(TRIM(m.nombre_referencia), ''),
                            m.rif
                        ) AS identificador
                    FROM junta_general_miembros m
                    LEFT JOIN condominios ci ON ci.id = m.condominio_individual_id
                    WHERE m.junta_general_id = $1
                      AND m.activo = true
                    ORDER BY identificador ASC
                    `,
                    [condominioId]
                );
                return res.json({
                    status: 'success',
                    scope: 'juntas',
                    zonas,
                    todas_propiedades: miembrosAllRes.rows,
                });
            }

            for (const z of zonas) {
                const pRes = await pool.query<IPropiedadRow>('SELECT p.id, p.identificador FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1', [z.id]);
                z.propiedades = pRes.rows;
                z.propiedades_ids = pRes.rows.map((p: IPropiedadRow) => p.id);
            }
            const aRes = await pool.query<IPropiedadRow>('SELECT id, identificador FROM propiedades WHERE condominio_id = $1 ORDER BY identificador ASC', [condominioId]);
            res.json({ status: 'success', scope: 'inmuebles', zonas, todas_propiedades: aRes.rows });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/zonas', verifyToken, async (req: Request<{}, unknown, CreateZonaBody>, res: Response) => {
        const { nombre, propiedades_ids } = req.body;
        try {
            const authUser = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForZonas(authUser.id, res);
            if (!condominioId) return;
            const condoRes = await pool.query<ICondominioIdRow>(
                'SELECT id, tipo FROM condominios WHERE id = $1 LIMIT 1',
                [condominioId]
            );
            const isJuntaGeneral = String(condoRes.rows[0]?.tipo || '').trim().toLowerCase() === 'junta general';
            const z = await pool.query<InsertZonaRow>('INSERT INTO zonas (condominio_id, nombre, activa) VALUES ($1, $2, true) RETURNING id', [condominioId, nombre]);
            if (isJuntaGeneral && Array.isArray(propiedades_ids) && propiedades_ids.length > 0) {
                await pool.query(
                    `
                    UPDATE junta_general_miembros
                    SET zona_id = $1,
                        updated_at = now()
                    WHERE junta_general_id = $2
                      AND activo = true
                      AND id = ANY($3::int[])
                    `,
                    [z.rows[0].id, condominioId, propiedades_ids]
                );
            } else if (propiedades_ids) {
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
            const authUser = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForZonas(authUser.id, res);
            if (!condominioId) return;
            const condoRes = await pool.query<ICondominioIdRow>(
                'SELECT id, tipo FROM condominios WHERE id = $1 LIMIT 1',
                [condominioId]
            );
            const isJuntaGeneral = String(condoRes.rows[0]?.tipo || '').trim().toLowerCase() === 'junta general';
            const zonaId = Number.parseInt(String(req.params.id), 10);
            await pool.query('BEGIN');
            await pool.query('UPDATE zonas SET nombre = $1, activa = $2 WHERE id = $3 AND condominio_id = $4', [nombre, activa, req.params.id, condominioId]);
            if (Array.isArray(propiedades_ids)) {
                if (isJuntaGeneral) {
                    await pool.query(
                        `
                        UPDATE junta_general_miembros
                        SET zona_id = NULL,
                            updated_at = now()
                        WHERE junta_general_id = $1
                          AND zona_id = $2
                        `,
                        [condominioId, zonaId]
                    );
                    if (propiedades_ids.length > 0) {
                        await pool.query(
                            `
                            UPDATE junta_general_miembros
                            SET zona_id = $1,
                                updated_at = now()
                            WHERE junta_general_id = $2
                              AND activo = true
                              AND id = ANY($3::int[])
                            `,
                            [zonaId, condominioId, propiedades_ids]
                        );
                    }
                } else {
                    await pool.query('DELETE FROM propiedades_zonas WHERE zona_id = $1', [req.params.id]);
                    for (const pId of propiedades_ids) {
                        await pool.query('INSERT INTO propiedades_zonas (zona_id, propiedad_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, pId]);
                    }
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
            const authUser = asAuthUser(req.user);
            const condominioId = await resolveCondominioIdForZonas(authUser.id, res);
            if (!condominioId) return;
            await pool.query('DELETE FROM zonas WHERE id = $1 AND condominio_id = $2', [req.params.id, condominioId]);
            res.json({ status: 'success' });
        } catch (err: unknown) {
            const error = err as Error;
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerZonasRoutes };

