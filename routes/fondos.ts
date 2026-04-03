import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

const {
    getCondominioByAdminUserId,
    isJuntaGeneralTipo,
}: {
    getCondominioByAdminUserId: (pool: Pool, adminUserId: number) => Promise<{ id: number; tipo: string | null } | null>;
    isJuntaGeneralTipo: (tipo: unknown) => boolean;
} = require('../services/juntaGeneral');

interface AuthUser {
    id: number;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
    parseLocaleNumber: (value: unknown) => number;
}

interface ICondominioIdRow {
    id: number;
}

interface IFondoWithBancoRow {
    id: number;
    condominio_id: number;
    cuenta_bancaria_id: number;
    nombre: string;
    moneda: string;
    porcentaje_asignacion: number;
    saldo_actual: string | number;
    es_operativo: boolean;
    activo: boolean;
    visible_propietarios: boolean;
    fecha_saldo: string | null;
    nombre_banco: string;
    apodo: string | null;
}

interface IInsertedIdRow {
    id: number;
}

interface IFondoRow {
    id: number;
    condominio_id: number;
    cuenta_bancaria_id: number;
    nombre: string;
    moneda: string;
    porcentaje_asignacion: number;
    saldo_actual: string | number;
    es_operativo: boolean;
    activo: boolean;
    visible_propietarios: boolean;
    fecha_saldo: string | null;
}

interface IUsageRow {
    total_usos: string;
}

interface IFondoUsageCountRow {
    movimientos_fondos: string;
    gastos_pagos_fondos: string;
    pagos_proveedores: string;
    transferencias: string;
}

interface FondosDeleteParams {
    id?: string;
}

interface FondoVisibilityBody {
    visible_propietarios?: boolean;
}

interface CreateFondoBody {
    cuenta_bancaria_id: number;
    nombre: string;
    moneda: string;
    porcentaje: unknown;
    saldo_inicial: unknown;
    es_operativo?: boolean;
    fecha_saldo?: string | null;
}

interface DeleteFondoBody {
    destino_id?: string | number;
}

interface RenameFondoBody {
    nombre?: string;
    fecha_saldo?: string | null;
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

const asString = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new TypeError('Invalid string value');
    }
    return value;
};

const asError = (value: unknown): Error => {
    return value instanceof Error ? value : new Error(String(value));
};

const toIsoDateNullable = (value: unknown, fieldName: string): string | null => {
    if (value === undefined) return null;
    if (value === null) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!ymd) throw new Error(`${fieldName} invalida. Use yyyy-mm-dd.`);
    const safe = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const dt = new Date(`${safe}T00:00:00`);
    if (Number.isNaN(dt.getTime())) throw new Error(`${fieldName} invalida. Use yyyy-mm-dd.`);
    return safe;
};

const registerFondosRoutes = (app: Application, { pool, verifyToken, parseLocaleNumber }: AuthDependencies): void => {
    app.get('/fondos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const result = await pool.query<IFondoWithBancoRow>(
                `
            SELECT f.*, cb.nombre_banco, cb.apodo 
            FROM fondos f 
            JOIN cuentas_bancarias cb ON f.cuenta_bancaria_id = cb.id 
            JOIN condominios c ON c.id = f.condominio_id
            WHERE c.admin_user_id = $1
              AND f.activo = true
            ORDER BY cb.nombre_banco ASC, f.es_operativo DESC, f.nombre ASC
        `,
                [user.id]
            );
            res.json({ status: 'success', fondos: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/fondos/:id/visibilidad-propietarios', verifyToken, async (req: Request<FondosDeleteParams, unknown, FondoVisibilityBody>, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const fondoId = asString(req.params.id);
            const visible = Boolean(req.body?.visible_propietarios);
            const condo = await getCondominioByAdminUserId(pool, user.id);
            const condoId = condo?.id;

            if (!condoId) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            }
            if (isJuntaGeneralTipo(condo?.tipo)) {
                return res.status(403).json({
                    status: 'error',
                    message: 'La Junta General no gestiona visibilidad de fondos por inmueble.',
                });
            }

            const updated = await pool.query<IFondoRow>(
                `
                UPDATE fondos
                SET visible_propietarios = $1
                WHERE id = $2
                  AND condominio_id = $3
                RETURNING id, condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo, activo, visible_propietarios, fecha_saldo
                `,
                [visible, fondoId, condoId]
            );

            if (updated.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Fondo no encontrado.' });
            }

            return res.json({
                status: 'success',
                message: visible ? 'Fondo visible para inmuebles.' : 'Fondo oculto para inmuebles.',
            });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ status: 'error', message: error.message });
        }
    });

    app.put('/fondos/:id/operativo', verifyToken, async (req: Request<FondosDeleteParams>, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const fondoId = asString(req.params.id);

            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = condoRes.rows[0]?.id;

            if (!condoId) return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });

            const fondoRes = await pool.query<IFondoRow>('SELECT cuenta_bancaria_id FROM fondos WHERE id = $1 AND condominio_id = $2', [fondoId, condoId]);
            if (fondoRes.rows.length === 0) return res.status(404).json({ error: 'Fondo no encontrado.' });
            
            const cuentaBancariaId = fondoRes.rows[0].cuenta_bancaria_id;

            await pool.query('UPDATE fondos SET es_operativo = false WHERE cuenta_bancaria_id = $1 AND condominio_id = $2', [cuentaBancariaId, condoId]);
            await pool.query('UPDATE fondos SET es_operativo = true, porcentaje_asignacion = 0 WHERE id = $1 AND condominio_id = $2', [fondoId, condoId]);

            return res.json({ status: 'success', message: 'Fondo establecido como principal.' });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ status: 'error', message: error.message });
        }
    });

    app.put('/fondos/:id', verifyToken, async (req: Request<FondosDeleteParams, unknown, RenameFondoBody>, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const fondoId = asString(req.params.id);
            const hasNombre = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'nombre');
            const hasFechaSaldo = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'fecha_saldo');
            const nombre = String(req.body?.nombre || '').trim();
            const fechaSaldoSafe = toIsoDateNullable(req.body?.fecha_saldo, 'fecha_saldo');

            if (!hasNombre && !hasFechaSaldo) {
                return res.status(400).json({ status: 'error', message: 'Debe enviar nombre y/o fecha_saldo.' });
            }
            if (hasNombre && !nombre) {
                return res.status(400).json({ status: 'error', message: 'El nombre del fondo es obligatorio.' });
            }

            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = condoRes.rows[0]?.id;
            if (!condoId) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            }

            const updatedRes = await pool.query<IFondoRow>(
                `
                UPDATE fondos
                SET
                  nombre = CASE WHEN $1::boolean THEN $2 ELSE nombre END,
                  fecha_saldo = CASE WHEN $3::boolean THEN $4 ELSE fecha_saldo END
                WHERE id = $5
                  AND condominio_id = $6
                RETURNING id, condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo, activo, visible_propietarios, fecha_saldo
                `,
                [hasNombre, nombre, hasFechaSaldo, fechaSaldoSafe, fondoId, condoId]
            );

            if (updatedRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Fondo no encontrado.' });
            }

            return res.json({ status: 'success', message: 'Fondo actualizado correctamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ status: 'error', message: error.message });
        }
    });

    app.post('/fondos', verifyToken, async (req: Request<{}, unknown, CreateFondoBody>, res: Response, _next: NextFunction) => {
        const { cuenta_bancaria_id, nombre, moneda, porcentaje, saldo_inicial, es_operativo } = req.body;
        const porcNum = es_operativo ? 0 : parseLocaleNumber(porcentaje);
        const saldoNum = parseLocaleNumber(saldo_inicial);
        const fechaSaldoSafe = toIsoDateNullable(req.body?.fecha_saldo, 'fecha_saldo');

        try {
            const user = asAuthUser(req.user);
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const fondo = await pool.query<IInsertedIdRow>(
                'INSERT INTO fondos (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo, fecha_saldo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
                [condoRes.rows[0].id, cuenta_bancaria_id, nombre, moneda, porcNum, saldoNum, es_operativo || false, fechaSaldoSafe]
            );

            if (saldoNum !== 0) {
                await pool.query('INSERT INTO movimientos_fondos (fondo_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', [fondo.rows[0].id, 'AJUSTE_INICIAL', saldoNum, 'Saldo de apertura del fondo']);
            }
            res.json({ status: 'success', message: 'Fondo creado y anclado a la cuenta.' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.delete('/fondos/:id', verifyToken, async (req: Request<FondosDeleteParams, unknown, DeleteFondoBody>, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const fondoId = asString(req.params.id);
            const destinoIdRaw = req.body?.destino_id;
            const destinoId = destinoIdRaw !== undefined && destinoIdRaw !== null && String(destinoIdRaw).trim() !== ''
                ? parseInt(String(destinoIdRaw), 10)
                : null;

            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = condoRes.rows[0].id;

            const fondoRes = await pool.query<IFondoRow>(
                'SELECT id, moneda, saldo_actual FROM fondos WHERE id = $1 AND condominio_id = $2',
                [fondoId, condoId],
            );
            if (fondoRes.rows.length === 0) {
                return res.status(404).json({ error: 'Fondo no encontrado.' });
            }
            const fondoActual = fondoRes.rows[0];
            const saldoActual = parseFloat(String(fondoActual.saldo_actual || 0)) || 0;

            const usageRes = await pool.query<IFondoUsageCountRow>(
                `
                SELECT
                    (SELECT COUNT(*)::text FROM movimientos_fondos WHERE fondo_id = $1 AND tipo <> 'AJUSTE_INICIAL') AS movimientos_fondos,
                    (SELECT COUNT(*)::text FROM gastos_pagos_fondos WHERE fondo_id = $1) AS gastos_pagos_fondos,
                    (SELECT COUNT(*)::text FROM pagos_proveedores WHERE fondo_id = $1) AS pagos_proveedores,
                    (SELECT COUNT(*)::text FROM transferencias WHERE fondo_origen_id = $1 OR fondo_destino_id = $1) AS transferencias
                `,
                [fondoId],
            );

            const usage = usageRes.rows[0];
            const totalAsociados =
                parseInt(usage.movimientos_fondos, 10) +
                parseInt(usage.gastos_pagos_fondos, 10) +
                parseInt(usage.pagos_proveedores, 10) +
                parseInt(usage.transferencias, 10);

            if (totalAsociados > 0) {
                return res.status(400).json({
                    error: 'No se puede eliminar el fondo porque ya tiene movimientos bancarios asociados.',
                });
            }

            await pool.query('BEGIN');

            if (saldoActual > 0 && destinoId) {
                const destinoRes = await pool.query<IFondoRow>(
                    'SELECT id, moneda FROM fondos WHERE id = $1 AND condominio_id = $2 AND activo = true LIMIT 1',
                    [destinoId, condoId]
                );
                if (destinoRes.rows.length === 0) {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({ error: 'El fondo destino no existe o no pertenece al condominio.' });
                }
                if (String(destinoRes.rows[0].moneda || '').toUpperCase() !== String(fondoActual.moneda || '').toUpperCase()) {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({ error: 'El fondo destino debe tener la misma moneda.' });
                }
                await pool.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [saldoActual, destinoId]);
            }

            await pool.query('DELETE FROM fondos WHERE id = $1 AND condominio_id = $2', [fondoId, condoId]);
            await pool.query('COMMIT');

            return res.status(200).json({ status: 'success', message: 'Fondo eliminado correctamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            try { await pool.query('ROLLBACK'); } catch (_rollbackError) { /* noop */ }
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerFondosRoutes };

