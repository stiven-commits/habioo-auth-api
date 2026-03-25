import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
const fs: typeof import('fs') = require('fs');
const path: typeof import('path') = require('path');
const multer: typeof import('multer') = require('multer');
const sharp: typeof import('sharp') = require('sharp');

interface AuthUser {
    id: number;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface ICondominioRow {
    id: number;
}

interface IPropiedadUsuarioRow {
    propiedad_id: number;
    condominio_id: number;
}

interface IAmenidadRow {
    id: number;
    condominio_id: number;
    nombre: string;
    descripcion: string | null;
    costo_usd: string | number;
    deposito_usd: string | number;
    activo: boolean;
}

interface ISolvenciaRow {
    total: string;
}

interface IReservacionInsertRow {
    id: number;
}

interface CreateAmenidadBody {
    nombre?: string;
    descripcion?: string | null;
    costo_usd?: string | number | null;
    deposito_usd?: string | number | null;
}

interface ReservarBody {
    amenidad_id?: string | number | null;
    fecha_reserva?: string | Date | null;
}

interface ToggleEstadoBody {
    activo?: boolean;
}

interface UpdateReservacionEstadoBody {
    estado?: string;
}

interface IReservacionRow {
    id: number;
    amenidad_id: number;
    propiedad_id: number;
    condominio_id?: number;
    fecha_reserva: string;
    estado: string;
    monto_total_usd: string | number;
    monto_pagado_usd?: string | number | null;
    deposito_usd?: string | number;
    monto_bs_pagado?: string | number | null;
    tasa_cambio?: string | number | null;
    referencia?: string | null;
    comprobante_url?: string | null;
    banco_destino_id?: number | null;
    banco_destino_nombre?: string | null;
    notas_pago?: unknown;
    created_at?: string;
    amenidad_nombre: string;
    propiedad_identificador: string;
}

interface IColumnInfoRow {
    column_name: string;
    data_type: string;
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

const parseNumeric = (value: unknown): number => {
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : NaN;
};

const round2 = (value: number): number => Number.parseFloat(value.toFixed(2));

const toIsoDate = (value: unknown): string => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const raw = String(value ?? '').trim();
    if (!raw) throw new Error('fecha_reserva es requerida.');

    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return raw;

    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) {
        const [, d, m, y] = dmy;
        return `${y}-${m}-${d}`;
    }

    throw new Error('fecha_reserva inválida. Use dd/mm/yyyy o yyyy-mm-dd.');
};

const registerAlquileresRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
    const alquileresUploadsDir = path.join(__dirname, '..', 'uploads', 'alquileres');
    if (!fs.existsSync(alquileresUploadsDir)) {
        fs.mkdirSync(alquileresUploadsDir, { recursive: true });
    }

    const getAdminCondominioId = async (userId: number): Promise<number | null> => {
        const r = await pool.query<ICondominioRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [userId]);
        return r.rows[0]?.id ?? null;
    };

    const getOwnerPropiedad = async (userId: number): Promise<IPropiedadUsuarioRow | null> => {
        const r = await pool.query<IPropiedadUsuarioRow>(
            `
            SELECT up.propiedad_id, p.condominio_id
            FROM usuarios_propiedades up
            INNER JOIN propiedades p ON p.id = up.propiedad_id
            WHERE up.user_id = $1
              AND COALESCE(up.acceso_portal, true) = true
            ORDER BY
              CASE WHEN LOWER(COALESCE(up.rol, '')) IN ('propietario', 'owner', 'copropietario', 'co_owner') THEN 0 ELSE 1 END,
              up.id ASC
            LIMIT 1
            `,
            [userId]
        );
        return r.rows[0] ?? null;
    };

    const resolveMovimientoFondoTipo = async (preferred: string[], fallback: string): Promise<string> => {
        try {
            const checkRes = await pool.query<{ consrc: string }>(
                `
                SELECT pg_get_constraintdef(oid) AS consrc
                FROM pg_constraint
                WHERE conname = 'movimientos_fondos_tipo_check'
                LIMIT 1
                `
            );
            const def = String(checkRes.rows[0]?.consrc || '');
            const allowed = new Set(Array.from(def.matchAll(/'([^']+)'/g)).map((m) => m[1].toUpperCase()));
            for (const t of preferred) {
                if (allowed.has(t.toUpperCase())) return t;
            }
        } catch {
            // noop
        }
        return fallback;
    };

    app.get('/alquileres', verifyToken, async (req: Request, res: Response) => {
        try {
            const user = asAuthUser(req.user);

            const [adminCondoId, ownerData] = await Promise.all([
                getAdminCondominioId(user.id),
                getOwnerPropiedad(user.id),
            ]);

            const condominioId = adminCondoId ?? ownerData?.condominio_id ?? null;
            if (!condominioId) {
                return res.status(403).json({ status: 'error', message: 'No autorizado para ver alquileres.' });
            }

            const isAdmin = adminCondoId !== null;
            const amenidades = await pool.query<IAmenidadRow>(
                `
                SELECT id, condominio_id, nombre, descripcion, costo_usd, deposito_usd, activo
                FROM amenidades
                WHERE condominio_id = $1
                  AND ($2::boolean = true OR activo = true)
                ORDER BY nombre ASC, id ASC
                `,
                [condominioId, isAdmin]
            );

            return res.json({ status: 'success', data: amenidades.rows });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.post('/alquileres', verifyToken, async (req: Request<{}, unknown, CreateAmenidadBody>, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getAdminCondominioId(user.id);
            if (!condominioId) {
                return res.status(403).json({ status: 'error', message: 'Solo administradores pueden crear alquileres.' });
            }

            const nombre = String(req.body?.nombre || '').trim();
            const descripcion = String(req.body?.descripcion || '').trim();
            const costoUsd = parseNumeric(req.body?.costo_usd);
            const depositoUsdRaw = req.body?.deposito_usd;
            const depositoUsd = String(depositoUsdRaw ?? '').trim() === '' ? 0 : parseNumeric(depositoUsdRaw);

            if (!nombre) {
                return res.status(400).json({ status: 'error', message: 'nombre es requerido.' });
            }
            if (!Number.isFinite(costoUsd) || costoUsd < 0) {
                return res.status(400).json({ status: 'error', message: 'costo_usd inválido.' });
            }
            if (!Number.isFinite(depositoUsd) || depositoUsd < 0) {
                return res.status(400).json({ status: 'error', message: 'deposito_usd inválido.' });
            }

            const insertRes = await pool.query<IReservacionInsertRow>(
                `
                INSERT INTO amenidades (condominio_id, nombre, descripcion, costo_usd, deposito_usd, activo)
                VALUES ($1, $2, $3, $4, $5, true)
                RETURNING id
                `,
                [condominioId, nombre, descripcion || null, costoUsd, depositoUsd]
            );

            return res.status(201).json({
                status: 'success',
                message: 'Amenidad creada correctamente.',
                data: { id: insertRes.rows[0]?.id ?? null },
            });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.put('/alquileres/:id', verifyToken, async (req: Request<{}, unknown, CreateAmenidadBody>, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getAdminCondominioId(user.id);
            if (!condominioId) {
                return res.status(403).json({ status: 'error', message: 'Solo administradores pueden editar alquileres.' });
            }

            const amenidadId = parseInt(String((req.params as Record<string, string | undefined>)?.id || ''), 10);
            if (!Number.isFinite(amenidadId) || amenidadId <= 0) {
                return res.status(400).json({ status: 'error', message: 'ID de amenidad inválido.' });
            }

            const nombre = String(req.body?.nombre || '').trim();
            const descripcion = String(req.body?.descripcion || '').trim();
            const costoUsd = parseNumeric(req.body?.costo_usd);
            const depositoUsdRaw = req.body?.deposito_usd;
            const depositoUsd = String(depositoUsdRaw ?? '').trim() === '' ? 0 : parseNumeric(depositoUsdRaw);

            if (!nombre) {
                return res.status(400).json({ status: 'error', message: 'nombre es requerido.' });
            }
            if (!Number.isFinite(costoUsd) || costoUsd < 0) {
                return res.status(400).json({ status: 'error', message: 'costo_usd inválido.' });
            }
            if (!Number.isFinite(depositoUsd) || depositoUsd < 0) {
                return res.status(400).json({ status: 'error', message: 'deposito_usd inválido.' });
            }

            const belongsRes = await pool.query<{ id: number }>(
                `SELECT id FROM amenidades WHERE id = $1 AND condominio_id = $2 LIMIT 1`,
                [amenidadId, condominioId]
            );
            if (belongsRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Amenidad no encontrada.' });
            }

            await pool.query(
                `
                UPDATE amenidades
                SET nombre = $1,
                    descripcion = $2,
                    costo_usd = $3,
                    deposito_usd = $4
                WHERE id = $5
                  AND condominio_id = $6
                `,
                [nombre, descripcion || null, costoUsd, depositoUsd, amenidadId, condominioId]
            );

            return res.json({
                status: 'success',
                message: 'Amenidad actualizada correctamente.',
                data: { id: amenidadId },
            });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.patch('/alquileres/:id/estado', verifyToken, async (req: Request<{}, unknown, ToggleEstadoBody>, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getAdminCondominioId(user.id);
            if (!condominioId) {
                return res.status(403).json({ status: 'error', message: 'Solo administradores pueden cambiar el estado.' });
            }

            const amenidadId = parseInt(String((req.params as Record<string, string | undefined>)?.id || ''), 10);
            if (!Number.isFinite(amenidadId) || amenidadId <= 0) {
                return res.status(400).json({ status: 'error', message: 'ID de amenidad inválido.' });
            }

            if (typeof req.body?.activo !== 'boolean') {
                return res.status(400).json({ status: 'error', message: 'activo es requerido (boolean).' });
            }

            const updateRes = await pool.query<{ id: number; activo: boolean }>(
                `
                UPDATE amenidades
                SET activo = $1
                WHERE id = $2
                  AND condominio_id = $3
                RETURNING id, activo
                `,
                [req.body.activo, amenidadId, condominioId]
            );
            if (updateRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Amenidad no encontrada.' });
            }

            return res.json({
                status: 'success',
                message: req.body.activo ? 'Amenidad activada correctamente.' : 'Amenidad desactivada correctamente.',
                data: updateRes.rows[0],
            });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.get('/alquileres/reservaciones', verifyToken, async (req: Request, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getAdminCondominioId(user.id);
            if (!condominioId) {
                return res.status(403).json({ status: 'error', message: 'Solo administradores pueden ver reservaciones.' });
            }

            const colsRes = await pool.query<IColumnInfoRow>(
                `
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'reservaciones'
                `
            );
            const cols = new Set(colsRes.rows.map((r) => r.column_name));

            const selectExtra: string[] = [];
            if (cols.has('monto_bs_pagado')) selectExtra.push('r.monto_bs_pagado');
            if (cols.has('tasa_cambio')) selectExtra.push('r.tasa_cambio');
            if (cols.has('referencia')) selectExtra.push('r.referencia');
            if (cols.has('comprobante_url')) selectExtra.push('r.comprobante_url');
            if (cols.has('banco_destino_id')) selectExtra.push('r.banco_destino_id');
            if (cols.has('notas_pago')) selectExtra.push('r.notas_pago');

            const withBancoJoin = cols.has('banco_destino_id');
            const bancoSelect = withBancoJoin
                ? ', cb.nombre_banco AS banco_destino_nombre'
                : '';
            const extraSql = selectExtra.length > 0 ? `,\n                    ${selectExtra.join(',\n                    ')}` : '';
            const joinBancoSql = withBancoJoin ? '\n                LEFT JOIN cuentas_bancarias cb ON cb.id = r.banco_destino_id' : '';

            const reservacionesRes = await pool.query<IReservacionRow>(
                `
                SELECT
                    r.id,
                    r.amenidad_id,
                    r.propiedad_id,
                    r.fecha_reserva,
                    r.estado,
                    r.monto_total_usd,
                    COALESCE((to_jsonb(r)->>'monto_pagado_usd')::numeric, 0) AS monto_pagado_usd,
                    a.deposito_usd,
                    a.nombre AS amenidad_nombre,
                    p.identificador AS propiedad_identificador
                    ${extraSql}
                    ${bancoSelect}
                FROM reservaciones r
                INNER JOIN amenidades a ON a.id = r.amenidad_id
                INNER JOIN propiedades p ON p.id = r.propiedad_id
                ${joinBancoSql}
                WHERE a.condominio_id = $1
                  AND p.condominio_id = $1
                ORDER BY r.fecha_reserva DESC, r.id DESC
                `,
                [condominioId]
            );

            const parseNotasPago = (raw: unknown): Record<string, unknown> => {
                if (!raw) return {};
                if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>;
                if (typeof raw === 'string') {
                    try {
                        const parsed = JSON.parse(raw) as unknown;
                        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
                    } catch {
                        return {};
                    }
                }
                return {};
            };

            const normalized = reservacionesRes.rows.map((row) => {
                const notas = parseNotasPago(row.notas_pago);
                return {
                    ...row,
                    monto_bs_pagado: row.monto_bs_pagado ?? notas.monto_bs_pagado ?? null,
                    tasa_cambio: row.tasa_cambio ?? notas.tasa_cambio ?? null,
                    referencia: row.referencia ?? (typeof notas.referencia === 'string' ? notas.referencia : null),
                    comprobante_url: row.comprobante_url ?? (typeof notas.comprobante_url === 'string' ? notas.comprobante_url : null),
                    banco_destino_id: row.banco_destino_id ?? (typeof notas.banco_destino_id === 'number' ? notas.banco_destino_id : null),
                    banco_destino_nombre: row.banco_destino_nombre ?? null,
                };
            });

            const bancosIdsPendientes = Array.from(
                new Set(
                    normalized
                        .filter((row) => !row.banco_destino_nombre && row.banco_destino_id)
                        .map((row) => Number(row.banco_destino_id))
                        .filter((id) => Number.isFinite(id) && id > 0)
                )
            );
            if (bancosIdsPendientes.length > 0) {
                const bancosLookup = await pool.query<{ id: number; nombre_banco: string | null }>(
                    `SELECT id, nombre_banco FROM cuentas_bancarias WHERE id = ANY($1::int[])`,
                    [bancosIdsPendientes]
                );
                const byId = new Map<number, string | null>(bancosLookup.rows.map((b) => [b.id, b.nombre_banco]));
                for (const row of normalized) {
                    if (!row.banco_destino_nombre && row.banco_destino_id) {
                        row.banco_destino_nombre = byId.get(Number(row.banco_destino_id)) ?? null;
                    }
                }
            }

            return res.json({ status: 'success', data: normalized });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.put('/alquileres/reservaciones/:id/estado', verifyToken, async (req: Request<{}, unknown, UpdateReservacionEstadoBody>, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getAdminCondominioId(user.id);
            if (!condominioId) {
                return res.status(403).json({ status: 'error', message: 'Solo administradores pueden actualizar reservaciones.' });
            }

            const reservacionId = parseInt(String((req.params as Record<string, string | undefined>)?.id || ''), 10);
            if (!Number.isFinite(reservacionId) || reservacionId <= 0) {
                return res.status(400).json({ status: 'error', message: 'ID de reservación inválido.' });
            }

            const estado = String(req.body?.estado || '').trim();
            const estadosValidos = new Set(['Aprobada', 'Rechazada', 'Confirmada']);
            if (!estadosValidos.has(estado)) {
                return res.status(400).json({
                    status: 'error',
                    message: "Estado inválido. Use: 'Aprobada', 'Rechazada' o 'Confirmada'.",
                });
            }

            const updateRes = await pool.query<{ id: number; estado: string }>(
                `
                UPDATE reservaciones r
                SET estado = $1
                FROM amenidades a
                WHERE r.id = $2
                  AND a.id = r.amenidad_id
                  AND a.condominio_id = $3
                RETURNING r.id, r.estado
                `,
                [estado, reservacionId, condominioId]
            );

            if (updateRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Reservación no encontrada.' });
            }

            return res.json({
                status: 'success',
                message: 'Estado de reservación actualizado correctamente.',
                data: updateRes.rows[0],
            });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.put('/alquileres/reservaciones/:id/aprobar-pago', verifyToken, async (req: Request, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getAdminCondominioId(user.id);
            if (!condominioId) {
                return res.status(403).json({ status: 'error', message: 'Solo administradores pueden aprobar pagos de reservaciones.' });
            }

            const reservacionId = parseInt(String((req.params as Record<string, string | undefined>)?.id || ''), 10);
            if (!Number.isFinite(reservacionId) || reservacionId <= 0) {
                return res.status(400).json({ status: 'error', message: 'ID de reservación inválido.' });
            }

            await pool.query('BEGIN');
            const reservacionRes = await pool.query<{
                id: number;
                estado: string;
                amenidad_nombre: string;
                propiedad_identificador: string;
                monto_total_usd: string | number;
                monto_pagado_usd: string | number;
                monto_bs_pagado: string | number;
                tasa_cambio: string | number;
                banco_destino_id: string | number | null;
                referencia: string | null;
                comprobante_url: string | null;
                historial_captures: string | null;
            }>(
                `
                SELECT
                    r.id,
                    r.estado,
                    a.nombre AS amenidad_nombre,
                    p.identificador AS propiedad_identificador,
                    COALESCE(r.monto_total_usd, 0) AS monto_total_usd,
                    COALESCE((to_jsonb(r)->>'monto_pagado_usd')::numeric, 0) AS monto_pagado_usd,
                    COALESCE((to_jsonb(r)->>'monto_bs_pagado')::numeric, 0) AS monto_bs_pagado,
                    COALESCE((to_jsonb(r)->>'tasa_cambio')::numeric, 0) AS tasa_cambio,
                    NULLIF(BTRIM(COALESCE((to_jsonb(r)->>'banco_destino_id'), '')), '') AS banco_destino_id,
                    NULLIF(BTRIM(COALESCE((to_jsonb(r)->>'referencia'), '')), '') AS referencia,
                    NULLIF(BTRIM(COALESCE((to_jsonb(r)->>'comprobante_url'), '')), '') AS comprobante_url,
                    NULLIF(BTRIM(COALESCE((to_jsonb(r)->>'historial_captures'), '')), '') AS historial_captures
                FROM reservaciones r
                INNER JOIN amenidades a ON a.id = r.amenidad_id
                INNER JOIN propiedades p ON p.id = r.propiedad_id
                WHERE r.id = $1
                  AND a.condominio_id = $2
                LIMIT 1
                FOR UPDATE
                `,
                [reservacionId, condominioId]
            );
            if (reservacionRes.rows.length === 0) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Reservación no encontrada.' });
            }

            const row = reservacionRes.rows[0];
            const montoTotalUsd = parseFloat(String(row.monto_total_usd ?? 0)) || 0;
            const montoPagadoUsd = parseFloat(String(row.monto_pagado_usd ?? 0)) || 0;
            const montoBsPagado = parseFloat(String(row.monto_bs_pagado ?? 0)) || 0;
            const tasaCambio = parseFloat(String(row.tasa_cambio ?? 0)) || 0;
            const bancoDestinoId = parseInt(String(row.banco_destino_id ?? ''), 10);
            const referenciaPago = String(row.referencia || '').trim();
            const comprobanteActual = String(row.comprobante_url || '').trim();
            if (montoBsPagado <= 0 || tasaCambio <= 0 || !comprobanteActual || !Number.isFinite(bancoDestinoId) || bancoDestinoId <= 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    status: 'error',
                    message: 'La reservación no tiene un pago temporal válido (monto_bs_pagado, tasa_cambio y comprobante_url).',
                });
            }

            const abonoUsd = montoBsPagado / tasaCambio;
            const nuevoPagado = montoPagadoUsd + abonoUsd;
            const nuevoEstado = nuevoPagado + 0.000001 >= montoTotalUsd ? 'CONFIRMADA' : 'PAGO_PARCIAL';

            const historialActual = String(row.historial_captures || '').trim();
            const historialCargas = [historialActual, comprobanteActual].filter(Boolean).join('\n');

            const fondoRes = await pool.query<{ id: number }>(
                `
                SELECT id
                FROM fondos
                WHERE cuenta_bancaria_id = $1
                  AND COALESCE(activo, true) = true
                ORDER BY CASE WHEN COALESCE(es_operativo, false) THEN 0 ELSE 1 END, id ASC
                LIMIT 1
                FOR UPDATE
                `,
                [bancoDestinoId]
            );
            if (fondoRes.rows.length === 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    status: 'error',
                    message: 'La cuenta bancaria destino no tiene fondos activos configurados.',
                });
            }

            const fondoDestinoId = fondoRes.rows[0].id;
            const abonoUsdRounded = round2(abonoUsd);
            const montoBsRounded = round2(montoBsPagado);
            const tipoIngreso = await resolveMovimientoFondoTipo(['INGRESO', 'ABONO', 'ENTRADA', 'AJUSTE_INICIAL'], 'AJUSTE_INICIAL');
            const notaMovimiento = `Ingreso alquiler (${referenciaPago || `ALQ-${reservacionId}`}) | Inmueble: ${row.propiedad_identificador || 'N/A'} | Espacio: ${row.amenidad_nombre || 'N/A'} | Bs ${montoBsRounded.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | USD ${abonoUsdRounded.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            await pool.query(
                `UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2`,
                [abonoUsdRounded, fondoDestinoId]
            );
            await pool.query(
                `
                INSERT INTO movimientos_fondos (fondo_id, tipo, monto, tasa_cambio, nota)
                VALUES ($1, $2, $3, $4, $5)
                `,
                [fondoDestinoId, tipoIngreso, abonoUsdRounded, tasaCambio, notaMovimiento]
            );

            const colsRes = await pool.query<IColumnInfoRow>(
                `
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'reservaciones'
                `
            );
            const cols = new Set(colsRes.rows.map((r) => r.column_name));

            const updates: string[] = ['estado = $1'];
            const params: unknown[] = [nuevoEstado];
            let idx = 2;

            if (cols.has('monto_pagado_usd')) {
                updates.push(`monto_pagado_usd = $${idx}`);
                params.push(nuevoPagado);
                idx += 1;
            }
            if (cols.has('historial_captures')) {
                updates.push(`historial_captures = $${idx}`);
                params.push(historialCargas || null);
                idx += 1;
            }
            if (cols.has('monto_bs_pagado')) {
                updates.push(`monto_bs_pagado = NULL`);
            }
            if (cols.has('tasa_cambio')) {
                updates.push(`tasa_cambio = NULL`);
            }
            if (cols.has('comprobante_url')) {
                updates.push(`comprobante_url = NULL`);
            }
            if (cols.has('referencia')) {
                updates.push(`referencia = NULL`);
            }

            params.push(reservacionId);
            const idIdx = idx;

            const updateRes = await pool.query<{ id: number; estado: string }>(
                `
                UPDATE reservaciones
                SET ${updates.join(', ')}
                WHERE id = $${idIdx}
                RETURNING id, estado
                `,
                params
            );

            await pool.query('COMMIT');
            return res.json({
                status: 'success',
                message: 'Pago de reservación aprobado correctamente.',
                data: {
                    id: updateRes.rows[0]?.id ?? reservacionId,
                    estado: updateRes.rows[0]?.estado ?? nuevoEstado,
                    abono_usd: Number(abonoUsd.toFixed(2)),
                    monto_pagado_usd: Number(nuevoPagado.toFixed(2)),
                },
            });
        } catch (err: unknown) {
            try { await pool.query('ROLLBACK'); } catch { /* noop */ }
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.get('/alquileres/mis-reservas', verifyToken, async (req: Request, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const ownerData = await getOwnerPropiedad(user.id);
            if (!ownerData) {
                return res.status(403).json({ status: 'error', message: 'Solo propietarios pueden ver sus reservaciones.' });
            }

            const misReservasRes = await pool.query<IReservacionRow>(
                `
                SELECT
                    r.id,
                    r.amenidad_id,
                    r.propiedad_id,
                    p.condominio_id,
                    r.fecha_reserva,
                    r.estado,
                    r.monto_total_usd,
                    COALESCE((to_jsonb(r)->>'monto_pagado_usd')::numeric, 0) AS monto_pagado_usd,
                    a.deposito_usd,
                    a.nombre AS amenidad_nombre,
                    p.identificador AS propiedad_identificador,
                    (to_jsonb(r)->>'monto_bs_pagado') AS monto_bs_pagado,
                    (to_jsonb(r)->>'tasa_cambio') AS tasa_cambio,
                    (to_jsonb(r)->>'referencia') AS referencia,
                    (to_jsonb(r)->>'comprobante_url') AS comprobante_url,
                    (to_jsonb(r)->>'banco_destino_id') AS banco_destino_id,
                    (to_jsonb(r)->'notas_pago') AS notas_pago,
                    cb.nombre_banco AS banco_destino_nombre
                FROM reservaciones r
                INNER JOIN amenidades a ON a.id = r.amenidad_id
                INNER JOIN propiedades p ON p.id = r.propiedad_id
                LEFT JOIN cuentas_bancarias cb
                  ON cb.id = CASE
                    WHEN (to_jsonb(r)->>'banco_destino_id') ~ '^[0-9]+$'
                    THEN (to_jsonb(r)->>'banco_destino_id')::int
                    ELSE NULL
                  END
                WHERE r.propiedad_id = $1
                ORDER BY r.fecha_reserva DESC, r.id DESC
                `,
                [ownerData.propiedad_id]
            );

            const parseNotasPago = (raw: unknown): Record<string, unknown> => {
                if (!raw) return {};
                if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>;
                if (typeof raw === 'string') {
                    try {
                        const parsed = JSON.parse(raw) as unknown;
                        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
                    } catch {
                        return {};
                    }
                }
                return {};
            };

            const normalized = misReservasRes.rows.map((row) => {
                const notas = parseNotasPago(row.notas_pago);
                return {
                    ...row,
                    monto_bs_pagado: row.monto_bs_pagado ?? notas.monto_bs_pagado ?? null,
                    tasa_cambio: row.tasa_cambio ?? notas.tasa_cambio ?? null,
                    referencia: row.referencia ?? (typeof notas.referencia === 'string' ? notas.referencia : null),
                    comprobante_url: row.comprobante_url ?? (typeof notas.comprobante_url === 'string' ? notas.comprobante_url : null),
                    banco_destino_id:
                        row.banco_destino_id ??
                        (typeof notas.banco_destino_id === 'number'
                            ? notas.banco_destino_id
                            : typeof notas.banco_destino_id === 'string'
                                ? notas.banco_destino_id
                                : null),
                };
            });

            return res.json({ status: 'success', data: normalized });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.post('/alquileres/reservaciones/:id/pagar', verifyToken, upload.single('comprobante'), async (req: Request, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const ownerData = await getOwnerPropiedad(user.id);
            if (!ownerData) {
                return res.status(403).json({ status: 'error', message: 'Solo propietarios pueden reportar pago de reservaciones.' });
            }

            const reservacionId = parseInt(String((req.params as Record<string, string | undefined>)?.id || ''), 10);
            if (!Number.isFinite(reservacionId) || reservacionId <= 0) {
                return res.status(400).json({ status: 'error', message: 'ID de reservación inválido.' });
            }

            const reservaRes = await pool.query<{ id: number; estado: string; propiedad_id: number }>(
                `
                SELECT id, estado, propiedad_id
                FROM reservaciones
                WHERE id = $1
                  AND propiedad_id = $2
                LIMIT 1
                `,
                [reservacionId, ownerData.propiedad_id]
            );
            const reserva = reservaRes.rows[0];
            if (!reserva) {
                return res.status(404).json({ status: 'error', message: 'Reservación no encontrada para este propietario.' });
            }
            const estadoReserva = String(reserva.estado || '').trim().toUpperCase();
            if (estadoReserva !== 'APROBADA' && estadoReserva !== 'PAGO_PARCIAL') {
                return res.status(400).json({ status: 'error', message: 'Solo se puede reportar pago en reservaciones APROBADA o PAGO_PARCIAL.' });
            }

            const montoBs = parseNumeric((req.body as Record<string, unknown>)?.monto_bs_pagado);
            const tasaCambio = parseNumeric((req.body as Record<string, unknown>)?.tasa_cambio);
            const referencia = String((req.body as Record<string, unknown>)?.referencia || '').trim();
            const fechaPagoRaw = String((req.body as Record<string, unknown>)?.fecha_pago || '').trim();
            const bancoDestinoIdRaw = String((req.body as Record<string, unknown>)?.banco_destino_id || '').trim();

            if (!Number.isFinite(montoBs) || montoBs <= 0) {
                return res.status(400).json({ status: 'error', message: 'monto_bs_pagado inválido.' });
            }
            if (!Number.isFinite(tasaCambio) || tasaCambio <= 0) {
                return res.status(400).json({ status: 'error', message: 'tasa_cambio inválida.' });
            }
            if (!referencia) {
                return res.status(400).json({ status: 'error', message: 'referencia es requerida.' });
            }

            let fechaPago = '';
            try {
                fechaPago = toIsoDate(fechaPagoRaw || new Date());
            } catch {
                return res.status(400).json({ status: 'error', message: 'fecha_pago inválida.' });
            }

            const bancoDestinoId = parseInt(bancoDestinoIdRaw, 10);
            if (!Number.isFinite(bancoDestinoId) || bancoDestinoId <= 0) {
                return res.status(400).json({ status: 'error', message: 'banco_destino_id inválido.' });
            }

            const uploadedFile = req.file as Express.Multer.File | undefined;
            const comprobanteFromBody = String((req.body as Record<string, unknown>)?.comprobante_url || '').trim();
            let comprobanteUrl: string | null = comprobanteFromBody || null;

            if (uploadedFile) {
                const mime = String(uploadedFile.mimetype || '').toLowerCase();
                if (mime.startsWith('image/')) {
                    const filename = `reserva_${reservacionId}_${Date.now()}.webp`;
                    await sharp(uploadedFile.buffer)
                        .rotate()
                        .resize({ width: 1600, withoutEnlargement: true })
                        .webp({ quality: 82 })
                        .toFile(path.join(alquileresUploadsDir, filename));
                    comprobanteUrl = `/uploads/alquileres/${filename}`;
                } else {
                    const ext = path.extname(uploadedFile.originalname || '').toLowerCase();
                    const safeExt = ext || '.bin';
                    const filename = `reserva_${reservacionId}_${Date.now()}${safeExt}`;
                    fs.writeFileSync(path.join(alquileresUploadsDir, filename), uploadedFile.buffer);
                    comprobanteUrl = `/uploads/alquileres/${filename}`;
                }
            }

            if (!comprobanteUrl) {
                return res.status(400).json({ status: 'error', message: 'Debes adjuntar un comprobante.' });
            }

            const colsRes = await pool.query<IColumnInfoRow>(
                `
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'reservaciones'
                `
            );
            const cols = new Map(colsRes.rows.map((r) => [r.column_name, r.data_type]));

            const updates: string[] = ['estado = $1'];
            const params: unknown[] = ['Pago_Reportado'];
            let idx = 2;

            if (cols.has('monto_bs_pagado')) {
                updates.push(`monto_bs_pagado = $${idx}`);
                params.push(montoBs);
                idx += 1;
            }
            if (cols.has('tasa_cambio')) {
                updates.push(`tasa_cambio = $${idx}`);
                params.push(tasaCambio);
                idx += 1;
            }
            if (cols.has('comprobante_url')) {
                updates.push(`comprobante_url = $${idx}`);
                params.push(comprobanteUrl);
                idx += 1;
            }
            if (cols.has('referencia')) {
                updates.push(`referencia = $${idx}`);
                params.push(referencia);
                idx += 1;
            }
            if (cols.has('fecha_pago')) {
                updates.push(`fecha_pago = $${idx}`);
                params.push(fechaPago);
                idx += 1;
            }
            if (cols.has('banco_destino_id')) {
                updates.push(`banco_destino_id = $${idx}`);
                params.push(bancoDestinoId);
                idx += 1;
            }

            const notasPago = {
                monto_bs_pagado: montoBs,
                tasa_cambio: tasaCambio,
                referencia,
                fecha_pago: fechaPago,
                banco_destino_id: bancoDestinoId,
                comprobante_url: comprobanteUrl,
            };

            if (cols.has('notas_pago')) {
                const notasType = cols.get('notas_pago');
                if (notasType === 'json' || notasType === 'jsonb') {
                    updates.push(`notas_pago = $${idx}::jsonb`);
                    params.push(JSON.stringify(notasPago));
                } else {
                    updates.push(`notas_pago = $${idx}`);
                    params.push(JSON.stringify(notasPago));
                }
                idx += 1;
            }

            params.push(reservacionId, ownerData.propiedad_id);
            const idIdx = idx;
            const propIdx = idx + 1;

            const updateRes = await pool.query<{ id: number; estado: string }>(
                `
                UPDATE reservaciones
                SET ${updates.join(', ')}
                WHERE id = $${idIdx}
                  AND propiedad_id = $${propIdx}
                RETURNING id, estado
                `,
                params
            );

            if (updateRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'No se pudo actualizar la reservación.' });
            }

            return res.json({
                status: 'success',
                message: 'Pago reportado correctamente.',
                data: {
                    id: updateRes.rows[0].id,
                    estado: updateRes.rows[0].estado,
                    comprobante_url: comprobanteUrl,
                },
            });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.post('/alquileres/reservar', verifyToken, async (req: Request<{}, unknown, ReservarBody>, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const ownerData = await getOwnerPropiedad(user.id);
            if (!ownerData) {
                return res.status(403).json({ status: 'error', message: 'Solo propietarios pueden reservar amenidades.' });
            }

            const amenidadId = parseInt(String(req.body?.amenidad_id || ''), 10);
            const fechaReserva = toIsoDate(req.body?.fecha_reserva);
            if (!Number.isFinite(amenidadId) || amenidadId <= 0) {
                return res.status(400).json({ status: 'error', message: 'amenidad_id inválido.' });
            }

            const solvenciaRes = await pool.query<{ saldo_actual: string | number }>(
                `SELECT COALESCE(saldo_actual, 0) AS saldo_actual FROM propiedades WHERE id = $1`,
                [ownerData.propiedad_id]
            );
            const saldoActual = parseFloat(String(solvenciaRes.rows[0]?.saldo_actual ?? 0)) || 0;
            if (saldoActual > 0) {
                return res.status(403).json({ status: 'error', message: 'Debes estar al día con tus pagos para reservar espacios.' });
            }

            const amenidadRes = await pool.query<IAmenidadRow>(
                `
                SELECT id, condominio_id, nombre, descripcion, costo_usd, deposito_usd, activo
                FROM amenidades
                WHERE id = $1
                  AND condominio_id = $2
                  AND activo = true
                LIMIT 1
                `,
                [amenidadId, ownerData.condominio_id]
            );
            if (amenidadRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Amenidad no encontrada.' });
            }

            const amenidad = amenidadRes.rows[0];
            const costo = Number(amenidad.costo_usd || 0);
            const deposito = Number(amenidad.deposito_usd || 0);
            const montoTotal = (Number.isFinite(costo) ? costo : 0) + (Number.isFinite(deposito) ? deposito : 0);

            const reservaActivaRes = await pool.query<{ id: number; estado: string; fecha_reserva: string }>(
                `
                SELECT id, estado, fecha_reserva
                FROM reservaciones
                WHERE propiedad_id = $1
                  AND UPPER(BTRIM(COALESCE(estado, ''))) IN ('PENDIENTE', 'APROBADA', 'PAGO_REPORTADO', 'PAGO_PARCIAL')
                ORDER BY id DESC
                LIMIT 1
                `,
                [ownerData.propiedad_id]
            );
            if (reservaActivaRes.rows.length > 0) {
                const activa = reservaActivaRes.rows[0];
                return res.status(409).json({
                    status: 'error',
                    message: `Ya existe una solicitud de alquiler activa para este inmueble (ID ${activa.id}, estado ${activa.estado}).`,
                });
            }

            const reservaRes = await pool.query<IReservacionInsertRow>(
                `
                INSERT INTO reservaciones (amenidad_id, propiedad_id, fecha_reserva, estado, monto_total_usd)
                VALUES ($1, $2, $3, 'Pendiente', $4)
                RETURNING id
                `,
                [amenidadId, ownerData.propiedad_id, fechaReserva, montoTotal]
            );

            return res.status(201).json({
                status: 'success',
                message: 'Reservación creada correctamente.',
                data: { id: reservaRes.rows[0]?.id ?? null, monto_total_usd: montoTotal },
            });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });
};

module.exports = { registerAlquileresRoutes };
