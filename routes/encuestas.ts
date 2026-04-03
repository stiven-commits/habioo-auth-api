import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

// â”€â”€â”€ Interfaces de dependencias â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface AuthUser {
    id: number;
    is_admin?: boolean;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

// â”€â”€â”€ Interfaces de parÃ¡metros y body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface EncuestaParams {
    id?: string;
    condominio_id?: string;
}

interface ListaEncuestasQuery {
    propiedad_id?: string;
}

interface CreateEncuestaBody {
    titulo: string;
    descripcion?: string;
    tipo: 'SI_NO' | 'MULTIPLE' | 'ABIERTA';
    fecha_fin: string;
    opciones?: string[];
}

interface VotarBody {
    propiedad_id: number;
    opcion_id?: number;
    respuesta_texto?: string;
}

// â”€â”€â”€ Interfaces de filas de DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface EncuestaRow {
    id: number;
    condominio_id: number;
    titulo: string;
    descripcion: string | null;
    tipo: string;
    fecha_fin: string;
    created_at: string;
}

interface EncuestaResumenRow {
    id: number;
    titulo: string;
    tipo: string;
}

interface OpcionRow {
    id: number;
    encuesta_id: number;
    texto: string;
}

interface EncuestaConMeta extends EncuestaRow {
    opciones: OpcionRow[];
    ya_voto: boolean;
    total_votos: number;
}

interface ConteoPorOpcion {
    opcion_id: number | null;
    opcion_texto: string | null;
    total: number;
}

interface VotoDetalleRow {
    opcion_id: number | null;
    opcion_texto: string | null;
    respuesta_texto: string | null;
    user_nombre: string;
    propiedad_identificador: string;
}

interface CountRow {
    count: string;
}

interface IdRow {
    id: number;
    tipo?: string | null;
}

interface EncuestaEstadoRow {
    id: number;
    tipo: string;
    fecha_fin: string;
}

interface CondominioMetodoRow {
    metodo_division: string;
}

interface CondominioMetaRow {
    id: number;
    tipo: string | null;
}

// â”€â”€â”€ Helper de tipado seguro de req.user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Registro de rutas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const registerEncuestasRoutes = (
    app: Application,
    { pool, verifyToken }: AuthDependencies,
): void => {
    const getAdminCondominio = async (userId: number): Promise<CondominioMetaRow | null> => {
        const r = await pool.query<CondominioMetaRow>(
            'SELECT id, tipo FROM condominios WHERE admin_user_id = $1 LIMIT 1',
            [userId],
        );
        return r.rows[0] || null;
    };

    const getOwnerCondominioByPropiedad = async (userId: number, propiedadId: number): Promise<number | null> => {
        const r = await pool.query<{ condominio_id: number }>(
            `
            SELECT p.condominio_id
            FROM usuarios_propiedades up
            INNER JOIN propiedades p ON p.id = up.propiedad_id
            WHERE up.user_id = $1
              AND up.propiedad_id = $2
              AND COALESCE(up.acceso_portal, true) = true
            LIMIT 1
            `,
            [userId, propiedadId],
        );
        return r.rows[0]?.condominio_id ?? null;
    };

    const ownerHasAnyPropiedadInCondominio = async (userId: number, condominioId: number): Promise<boolean> => {
        const r = await pool.query<CountRow>(
            `
            SELECT COUNT(*)::text AS count
            FROM usuarios_propiedades up
            INNER JOIN propiedades p ON p.id = up.propiedad_id
            WHERE up.user_id = $1
              AND p.condominio_id = $2
              AND COALESCE(up.acceso_portal, true) = true
            `,
            [userId, condominioId],
        );
        return parseInt(r.rows[0]?.count || '0', 10) > 0;
    };


    /**
     * POST /encuestas
     * Solo Admin. Crea una encuesta con sus opciones segÃºn el tipo:
     * - SI_NO:    inserta automÃ¡ticamente 'SÃ­' y 'No'.
     * - MULTIPLE: inserta las opciones recibidas en el body.
     * - ABIERTA:  no inserta opciones.
     */
    app.post(
        '/encuestas',
        verifyToken,
        async (req: Request<Record<string, never>, unknown, CreateEncuestaBody>, res: Response) => {
            const { titulo, descripcion, tipo, fecha_fin, opciones } = req.body;
            try {
                const authUser = asAuthUser(req.user);

                if (!authUser.is_admin) {
                    res.status(403).json({ status: 'error', message: 'Solo el administrador puede crear encuestas.' });
                    return;
                }

                const cRes = await pool.query<IdRow>(
                    'SELECT id, tipo FROM condominios WHERE admin_user_id = $1 LIMIT 1',
                    [authUser.id],
                );
                if (cRes.rows.length === 0) {
                    res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
                    return;
                }
                const condominio_id = cRes.rows[0].id;

                await pool.query('BEGIN');

                const eRes = await pool.query<IdRow>(
                    `INSERT INTO encuestas (condominio_id, titulo, descripcion, tipo, fecha_fin)
                     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                    [condominio_id, titulo, descripcion ?? null, tipo, fecha_fin],
                );
                const encuesta_id = eRes.rows[0].id;

                if (tipo === 'SI_NO') {
                    await pool.query(
                        'INSERT INTO encuesta_opciones (encuesta_id, texto) VALUES ($1, $2)',
                        [encuesta_id, 'SÃ­'],
                    );
                    await pool.query(
                        'INSERT INTO encuesta_opciones (encuesta_id, texto) VALUES ($1, $2)',
                        [encuesta_id, 'No'],
                    );
                } else if (tipo === 'MULTIPLE' && Array.isArray(opciones) && opciones.length > 0) {
                    for (const texto of opciones) {
                        await pool.query(
                            'INSERT INTO encuesta_opciones (encuesta_id, texto) VALUES ($1, $2)',
                            [encuesta_id, texto],
                        );
                    }
                }
                // tipo === 'ABIERTA': no se insertan opciones

                await pool.query('COMMIT');
                res.status(201).json({ status: 'success', message: 'Encuesta creada exitosamente.', encuesta_id });
            } catch (err: unknown) {
                await pool.query('ROLLBACK');
                const error = err as Error;
                res.status(500).json({ error: error.message });
            }
        },
    );

    /**
     * GET /encuestas/:condominio_id
     * Admin y Propietario. Devuelve todas las encuestas del condominio
     * con sus opciones, total de votos y si la propiedad activa ya votÃ³.
     * Query param: propiedad_id (opcional, requerido para calcular ya_voto).
     */
    app.get(
        '/encuestas/:condominio_id',
        verifyToken,
        async (
            req: Request<EncuestaParams, unknown, unknown, ListaEncuestasQuery>,
            res: Response,
        ) => {
            const { condominio_id } = req.params;
            const { propiedad_id } = req.query;
            try {
                const authUser = asAuthUser(req.user);
                const condominioIdNum = parseInt(String(condominio_id || ''), 10);
                if (!Number.isFinite(condominioIdNum) || condominioIdNum <= 0) {
                    res.status(400).json({ status: 'error', message: 'condominio_id invÃ¡lido.' });
                    return;
                }

                if (authUser.is_admin) {
                    const adminCondo = await getAdminCondominio(authUser.id);
                    if (!adminCondo || adminCondo.id !== condominioIdNum) {
                        res.status(403).json({ status: 'error', message: 'No autorizado para consultar encuestas de este condominio.' });
                        return;
                    }
                } else {
                    if (!propiedad_id) {
                        res.status(400).json({ status: 'error', message: 'propiedad_id es requerido para propietarios.' });
                        return;
                    }
                    const propiedadIdNum = parseInt(String(propiedad_id), 10);
                    if (!Number.isFinite(propiedadIdNum) || propiedadIdNum <= 0) {
                        res.status(400).json({ status: 'error', message: 'propiedad_id invÃ¡lido.' });
                        return;
                    }
                    const ownerCondoId = await getOwnerCondominioByPropiedad(authUser.id, propiedadIdNum);
                    if (!ownerCondoId || ownerCondoId !== condominioIdNum) {
                        res.status(403).json({ status: 'error', message: 'No autorizado para consultar encuestas de este condominio.' });
                        return;
                    }
                }

                const eRes = await pool.query<EncuestaRow>(
                    `SELECT id, condominio_id, titulo, descripcion, tipo, fecha_fin, created_at
                     FROM encuestas
                     WHERE condominio_id = $1
                     ORDER BY created_at DESC`,
                    [condominioIdNum],
                );

                const encuestas: EncuestaConMeta[] = [];

                for (const encuesta of eRes.rows) {
                    const opRes = await pool.query<OpcionRow>(
                        `SELECT id, encuesta_id, texto
                         FROM encuesta_opciones
                         WHERE encuesta_id = $1
                         ORDER BY id ASC`,
                        [encuesta.id],
                    );

                    let ya_voto = false;
                    if (propiedad_id) {
                        const vRes = await pool.query<CountRow>(
                            `SELECT COUNT(*) AS count
                             FROM encuesta_votos
                             WHERE encuesta_id = $1 AND propiedad_id = $2`,
                            [encuesta.id, propiedad_id],
                        );
                        ya_voto = parseInt(vRes.rows[0].count, 10) > 0;
                    }

                    const tvRes = await pool.query<CountRow>(
                        'SELECT COUNT(*) AS count FROM encuesta_votos WHERE encuesta_id = $1',
                        [encuesta.id],
                    );

                    encuestas.push({
                        ...encuesta,
                        opciones:    opRes.rows,
                        ya_voto,
                        total_votos: parseInt(tvRes.rows[0].count, 10),
                    });
                }

                res.json({ status: 'success', encuestas });
            } catch (err: unknown) {
                const error = err as Error;
                res.status(500).json({ error: error.message });
            }
        },
    );

    /**
     * POST /encuestas/:id/votar
     * Solo Propietario. Registra el voto en encuesta_votos.
     * Valida: encuesta activa (fecha_fin) y que la propiedad no haya votado ya.
     */
    app.post(
        '/encuestas/:id/votar',
        verifyToken,
        async (req: Request<EncuestaParams, unknown, VotarBody>, res: Response) => {
            const { id } = req.params;
            const { propiedad_id, opcion_id, respuesta_texto } = req.body;
            try {
                const authUser = asAuthUser(req.user);

                if (authUser.is_admin) {
                    res.status(403).json({ status: 'error', message: 'Solo los propietarios pueden votar.' });
                    return;
                }

                const eRes = await pool.query<EncuestaEstadoRow>(
                    'SELECT id, tipo, fecha_fin FROM encuestas WHERE id = $1',
                    [id],
                );
                if (eRes.rows.length === 0) {
                    res.status(404).json({ status: 'error', message: 'Encuesta no encontrada.' });
                    return;
                }
                const encuesta = eRes.rows[0];
                const encuestaCondoRes = await pool.query<{ condominio_id: number }>(
                    'SELECT condominio_id FROM encuestas WHERE id = $1 LIMIT 1',
                    [id],
                );
                const encuestaCondoId = encuestaCondoRes.rows[0]?.condominio_id;
                if (!encuestaCondoId) {
                    res.status(404).json({ status: 'error', message: 'Encuesta no encontrada.' });
                    return;
                }
                const propiedadIdNum = Number(propiedad_id);
                if (!Number.isFinite(propiedadIdNum) || propiedadIdNum <= 0) {
                    res.status(400).json({ status: 'error', message: 'propiedad_id invÃ¡lido.' });
                    return;
                }
                const ownerCondoId = await getOwnerCondominioByPropiedad(authUser.id, propiedadIdNum);
                if (!ownerCondoId || ownerCondoId !== encuestaCondoId) {
                    res.status(403).json({ status: 'error', message: 'No autorizado para votar en esta encuesta.' });
                    return;
                }

                if (new Date() > new Date(encuesta.fecha_fin)) {
                    res.status(400).json({ status: 'error', message: 'La encuesta ya cerrÃ³ y no acepta mÃ¡s votos.' });
                    return;
                }

                const dupRes = await pool.query<CountRow>(
                    `SELECT COUNT(*) AS count
                     FROM encuesta_votos
                     WHERE encuesta_id = $1 AND propiedad_id = $2`,
                    [id, propiedadIdNum],
                );
                if (parseInt(dupRes.rows[0].count, 10) > 0) {
                    res.status(409).json({ status: 'error', message: 'Esta propiedad ya registrÃ³ su voto en esta encuesta.' });
                    return;
                }

                await pool.query(
                    `INSERT INTO encuesta_votos (encuesta_id, propiedad_id, user_id, opcion_id, respuesta_texto)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [id, propiedadIdNum, authUser.id, opcion_id ?? null, respuesta_texto ?? null],
                );

                res.status(201).json({ status: 'success', message: 'Voto registrado exitosamente.' });
            } catch (err: unknown) {
                const error = err as Error;
                res.status(500).json({ error: error.message });
            }
        },
    );

    /**
     * GET /encuestas/:id/resultados
     * Admin y Propietario con lÃ³gica diferenciada:
     *
     * Admin â†’ conteo por opciÃ³n + detalle completo con:
     *   user_nombre, propiedad_identificador, respuesta_texto.
     *
     * Propietario â†’ solo conteo por opciÃ³n (para barras de progreso) +
     *   array plano de respuesta_texto para encuestas abiertas.
     *   Sin nombres ni identificadores (anonimato total).
     */
    app.get(
        '/encuestas/:id/resultados',
        verifyToken,
        async (req: Request<EncuestaParams>, res: Response) => {
            const { id } = req.params;
            try {
                const authUser = asAuthUser(req.user);

                const eRes = await pool.query<EncuestaResumenRow>(
                    'SELECT id, titulo, tipo FROM encuestas WHERE id = $1',
                    [id],
                );
                if (eRes.rows.length === 0) {
                    res.status(404).json({ status: 'error', message: 'Encuesta no encontrada.' });
                    return;
                }
                const encuesta = eRes.rows[0];
                const encuestaCondoRes = await pool.query<{ condominio_id: number }>(
                    'SELECT condominio_id FROM encuestas WHERE id = $1 LIMIT 1',
                    [id],
                );
                const encuestaCondoId = encuestaCondoRes.rows[0]?.condominio_id;
                if (!encuestaCondoId) {
                    res.status(404).json({ status: 'error', message: 'Encuesta no encontrada.' });
                    return;
                }
                if (authUser.is_admin) {
                    const adminCondo = await getAdminCondominio(authUser.id);
                    if (!adminCondo || adminCondo.id !== encuestaCondoId) {
                        res.status(403).json({ status: 'error', message: 'No autorizado para ver resultados de esta encuesta.' });
                        return;
                    }
                } else {
                    const ownerHasAccess = await ownerHasAnyPropiedadInCondominio(authUser.id, encuestaCondoId);
                    if (!ownerHasAccess) {
                        res.status(403).json({ status: 'error', message: 'No autorizado para ver resultados de esta encuesta.' });
                        return;
                    }
                }

                // Obtener mÃ©todo de distribuciÃ³n del condominio
                const condoRes = await pool.query<CondominioMetodoRow>(
                    `SELECT metodo_division
                     FROM condominios
                     WHERE id = (SELECT condominio_id FROM encuestas WHERE id = $1)`,
                    [id],
                );
                const metodo_division = condoRes.rows[0]?.metodo_division ?? 'Partes Iguales';

                // Conteo por opciÃ³n: ponderado por alÃ­cuota o por unidad segÃºn mÃ©todo
                const conteoRes = await (metodo_division === 'Alicuota'
                    ? pool.query<ConteoPorOpcion>(
                        `SELECT ev.opcion_id,
                                eo.texto                                              AS opcion_texto,
                                ROUND(COALESCE(SUM(p.alicuota::numeric), 0), 4)::float AS total
                         FROM encuesta_votos ev
                         LEFT JOIN encuesta_opciones eo ON eo.id = ev.opcion_id
                         LEFT JOIN propiedades p        ON p.id  = ev.propiedad_id
                         WHERE ev.encuesta_id = $1
                         GROUP BY ev.opcion_id, eo.texto
                         ORDER BY total DESC`,
                        [id],
                    )
                    : pool.query<ConteoPorOpcion>(
                        `SELECT ev.opcion_id,
                                eo.texto          AS opcion_texto,
                                COUNT(ev.id)::int AS total
                         FROM encuesta_votos ev
                         LEFT JOIN encuesta_opciones eo ON eo.id = ev.opcion_id
                         WHERE ev.encuesta_id = $1
                         GROUP BY ev.opcion_id, eo.texto
                         ORDER BY total DESC`,
                        [id],
                    ));

                if (authUser.is_admin) {
                    // Detalle completo: nombres, identificadores y respuestas
                    const detalleRes = await pool.query<VotoDetalleRow>(
                        `SELECT ev.opcion_id,
                                eo.texto          AS opcion_texto,
                                ev.respuesta_texto,
                                u.nombre          AS user_nombre,
                                p.identificador   AS propiedad_identificador
                         FROM encuesta_votos ev
                         LEFT JOIN encuesta_opciones eo ON eo.id = ev.opcion_id
                         LEFT JOIN users u              ON u.id  = ev.user_id
                         LEFT JOIN propiedades p        ON p.id  = ev.propiedad_id
                         WHERE ev.encuesta_id = $1
                         ORDER BY ev.id ASC`,
                        [id],
                    );

                    res.json({
                        status:           'success',
                        metodo_division,
                        encuesta,
                        conteo:           conteoRes.rows,
                        detalle:          detalleRes.rows,
                    });
                } else {
                    // Solo conteo + textos abiertos anÃ³nimos (sin nombres ni identificadores)
                    const textosRes = await pool.query<{ respuesta_texto: string }>(
                        `SELECT respuesta_texto
                         FROM encuesta_votos
                         WHERE encuesta_id = $1 AND respuesta_texto IS NOT NULL
                         ORDER BY id ASC`,
                        [id],
                    );

                    res.json({
                        status:              'success',
                        metodo_division,
                        encuesta:            { id: encuesta.id, titulo: encuesta.titulo, tipo: encuesta.tipo },
                        conteo:              conteoRes.rows,
                        respuestas_abiertas: textosRes.rows.map((r) => r.respuesta_texto),
                    });
                }
            } catch (err: unknown) {
                const error = err as Error;
                res.status(500).json({ error: error.message });
            }
        },
    );
};

module.exports = { registerEncuestasRoutes };
