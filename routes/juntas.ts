import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface AuthUser {
    id: number;
    cedula: string;
    condominio_id?: number;
}

interface MiembroBody {
    nombre_referencia?: string;
    rif?: string;
    cuota_participacion?: number | string | null;
    zona_id?: number | string | null;
}

interface AceptarInvitacionBody {
    codigo_invitacion?: string;
}

interface MiembroParams {
    id?: string;
}

const {
    normalizeRif,
    isJuntaGeneralTipo,
    isJuntaIndividualTipo,
    ensureJuntaGeneralSchema,
    getCondominioByAdminUserId,
    listJuntaGeneralMiembrosActivos,
    ensureProveedorForJuntaGeneral,
}: {
    normalizeRif: (value: unknown) => string;
    isJuntaGeneralTipo: (tipo: unknown) => boolean;
    isJuntaIndividualTipo: (tipo: unknown) => boolean;
    ensureJuntaGeneralSchema: (pool: Pool) => Promise<void>;
    getCondominioByAdminUserId: (pool: Pool, adminUserId: number) => Promise<{
        id: number;
        nombre: string | null;
        nombre_legal: string | null;
        rif: string | null;
        tipo: string | null;
        estado_venezuela: string | null;
    } | null>;
    listJuntaGeneralMiembrosActivos: (
        pool: Pool,
        juntaGeneralId: number,
        options?: { includeInactive?: boolean }
    ) => Promise<Array<Record<string, unknown>>>;
    ensureProveedorForJuntaGeneral: (pool: Pool, input: {
        condominioId: number;
        juntaGeneralNombre: string;
        juntaGeneralRif: string;
        estadoVenezuela: string;
    }) => Promise<number>;
} = require('../services/juntaGeneral');

const asAuthUser = (value: unknown): AuthUser => {
    if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as { id?: unknown }).id !== 'number' ||
        typeof (value as { cedula?: unknown }).cedula !== 'string'
    ) {
        throw new TypeError('Invalid authenticated user');
    }
    return value as AuthUser;
};

const toNumber = (value: string | number | null | undefined): number => {
    const n = parseFloat(String(value ?? 0));
    return Number.isFinite(n) ? n : 0;
};

const toPositiveInt = (value: unknown): number | null => {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
};

const normalizeJuntaRif = (value: unknown): string => {
    const normalized = normalizeRif(value);
    if (!normalized) return '';
    return normalized.startsWith('J') ? normalized : `J${normalized.replace(/^[VEPG]/, '')}`;
};

const isValidJuntaRif = (value: string): boolean => /^J[0-9]+$/.test(value);

const randomCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 10; i += 1) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
};

const registerJuntasRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    const resolveCondominioSesion = async (auth: AuthUser) => {
        const condoId = toPositiveInt(auth.condominio_id);
        if (condoId) {
            const byId = await pool.query<{
                id: number;
                nombre: string | null;
                nombre_legal: string | null;
                rif: string | null;
                tipo: string | null;
                estado_venezuela: string | null;
            }>(
                `SELECT id, nombre, nombre_legal, rif, tipo, estado_venezuela
                 FROM condominios
                 WHERE id = $1
                 LIMIT 1`,
                [condoId]
            );
            if (byId.rows[0]) return byId.rows[0];
        }

        return getCondominioByAdminUserId(pool, auth.id);
    };

    app.get('/juntas-generales/miembros', verifyToken, async (req: Request, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            if (!isJuntaGeneralTipo(condo.tipo)) return res.status(403).json({ status: 'error', message: 'Solo disponible para Junta General.' });

            const includeInactivos = String(req.query?.include_inactivos || '').trim().toLowerCase() === 'true';
            const miembros = await listJuntaGeneralMiembrosActivos(pool, condo.id, { includeInactive: includeInactivos });
            const data = miembros.map((m) => {
                const montoGenerado = toNumber(m.saldo_usd_generado as string | number | null);
                const montoPagado = toNumber(m.saldo_usd_pagado as string | number | null);
                const deuda = Math.max(0, montoGenerado - montoPagado);
                const montoGeneradoBs = toNumber(m.saldo_bs_generado as string | number | null);
                const montoPagadoBs = toNumber(m.saldo_bs_pagado as string | number | null);
                const deudaBs = Math.max(0, montoGeneradoBs - montoPagadoBs);
                const morosidad = montoGenerado > 0 ? (deuda / montoGenerado) * 100 : 0;
                return {
                    ...m,
                    saldo_usd_generado: Number(montoGenerado.toFixed(2)),
                    saldo_usd_pagado: Number(montoPagado.toFixed(2)),
                    saldo_usd_pendiente: Number(deuda.toFixed(2)),
                    saldo_bs_generado: Number(montoGeneradoBs.toFixed(2)),
                    saldo_bs_pagado: Number(montoPagadoBs.toFixed(2)),
                    saldo_bs_pendiente: Number(deudaBs.toFixed(2)),
                    porcentaje_morosidad: Number(morosidad.toFixed(2)),
                };
            });

            return res.json({ status: 'success', data });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Error al cargar miembros.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.post('/juntas-generales/miembros', verifyToken, async (req: Request<{}, unknown, MiembroBody>, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            if (!isJuntaGeneralTipo(condo.tipo)) return res.status(403).json({ status: 'error', message: 'Solo disponible para Junta General.' });

            const nombre = String(req.body?.nombre_referencia || '').trim();
            const rif = normalizeJuntaRif(req.body?.rif);
            const cuota = req.body?.cuota_participacion === null || req.body?.cuota_participacion === undefined
                ? null
                : toNumber(req.body?.cuota_participacion);
            const zonaIdRaw = req.body?.zona_id;
            const zonaId = zonaIdRaw === null || zonaIdRaw === undefined || String(zonaIdRaw).trim() === ''
                ? null
                : toPositiveInt(zonaIdRaw);

            if (!nombre) return res.status(400).json({ status: 'error', message: 'nombre_referencia es requerido.' });
            if (!rif) return res.status(400).json({ status: 'error', message: 'rif es requerido.' });
            if (!isValidJuntaRif(rif)) return res.status(400).json({ status: 'error', message: 'El RIF de la junta debe comenzar con J y contener solo números luego del prefijo.' });
            if (cuota !== null && cuota < 0) return res.status(400).json({ status: 'error', message: 'cuota_participacion no puede ser negativa.' });
            if (zonaIdRaw !== null && zonaIdRaw !== undefined && String(zonaIdRaw).trim() !== '' && !zonaId) {
                return res.status(400).json({ status: 'error', message: 'zona_id inválida.' });
            }
            if (zonaId) {
                const zonaValida = await pool.query<{ id: number }>(
                    `SELECT id
                     FROM zonas
                     WHERE id = $1
                       AND condominio_id = $2
                     LIMIT 1`,
                    [zonaId, condo.id]
                );
                if (!zonaValida.rows[0]) {
                    return res.status(400).json({ status: 'error', message: 'La zona seleccionada no existe en la Junta General.' });
                }
            }
            const generalRif = normalizeJuntaRif(condo.rif || '');
            if (generalRif && generalRif === rif) {
                return res.status(409).json({ status: 'error', message: 'No puedes registrar una junta individual con el mismo RIF de la Junta General.' });
            }

            const linkedCondo = await pool.query<{
                id: number;
                nombre: string | null;
                nombre_legal: string | null;
                rif: string | null;
                tipo: string | null;
                junta_general_id: number | null;
            }>(
                `SELECT id, nombre, nombre_legal, rif
                        , tipo, junta_general_id
                 FROM condominios
                 WHERE UPPER(REGEXP_REPLACE(COALESCE(rif, ''), '[^A-Z0-9]', '', 'g'))
                       = UPPER(REGEXP_REPLACE($1, '[^A-Z0-9]', '', 'g'))
                 LIMIT 1`,
                [rif]
            );
            const linked = linkedCondo.rows[0] || null;
            if (linked?.id === condo.id) {
                return res.status(409).json({ status: 'error', message: 'No puedes agregar la misma Junta General como miembro individual.' });
            }
            if (linked && isJuntaGeneralTipo(linked.tipo)) {
                return res.status(409).json({ status: 'error', message: `El RIF ${rif} pertenece a una Junta General y no puede registrarse como miembro individual.` });
            }
            if (linked && linked.junta_general_id && linked.junta_general_id !== condo.id) {
                return res.status(409).json({ status: 'error', message: `La junta con RIF ${rif} ya está vinculada a otra Junta General.` });
            }

            const inserted = await pool.query<{ id: number }>(
                `
                INSERT INTO junta_general_miembros (
                    junta_general_id,
                    condominio_individual_id,
                    nombre_referencia,
                    rif,
                    cuota_participacion,
                    zona_id,
                    activo,
                    es_fantasma,
                    vinculado_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, true, $7, $8
                )
                ON CONFLICT (junta_general_id, rif)
                DO UPDATE SET
                    nombre_referencia = EXCLUDED.nombre_referencia,
                    cuota_participacion = EXCLUDED.cuota_participacion,
                    zona_id = EXCLUDED.zona_id,
                    condominio_individual_id = COALESCE(EXCLUDED.condominio_individual_id, junta_general_miembros.condominio_individual_id),
                    es_fantasma = CASE WHEN EXCLUDED.condominio_individual_id IS NULL THEN true ELSE false END,
                    vinculado_at = CASE WHEN EXCLUDED.condominio_individual_id IS NULL THEN junta_general_miembros.vinculado_at ELSE now() END,
                    activo = true,
                    updated_at = now()
                RETURNING id
                `,
                [
                    condo.id,
                    linked?.id ?? null,
                    nombre,
                    rif,
                    cuota,
                    zonaId,
                    linked ? false : true,
                    linked ? new Date().toISOString() : null,
                ]
            );

            if (linked?.id) {
                await pool.query(
                    `UPDATE condominios
                     SET junta_general_id = $1,
                         tipo = COALESCE(tipo, 'Junta Individual'),
                         cuota_participacion = COALESCE(cuota_participacion, $2)
                     WHERE id = $3`,
                    [condo.id, cuota, linked.id]
                );

                const generalName = String(condo.nombre_legal || condo.nombre || 'Junta General').trim();
                const generalRif = normalizeRif(condo.rif || rif);
                await ensureProveedorForJuntaGeneral(pool, {
                    condominioId: linked.id,
                    juntaGeneralNombre: generalName,
                    juntaGeneralRif: generalRif,
                    estadoVenezuela: String(condo.estado_venezuela || 'Distrito Capital'),
                });
            }

            return res.status(201).json({ status: 'success', data: { id: inserted.rows[0].id }, message: 'Miembro registrado.' });
        } catch (error) {
            const raw = error instanceof Error ? error.message : 'Error al registrar miembro.';
            const message = raw.includes('RIF_MIEMBRO_IGUAL_JUNTA_GENERAL')
                ? 'No puedes registrar una junta individual con el mismo RIF de la Junta General.'
                : raw;
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.put('/juntas-generales/miembros/:id', verifyToken, async (req: Request<MiembroParams, unknown, MiembroBody>, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            if (!isJuntaGeneralTipo(condo.tipo)) return res.status(403).json({ status: 'error', message: 'Solo disponible para Junta General.' });

            const id = toPositiveInt(req.params?.id);
            if (!id) return res.status(400).json({ status: 'error', message: 'ID inválido.' });

            const nombre = String(req.body?.nombre_referencia || '').trim();
            const cuota = req.body?.cuota_participacion === null || req.body?.cuota_participacion === undefined
                ? null
                : toNumber(req.body?.cuota_participacion);
            const rifMaybe = req.body?.rif !== undefined ? normalizeJuntaRif(req.body?.rif) : null;
            const zonaIdRaw = req.body?.zona_id;
            const zonaId = zonaIdRaw === null || zonaIdRaw === undefined || String(zonaIdRaw).trim() === ''
                ? null
                : toPositiveInt(zonaIdRaw);

            if (!nombre) return res.status(400).json({ status: 'error', message: 'nombre_referencia es requerido.' });
            if (cuota !== null && cuota < 0) return res.status(400).json({ status: 'error', message: 'cuota_participacion inválida.' });
            if (rifMaybe !== null && !rifMaybe) return res.status(400).json({ status: 'error', message: 'rif inválido.' });
            if (rifMaybe !== null && !isValidJuntaRif(rifMaybe)) {
                return res.status(400).json({ status: 'error', message: 'El RIF de la junta debe comenzar con J y contener solo números luego del prefijo.' });
            }
            if (zonaIdRaw !== null && zonaIdRaw !== undefined && String(zonaIdRaw).trim() !== '' && !zonaId) {
                return res.status(400).json({ status: 'error', message: 'zona_id inválida.' });
            }
            if (zonaId) {
                const zonaValida = await pool.query<{ id: number }>(
                    `SELECT id
                     FROM zonas
                     WHERE id = $1
                       AND condominio_id = $2
                     LIMIT 1`,
                    [zonaId, condo.id]
                );
                if (!zonaValida.rows[0]) {
                    return res.status(400).json({ status: 'error', message: 'La zona seleccionada no existe en la Junta General.' });
                }
            }

            const currentMember = await pool.query<{
                id: number;
                rif: string;
                condominio_individual_id: number | null;
                condominio_rif: string | null;
            }>(
                `
                SELECT m.id, m.rif, m.condominio_individual_id, c.rif AS condominio_rif
                FROM junta_general_miembros m
                LEFT JOIN condominios c ON c.id = m.condominio_individual_id
                WHERE m.id = $1
                  AND m.junta_general_id = $2
                LIMIT 1
                `,
                [id, condo.id]
            );
            const current = currentMember.rows[0];
            if (!current) return res.status(404).json({ status: 'error', message: 'Miembro no encontrado.' });

            if (current.condominio_individual_id && rifMaybe) {
                const rifCondominio = normalizeJuntaRif(current.condominio_rif || '');
                if (rifCondominio && rifCondominio !== rifMaybe) {
                    return res.status(409).json({
                        status: 'error',
                        message: 'Este miembro ya está vinculado a una junta en Habioo. El RIF debe coincidir con la junta vinculada.',
                    });
                }
            }

            if (rifMaybe) {
                const linkedCondo = await pool.query<{
                    id: number;
                    tipo: string | null;
                    junta_general_id: number | null;
                }>(
                    `
                    SELECT id, tipo, junta_general_id
                    FROM condominios
                    WHERE UPPER(REGEXP_REPLACE(COALESCE(rif, ''), '[^A-Z0-9]', '', 'g'))
                          = UPPER(REGEXP_REPLACE($1, '[^A-Z0-9]', '', 'g'))
                    LIMIT 1
                    `,
                    [rifMaybe]
                );
                const linked = linkedCondo.rows[0] || null;
                if (linked && linked.id === condo.id) {
                    return res.status(409).json({ status: 'error', message: 'No puedes usar el RIF de la Junta General como miembro individual.' });
                }
                if (linked && isJuntaGeneralTipo(linked.tipo)) {
                    return res.status(409).json({ status: 'error', message: `El RIF ${rifMaybe} pertenece a una Junta General.` });
                }
                if (linked && linked.junta_general_id && linked.junta_general_id !== condo.id) {
                    return res.status(409).json({ status: 'error', message: `La junta con RIF ${rifMaybe} ya está vinculada a otra Junta General.` });
                }
            }

            const updated = await pool.query(
                `
                UPDATE junta_general_miembros
                SET nombre_referencia = $1,
                    cuota_participacion = $2,
                    rif = COALESCE($3, rif),
                    zona_id = $4,
                    updated_at = now()
                WHERE id = $5
                  AND junta_general_id = $6
                `,
                [nombre, cuota, rifMaybe, zonaId, id, condo.id]
            );

            if (!updated.rowCount) return res.status(404).json({ status: 'error', message: 'Miembro no encontrado.' });
            return res.json({ status: 'success', message: 'Miembro actualizado.' });
        } catch (error) {
            const raw = error instanceof Error ? error.message : 'Error al actualizar miembro.';
            const message = raw.includes('RIF_MIEMBRO_IGUAL_JUNTA_GENERAL')
                ? 'No puedes usar el mismo RIF de la Junta General.'
                : raw;
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.delete('/juntas-generales/miembros/:id', verifyToken, async (req: Request<MiembroParams>, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            if (!isJuntaGeneralTipo(condo.tipo)) return res.status(403).json({ status: 'error', message: 'Solo disponible para Junta General.' });

            const id = toPositiveInt(req.params?.id);
            if (!id) return res.status(400).json({ status: 'error', message: 'ID inválido.' });

            await pool.query('BEGIN');

            const memberRes = await pool.query<{ id: number; condominio_individual_id: number | null }>(
                `SELECT id, condominio_individual_id
                 FROM junta_general_miembros
                 WHERE id = $1
                   AND junta_general_id = $2
                 LIMIT 1`,
                [id, condo.id]
            );
            const member = memberRes.rows[0];
            if (!member) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Miembro no encontrado.' });
            }

            const hasHistoryRes = await pool.query<{ total: string }>(
                `SELECT COUNT(*)::text AS total
                 FROM junta_general_aviso_detalles
                 WHERE miembro_id = $1`,
                [id]
            );
            const hasHistory = parseInt(hasHistoryRes.rows[0]?.total || '0', 10) > 0;

            if (!hasHistory) {
                await pool.query(
                    `DELETE FROM junta_general_miembros
                     WHERE id = $1
                       AND junta_general_id = $2`,
                    [id, condo.id]
                );
                if (member.condominio_individual_id) {
                    await pool.query(
                        `UPDATE condominios
                         SET junta_general_id = NULL
                         WHERE id = $1
                           AND junta_general_id = $2`,
                        [member.condominio_individual_id, condo.id]
                    );
                }
                await pool.query('COMMIT');
                return res.json({ status: 'success', message: 'Vinculación eliminada correctamente.' });
            }

            await pool.query(
                `UPDATE junta_general_miembros
                 SET activo = false, updated_at = now(), codigo_invitacion = NULL, codigo_expira_at = NULL
                 WHERE id = $1 AND junta_general_id = $2`,
                [id, condo.id]
            );
            await pool.query('COMMIT');

            return res.json({ status: 'success', message: 'La junta se desactivó porque ya tiene historial de avisos.' });
        } catch (error) {
            await pool.query('ROLLBACK');
            const message = error instanceof Error ? error.message : 'Error al desactivar miembro.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.post('/juntas-generales/miembros/:id/invitacion', verifyToken, async (req: Request<MiembroParams>, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            if (!isJuntaGeneralTipo(condo.tipo)) return res.status(403).json({ status: 'error', message: 'Solo disponible para Junta General.' });

            const id = toPositiveInt(req.params?.id);
            if (!id) return res.status(400).json({ status: 'error', message: 'ID inválido.' });

            const code = randomCode();
            const expira = new Date(Date.now() + (15 * 24 * 60 * 60 * 1000));
            const updated = await pool.query(
                `
                UPDATE junta_general_miembros
                SET codigo_invitacion = $1,
                    codigo_expira_at = $2,
                    updated_at = now()
                WHERE id = $3
                  AND junta_general_id = $4
                  AND activo = true
                `,
                [code, expira.toISOString(), id, condo.id]
            );
            if (!updated.rowCount) return res.status(404).json({ status: 'error', message: 'Miembro no encontrado o inactivo.' });

            return res.json({
                status: 'success',
                data: {
                    codigo_invitacion: code,
                    expira_at: expira.toISOString(),
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Error al generar invitación.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.post('/juntas-generales/aceptar-invitacion', verifyToken, async (req: Request<{}, unknown, AceptarInvitacionBody>, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            if (isJuntaGeneralTipo(condo.tipo)) return res.status(400).json({ status: 'error', message: 'Una Junta General no puede vincularse como individual.' });

            const code = String(req.body?.codigo_invitacion || '').trim().toUpperCase();
            if (!code) return res.status(400).json({ status: 'error', message: 'codigo_invitacion requerido.' });

            await pool.query('BEGIN');

            const inv = await pool.query<{
                id: number;
                junta_general_id: number;
                cuota_participacion: string | number | null;
                codigo_expira_at: string | Date | null;
                activo: boolean;
                nombre_referencia: string;
                rif: string;
                general_nombre: string | null;
                general_nombre_legal: string | null;
                general_rif: string | null;
                general_estado: string | null;
            }>(
                `
                SELECT
                    m.id,
                    m.junta_general_id,
                    m.cuota_participacion,
                    m.codigo_expira_at,
                    m.activo,
                    m.nombre_referencia,
                    m.rif,
                    c.nombre AS general_nombre,
                    c.nombre_legal AS general_nombre_legal,
                    c.rif AS general_rif,
                    c.estado_venezuela AS general_estado
                FROM junta_general_miembros m
                INNER JOIN condominios c ON c.id = m.junta_general_id
                WHERE m.codigo_invitacion = $1
                LIMIT 1
                `,
                [code]
            );

            const invite = inv.rows[0];
            if (!invite || !invite.activo) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Código inválido o inactivo.' });
            }
            if (invite.codigo_expira_at && new Date(invite.codigo_expira_at).getTime() < Date.now()) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'El código de invitación ha expirado.' });
            }

            const inviteRif = normalizeJuntaRif(invite.rif);
            const condoRif = normalizeJuntaRif(condo.rif || '');
            if (!condoRif) {
                await pool.query('ROLLBACK');
                return res.status(409).json({ status: 'error', message: 'Tu junta no tiene RIF configurado. Actualízalo en el perfil para aceptar la invitación.' });
            }
            if (inviteRif && inviteRif !== condoRif) {
                await pool.query('ROLLBACK');
                return res.status(409).json({
                    status: 'error',
                    message: `El código corresponde al RIF ${inviteRif}. Tu junta está registrada con RIF ${condoRif}.`,
                });
            }

            await pool.query(
                `
                UPDATE junta_general_miembros
                SET condominio_individual_id = $1,
                    es_fantasma = false,
                    vinculado_at = now(),
                    codigo_invitacion = NULL,
                    codigo_expira_at = NULL,
                    updated_at = now(),
                    nombre_referencia = COALESCE(NULLIF($2, ''), nombre_referencia),
                    rif = COALESCE(NULLIF($3, ''), rif)
                WHERE id = $4
                `,
                [
                    condo.id,
                    condo.nombre_legal || condo.nombre || '',
                    normalizeRif(condo.rif || invite.rif),
                    invite.id,
                ]
            );

            await pool.query(
                `
                UPDATE condominios
                SET junta_general_id = $1,
                    tipo = CASE
                        WHEN tipo = 'Junta General' THEN tipo
                        WHEN tipo = 'Junta Individual' THEN tipo
                        ELSE 'Junta Individual'
                    END,
                    cuota_participacion = COALESCE(cuota_participacion, $2)
                WHERE id = $3
                `,
                [invite.junta_general_id, invite.cuota_participacion, condo.id]
            );

            const generalName = String(invite.general_nombre_legal || invite.general_nombre || 'Junta General').trim();
            const generalRif = normalizeRif(invite.general_rif || invite.rif);
            await ensureProveedorForJuntaGeneral(pool, {
                condominioId: condo.id,
                juntaGeneralNombre: generalName,
                juntaGeneralRif: generalRif,
                estadoVenezuela: String(condo.estado_venezuela || invite.general_estado || 'Distrito Capital'),
            });

            await pool.query(
                `
                INSERT INTO junta_general_notificaciones (condominio_id, tipo, titulo, mensaje, metadata_jsonb)
                VALUES ($1, 'VINCULACION_GENERAL', $2, $3, $4::jsonb)
                `,
                [
                    condo.id,
                    'Vinculación completada',
                    `Tu junta quedó vinculada a ${generalName}. La automatización aplicará desde este momento.`,
                    JSON.stringify({ junta_general_id: invite.junta_general_id }),
                ]
            );

            await pool.query('COMMIT');

            return res.json({ status: 'success', message: 'Vinculación completada correctamente.' });
        } catch (error) {
            await pool.query('ROLLBACK');
            const message = error instanceof Error ? error.message : 'Error al aceptar invitación.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.get('/juntas-generales/resumen', verifyToken, async (req: Request, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            if (!isJuntaGeneralTipo(condo.tipo)) return res.status(403).json({ status: 'error', message: 'Solo disponible para Junta General.' });

            const miembros = await listJuntaGeneralMiembrosActivos(pool, condo.id);
            const resumen = miembros.map((m) => {
                const generado = toNumber(m.saldo_usd_generado as string | number | null);
                const pagado = toNumber(m.saldo_usd_pagado as string | number | null);
                const pendiente = Math.max(0, generado - pagado);
                const generadoBs = toNumber(m.saldo_bs_generado as string | number | null);
                const pagadoBs = toNumber(m.saldo_bs_pagado as string | number | null);
                const pendienteBs = Math.max(0, generadoBs - pagadoBs);
                const morosidad = generado > 0 ? (pendiente / generado) * 100 : 0;
                return {
                    miembro_id: m.id,
                    nombre_junta_individual: m.condominio_nombre || m.nombre_referencia,
                    rif: m.condominio_rif || m.rif,
                    vinculada: Boolean(m.condominio_individual_id),
                    condominio_individual_id: m.condominio_individual_id,
                    cuota_participacion: Number(toNumber(m.cuota_participacion as string | number | null).toFixed(6)),
                    saldo_usd_generado: Number(generado.toFixed(2)),
                    saldo_usd_pagado: Number(pagado.toFixed(2)),
                    saldo_usd_pendiente: Number(pendiente.toFixed(2)),
                    saldo_bs_generado: Number(generadoBs.toFixed(2)),
                    saldo_bs_pagado: Number(pagadoBs.toFixed(2)),
                    saldo_bs_pendiente: Number(pendienteBs.toFixed(2)),
                    porcentaje_morosidad: Number(morosidad.toFixed(2)),
                    estado_cuenta: pendiente <= 0.005 ? 'SOLVENTE' : pagado > 0 ? 'ABONADO' : 'PENDIENTE',
                };
            });

            const totalGenerado = resumen.reduce((acc, r) => acc + r.saldo_usd_generado, 0);
            const totalPagado = resumen.reduce((acc, r) => acc + r.saldo_usd_pagado, 0);
            const totalPendiente = resumen.reduce((acc, r) => acc + r.saldo_usd_pendiente, 0);
            const totalGeneradoBs = resumen.reduce((acc, r) => acc + r.saldo_bs_generado, 0);
            const totalPagadoBs = resumen.reduce((acc, r) => acc + r.saldo_bs_pagado, 0);
            const totalPendienteBs = resumen.reduce((acc, r) => acc + r.saldo_bs_pendiente, 0);

            return res.json({
                status: 'success',
                data: {
                    juntas: resumen,
                    metricas: {
                        total_juntas: resumen.length,
                        total_vinculadas: resumen.filter((r) => r.vinculada).length,
                        total_usd_generado: Number(totalGenerado.toFixed(2)),
                        total_usd_pagado: Number(totalPagado.toFixed(2)),
                        total_usd_pendiente: Number(totalPendiente.toFixed(2)),
                        total_bs_generado: Number(totalGeneradoBs.toFixed(2)),
                        total_bs_pagado: Number(totalPagadoBs.toFixed(2)),
                        total_bs_pendiente: Number(totalPendienteBs.toFixed(2)),
                        porcentaje_morosidad_global: Number((totalGenerado > 0 ? (totalPendiente / totalGenerado) * 100 : 0).toFixed(2)),
                    },
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Error al cargar resumen.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.get('/juntas-generales/conciliacion', verifyToken, async (req: Request, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            if (!isJuntaGeneralTipo(condo.tipo)) return res.status(403).json({ status: 'error', message: 'Solo disponible para Junta General.' });

            const mes = String(req.query?.mes || '').trim();
            const miembroId = toPositiveInt(req.query?.miembro_id);
            const estado = String(req.query?.estado || '').trim().toUpperCase();

            const conciliacionRes = await pool.query<{
                detalle_id: number;
                aviso_id: number;
                mes_origen: string;
                miembro_id: number | null;
                junta_nombre: string;
                rif: string | null;
                gasto_id: number | null;
                concepto: string | null;
                monto_usd: string | number;
                monto_bs: string | number;
                pagado_usd: string | number;
                pagado_bs: string | number;
                pendiente_usd: string | number;
                pendiente_bs: string | number;
                estado_detalle: string | null;
                estado_conciliacion: string;
            }>(
                `
                SELECT
                    d.id AS detalle_id,
                    a.id AS aviso_id,
                    a.mes_origen,
                    m.id AS miembro_id,
                    COALESCE(ci.nombre_legal, ci.nombre, m.nombre_referencia, 'Junta Individual') AS junta_nombre,
                    COALESCE(ci.rif, m.rif) AS rif,
                    g.id AS gasto_id,
                    g.concepto,
                    d.monto_usd,
                    d.monto_bs,
                    COALESCE(g.monto_pagado_usd, 0) AS pagado_usd,
                    CASE
                        WHEN COALESCE(d.monto_usd, 0) > 0
                            THEN COALESCE(g.monto_pagado_usd, 0) * (COALESCE(d.monto_bs, 0) / NULLIF(d.monto_usd, 0))
                        ELSE 0
                    END AS pagado_bs,
                    GREATEST(COALESCE(d.monto_usd, 0) - COALESCE(g.monto_pagado_usd, 0), 0) AS pendiente_usd,
                    GREATEST(
                        COALESCE(d.monto_bs, 0) -
                        CASE
                            WHEN COALESCE(d.monto_usd, 0) > 0
                                THEN COALESCE(g.monto_pagado_usd, 0) * (COALESCE(d.monto_bs, 0) / NULLIF(d.monto_usd, 0))
                            ELSE 0
                        END,
                        0
                    ) AS pendiente_bs,
                    d.estado AS estado_detalle,
                    CASE
                        WHEN COALESCE(g.id, 0) = 0 THEN 'PENDIENTE_VINCULACION'
                        WHEN GREATEST(COALESCE(d.monto_usd, 0) - COALESCE(g.monto_pagado_usd, 0), 0) <= 0.005 THEN 'CONCILIADO'
                        WHEN COALESCE(g.monto_pagado_usd, 0) > 0 THEN 'ABONADO'
                        ELSE 'PENDIENTE'
                    END AS estado_conciliacion
                FROM junta_general_aviso_detalles d
                INNER JOIN junta_general_avisos a ON a.id = d.aviso_id
                LEFT JOIN junta_general_miembros m ON m.id = d.miembro_id
                LEFT JOIN condominios ci ON ci.id = d.condominio_individual_id
                LEFT JOIN gastos g ON g.id = d.gasto_generado_id
                WHERE a.junta_general_id = $1
                  AND ($2::text = '' OR a.mes_origen = $2)
                  AND ($3::int IS NULL OR m.id = $3)
                  AND (
                    $4::text = ''
                    OR CASE
                        WHEN COALESCE(g.id, 0) = 0 THEN 'PENDIENTE_VINCULACION'
                        WHEN GREATEST(COALESCE(d.monto_usd, 0) - COALESCE(g.monto_pagado_usd, 0), 0) <= 0.005 THEN 'CONCILIADO'
                        WHEN COALESCE(g.monto_pagado_usd, 0) > 0 THEN 'ABONADO'
                        ELSE 'PENDIENTE'
                    END = $4
                  )
                ORDER BY a.mes_origen DESC, d.id DESC
                LIMIT 500
                `,
                [condo.id, mes, miembroId, estado]
            );

            const rows = conciliacionRes.rows.map((r) => ({
                ...r,
                monto_usd: Number(toNumber(r.monto_usd).toFixed(2)),
                monto_bs: Number(toNumber(r.monto_bs).toFixed(2)),
                pagado_usd: Number(toNumber(r.pagado_usd).toFixed(2)),
                pagado_bs: Number(toNumber(r.pagado_bs).toFixed(2)),
                pendiente_usd: Number(toNumber(r.pendiente_usd).toFixed(2)),
                pendiente_bs: Number(toNumber(r.pendiente_bs).toFixed(2)),
            }));

            const metricas = {
                total_registros: rows.length,
                total_monto_usd: Number(rows.reduce((acc, r) => acc + Number(r.monto_usd || 0), 0).toFixed(2)),
                total_monto_bs: Number(rows.reduce((acc, r) => acc + Number(r.monto_bs || 0), 0).toFixed(2)),
                total_pagado_usd: Number(rows.reduce((acc, r) => acc + Number(r.pagado_usd || 0), 0).toFixed(2)),
                total_pagado_bs: Number(rows.reduce((acc, r) => acc + Number(r.pagado_bs || 0), 0).toFixed(2)),
                total_pendiente_usd: Number(rows.reduce((acc, r) => acc + Number(r.pendiente_usd || 0), 0).toFixed(2)),
                total_pendiente_bs: Number(rows.reduce((acc, r) => acc + Number(r.pendiente_bs || 0), 0).toFixed(2)),
            };

            return res.json({
                status: 'success',
                data: {
                    filtros: { mes: mes || null, miembro_id: miembroId || null, estado: estado || null },
                    metricas,
                    registros: rows,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Error al cargar conciliación.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.get('/juntas-generales/notificaciones', verifyToken, async (req: Request, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });

            const list = await pool.query(
                `
                SELECT id, tipo, titulo, mensaje, metadata_jsonb, leida, created_at
                FROM junta_general_notificaciones
                WHERE condominio_id = $1
                ORDER BY created_at DESC, id DESC
                LIMIT 100
                `,
                [condo.id]
            );

            return res.json({ status: 'success', data: list.rows });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Error al cargar notificaciones.';
            return res.status(500).json({ status: 'error', message });
        }
    });

    app.post('/juntas-generales/notificaciones/:id/leida', verifyToken, async (req: Request<MiembroParams>, res: Response) => {
        try {
            const auth = asAuthUser(req.user);
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioSesion(auth);
            if (!condo) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });

            const id = toPositiveInt(req.params?.id);
            if (!id) return res.status(400).json({ status: 'error', message: 'ID inválido.' });

            await pool.query(
                `UPDATE junta_general_notificaciones
                 SET leida = true
                 WHERE id = $1 AND condominio_id = $2`,
                [id, condo.id]
            );

            return res.json({ status: 'success' });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Error al actualizar notificación.';
            return res.status(500).json({ status: 'error', message });
        }
    });
};

module.exports = { registerJuntasRoutes };
