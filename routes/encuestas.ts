import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

// ─── Interfaces de dependencias ───────────────────────────────────────────────

interface AuthUser {
    id: number;
    is_admin?: boolean;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

// ─── Interfaces de parámetros y body ──────────────────────────────────────────

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

// ─── Interfaces de filas de DB ────────────────────────────────────────────────

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
}

interface EncuestaEstadoRow {
    id: number;
    tipo: string;
    fecha_fin: string;
}

// ─── Helper de tipado seguro de req.user ──────────────────────────────────────

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

// ─── Registro de rutas ────────────────────────────────────────────────────────

const registerEncuestasRoutes = (
    app: Application,
    { pool, verifyToken }: AuthDependencies,
): void => {

    /**
     * POST /encuestas
     * Solo Admin. Crea una encuesta con sus opciones según el tipo:
     * - SI_NO:    inserta automáticamente 'Sí' y 'No'.
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
                    'SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1',
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
                        [encuesta_id, 'Sí'],
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
     * con sus opciones, total de votos y si la propiedad activa ya votó.
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
                asAuthUser(req.user);

                const eRes = await pool.query<EncuestaRow>(
                    `SELECT id, condominio_id, titulo, descripcion, tipo, fecha_fin, created_at
                     FROM encuestas
                     WHERE condominio_id = $1
                     ORDER BY created_at DESC`,
                    [condominio_id],
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

                if (new Date() > new Date(encuesta.fecha_fin)) {
                    res.status(400).json({ status: 'error', message: 'La encuesta ya cerró y no acepta más votos.' });
                    return;
                }

                const dupRes = await pool.query<CountRow>(
                    `SELECT COUNT(*) AS count
                     FROM encuesta_votos
                     WHERE encuesta_id = $1 AND propiedad_id = $2`,
                    [id, propiedad_id],
                );
                if (parseInt(dupRes.rows[0].count, 10) > 0) {
                    res.status(409).json({ status: 'error', message: 'Esta propiedad ya registró su voto en esta encuesta.' });
                    return;
                }

                await pool.query(
                    `INSERT INTO encuesta_votos (encuesta_id, propiedad_id, user_id, opcion_id, respuesta_texto)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [id, propiedad_id, authUser.id, opcion_id ?? null, respuesta_texto ?? null],
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
     * Admin y Propietario con lógica diferenciada:
     *
     * Admin → conteo por opción + detalle completo con:
     *   user_nombre, propiedad_identificador, respuesta_texto.
     *
     * Propietario → solo conteo por opción (para barras de progreso) +
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

                // Conteo por opción: común para ambos roles
                const conteoRes = await pool.query<ConteoPorOpcion>(
                    `SELECT ev.opcion_id,
                            eo.texto          AS opcion_texto,
                            COUNT(ev.id)::int AS total
                     FROM encuesta_votos ev
                     LEFT JOIN encuesta_opciones eo ON eo.id = ev.opcion_id
                     WHERE ev.encuesta_id = $1
                     GROUP BY ev.opcion_id, eo.texto
                     ORDER BY total DESC`,
                    [id],
                );

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
                        status:  'success',
                        encuesta,
                        conteo:  conteoRes.rows,
                        detalle: detalleRes.rows,
                    });
                } else {
                    // Solo conteo + textos abiertos anónimos (sin nombres ni identificadores)
                    const textosRes = await pool.query<{ respuesta_texto: string }>(
                        `SELECT respuesta_texto
                         FROM encuesta_votos
                         WHERE encuesta_id = $1 AND respuesta_texto IS NOT NULL
                         ORDER BY id ASC`,
                        [id],
                    );

                    res.json({
                        status:              'success',
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
