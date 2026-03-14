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

interface ICuentaBancariaRow {
    id: number;
    condominio_id: number;
    numero_cuenta: string | null;
    nombre_banco: string | null;
    apodo: string | null;
    tipo: string | null;
    nombre_titular: string | null;
    cedula_rif: string | null;
    telefono: string | null;
    activo: boolean;
    es_predeterminada: boolean;
}

interface ICountRow {
    count: string;
}

interface IMovimientoRow {
    tipo: string;
    fecha: string | Date;
    concepto: string;
    referencia: string | null;
    monto_bs: number | null;
    tasa_cambio: number | null;
    monto_usd: number | null;
    fondo_id: number | null;
    fondo_origen_id: number | null;
    fondo_destino_id: number | null;
}

interface IGastoPendienteRow {
    id: number;
    concepto: string;
    monto_usd: number;
    pagado: number;
    deuda_restante: number;
    proveedor: string;
    fecha_gasto: string | Date;
}

interface BancosParams {
    id?: string;
}

interface CreateBancoBody {
    numero_cuenta?: string | null;
    nombre_banco?: string | null;
    apodo?: string | null;
    tipo?: string | null;
    nombre_titular?: string | null;
    cedula_rif?: string | null;
    telefono?: string | null;
}

interface PagoProveedorBody {
    gasto_id: number;
    fondo_id: number;
    monto_bs?: number | null;
    tasa_cambio?: number | null;
    monto_usd: number;
    referencia: string | null;
    fecha_pago: string | Date;
    nota: string | null;
}

interface TransferenciaBody {
    fondo_origen_id: number;
    fondo_destino_id: number;
    monto_origen: number;
    tasa_cambio?: number | null;
    monto_destino: number;
    referencia: string | null;
    fecha: string | Date;
    nota: string | null;
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

const asNumber = (value: unknown): number => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new TypeError('Invalid number value');
    }
    return value;
};

const asOptionalStringOrNull = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null || typeof value === 'string') {
        return value as string | null | undefined;
    }
    throw new TypeError('Invalid optional string value');
};

const asError = (value: unknown): Error => {
    return value instanceof Error ? value : new Error(String(value));
};

const registerBancosRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    app.get('/bancos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const r = await pool.query<ICuentaBancariaRow>(
                //'SELECT cb.* FROM cuentas_bancarias cb JOIN condominios c ON cb.condominio_id = c.id WHERE c.admin_user_id = $1 ORDER BY cb.nombre_banco ASC',
                'SELECT cb.* FROM cuentas_bancarias cb JOIN condominios c ON cb.condominio_id = c.id WHERE c.admin_user_id = $1 AND cb.activo = true ORDER BY cb.nombre_banco ASC',
                [user.id]
            );
            res.json({ status: 'success', bancos: r.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/bancos', verifyToken, async (req: Request<{}, unknown, CreateBancoBody>, res: Response, _next: NextFunction) => {
        const { numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono } = req.body;
        try {
            const user = asAuthUser(req.user);
            const numeroCuentaSafe = asOptionalStringOrNull(numero_cuenta);
            const nombreBancoSafe = asOptionalStringOrNull(nombre_banco);
            const apodoSafe = asOptionalStringOrNull(apodo);
            const tipoSafe = asOptionalStringOrNull(tipo);
            const nombreTitularSafe = asOptionalStringOrNull(nombre_titular);
            const cedulaRifSafe = asOptionalStringOrNull(cedula_rif);
            const telefonoSafe = asOptionalStringOrNull(telefono);
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = c.rows[0].id;

            await pool.query(
                'INSERT INTO cuentas_bancarias (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [condoId, numeroCuentaSafe || '', nombreBancoSafe || '', apodoSafe, tipoSafe, nombreTitularSafe || '', cedulaRifSafe || '', telefonoSafe || '']
            );
            res.json({ status: 'success', message: 'Cuenta agregada' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/bancos/:id/predeterminada', verifyToken, async (req: Request<BancosParams>, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const cuentaId = asString(req.params.id);
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = c.rows[0].id;

            // ðŸ’¡ NUEVO REQUISITO: Verificar que la cuenta tenga al menos un fondo activo
            const fondos = await pool.query<ICountRow>('SELECT COUNT(*) FROM fondos WHERE cuenta_bancaria_id = $1 AND activo = true', [cuentaId]);
            if (parseInt(fondos.rows[0].count, 10) === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'âš ï¸ No se puede establecer como principal una cuenta que no tiene fondos asignados.'
                });
            }

            await pool.query('BEGIN');
            await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = false WHERE condominio_id = $1', [condoId]);
            await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = true WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
            await pool.query('COMMIT');

            res.json({ status: 'success', message: 'Cuenta principal actualizada con Ã©xito.' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    app.delete('/bancos/:id', verifyToken, async (req: Request<BancosParams>, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const cuentaId = asString(req.params.id);
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = c.rows[0].id;

            // Verificamos si aÃºn tiene FONDOS ACTIVOS por dentro
            const movs = await pool.query<ICountRow>(
                `SELECT COUNT(*) FROM fondos WHERE cuenta_bancaria_id = $1 AND activo = true`,
                [cuentaId]
            );

            if (parseInt(movs.rows[0].count, 10) > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'No se puede eliminar: Esta cuenta bancaria tiene fondos activos en su interior. Primero debe vaciar/eliminar dichos fondos.',
                });
            }

            // Soft delete de la cuenta
            await pool.query('UPDATE cuentas_bancarias SET activo = false WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
            res.json({ status: 'success', message: 'Cuenta bancaria eliminada con Ã©xito.' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    /// ðŸ¦ ESTADO DE CUENTA BANCARIO (Libro Mayor)
    app.get('/bancos-admin/:id/estado-cuenta', verifyToken, async (req: Request<BancosParams>, res: Response, _next: NextFunction) => {
        try {
            const cuentaId = parseInt(asString(req.params.id), 10); // ðŸ’¡ TRUCO: Forzamos a que sea un NÃºmero para que Postgres no falle

            // 1. ENTRADAS
            const entradas = await pool.query<IMovimientoRow>(`
                SELECT 'ENTRADA' as tipo, p.fecha_pago as fecha,
                       'Abono de Inmueble: ' || pr.identificador as concepto,
                       p.referencia,
                       CASE
                           WHEN p.moneda = 'BS' THEN p.monto_origen
                           WHEN p.moneda = 'USD' AND p.tasa_cambio IS NOT NULL AND p.tasa_cambio > 0 THEN (p.monto_usd * p.tasa_cambio)
                           ELSE null
                       END as monto_bs,
                       CASE
                           WHEN p.moneda = 'BS' THEN p.tasa_cambio
                           ELSE null
                       END as tasa_cambio,
                       p.monto_usd as monto_usd,
                       null::int as fondo_id, null::int as fondo_origen_id, null::int as fondo_destino_id
                FROM pagos p
                JOIN propiedades pr ON p.propiedad_id = pr.id
                WHERE p.cuenta_bancaria_id = $1 AND p.estado = 'Validado'
            `, [cuentaId]);

            // 2. SALIDAS (Proveedores)
            const salidas = await pool.query<IMovimientoRow>(`
                SELECT 'SALIDA' as tipo, pp.fecha_pago as fecha,
                       'Pago a Proveedor: ' || prov.nombre as concepto,
                       pp.referencia, pp.monto_bs, pp.tasa_cambio, pp.monto_usd,
                       pp.fondo_id as fondo_id, pp.fondo_id as fondo_origen_id, null::int as fondo_destino_id
                FROM pagos_proveedores pp
                JOIN gastos g ON pp.gasto_id = g.id
                JOIN proveedores prov ON g.proveedor_id = prov.id
                JOIN fondos f ON pp.fondo_id = f.id
                WHERE f.cuenta_bancaria_id = $1
            `, [cuentaId]);

            // 3. TRANSFERENCIAS ENTRANTES
            const transferenciasIn = await pool.query<IMovimientoRow>(`
                SELECT 'TRANSFERENCIA_IN' as tipo, t.fecha,
                       'Transferencia recibida desde: ' || f_orig.nombre as concepto,
                       t.referencia,
                       CASE
                           WHEN f_dest.moneda = 'BS' THEN t.monto_destino
                           WHEN f_orig.moneda = 'BS' THEN t.monto_origen
                           ELSE null
                       END as monto_bs,
                       t.tasa_cambio,
                       CASE
                           WHEN f_dest.moneda = 'USD' THEN t.monto_destino
                           WHEN f_orig.moneda = 'USD' THEN t.monto_origen
                           WHEN t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_destino / t.tasa_cambio)
                           ELSE 0
                        END as monto_usd,
                        t.fondo_destino_id as fondo_id, t.fondo_origen_id, t.fondo_destino_id
                FROM transferencias t
                JOIN fondos f_dest ON t.fondo_destino_id = f_dest.id
                JOIN fondos f_orig ON t.fondo_origen_id = f_orig.id
                WHERE f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id != $1
            `, [cuentaId]);

            // 4. TRANSFERENCIAS SALIENTES
            const transferenciasOut = await pool.query<IMovimientoRow>(`
                SELECT 'TRANSFERENCIA_OUT' as tipo, t.fecha,
                       'Transferencia enviada a: ' || f_dest.nombre as concepto,
                       t.referencia,
                       CASE
                           WHEN f_orig.moneda = 'BS' THEN t.monto_origen
                           WHEN f_dest.moneda = 'BS' THEN t.monto_destino
                           ELSE null
                       END as monto_bs,
                       t.tasa_cambio,
                       CASE
                           WHEN f_orig.moneda = 'USD' THEN t.monto_origen
                           WHEN f_dest.moneda = 'USD' THEN t.monto_destino
                           WHEN t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_origen / t.tasa_cambio)
                           ELSE 0
                        END as monto_usd,
                        t.fondo_origen_id as fondo_id, t.fondo_origen_id, t.fondo_destino_id
                FROM transferencias t
                JOIN fondos f_orig ON t.fondo_origen_id = f_orig.id
                JOIN fondos f_dest ON t.fondo_destino_id = f_dest.id
                WHERE f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id != $1
            `, [cuentaId]);

            // 5. ðŸ’¡ TRANSFERENCIAS INTERNAS (El dinero cambia de fondo, pero NO sale de esta cuenta bancaria)
            const transferenciasInternas = await pool.query<IMovimientoRow>(`
                SELECT 'INTERNA' as tipo, t.fecha,
                       'Traspaso interno: ' || f_orig.nombre || ' âž” ' || f_dest.nombre as concepto,
                       t.referencia,
                       CASE
                           WHEN f_orig.moneda = 'BS' THEN t.monto_origen
                           WHEN f_dest.moneda = 'BS' THEN t.monto_destino
                           ELSE null
                       END as monto_bs,
                       t.tasa_cambio,
                       CASE
                           WHEN f_orig.moneda = 'USD' THEN t.monto_origen
                           WHEN f_dest.moneda = 'USD' THEN t.monto_destino
                           WHEN t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_origen / t.tasa_cambio)
                           ELSE 0
                        END as monto_usd,
                        null::int as fondo_id, t.fondo_origen_id, t.fondo_destino_id
                FROM transferencias t
                JOIN fondos f_orig ON t.fondo_origen_id = f_orig.id
                JOIN fondos f_dest ON t.fondo_destino_id = f_dest.id
                WHERE f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id = $1
            `, [cuentaId]);

            const movimientos: IMovimientoRow[] = [
                ...entradas.rows,
                ...salidas.rows,
                ...transferenciasIn.rows,
                ...transferenciasOut.rows,
                ...transferenciasInternas.rows
            ];

            movimientos.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

            res.json({ status: 'success', movimientos });
        } catch (error: unknown) {
            const typedError = asError(error);
            console.error('Error en estado de cuenta:', error);
            res.status(500).json({ error: typedError.message });
        }
    });

    // ðŸ”„ REGISTRAR TRANSFERENCIA ENTRE FONDOS/CUENTAS
    app.post('/transferencias', verifyToken, async (req: Request<{}, unknown, TransferenciaBody>, res: Response, _next: NextFunction) => {
        const { fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota } = req.body;

        try {
            const user = asAuthUser(req.user);
            const fondoOrigenIdSafe = asNumber(fondo_origen_id);
            const fondoDestinoIdSafe = asNumber(fondo_destino_id);
            const montoOrigenSafe = asNumber(monto_origen);
            const montoDestinoSafe = asNumber(monto_destino);
            const referenciaSafe = asOptionalStringOrNull(referencia);
            const notaSafe = asOptionalStringOrNull(nota);
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = condoRes.rows[0].id;

            await pool.query('BEGIN');

            // 1. Guardamos el registro de la transferencia
            await pool.query(
                `INSERT INTO transferencias (condominio_id, fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [condoId, fondoOrigenIdSafe, fondoDestinoIdSafe, montoOrigenSafe, tasa_cambio || null, montoDestinoSafe, referenciaSafe, fecha, notaSafe]
            );

            // 2. Restamos el dinero del fondo de Origen
            await pool.query(`UPDATE fondos SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [montoOrigenSafe, fondoOrigenIdSafe]);

            // 3. Sumamos el dinero al fondo de Destino
            // (Nota: monto_origen y monto_destino pueden ser distintos si estÃ¡s pasando de Bs a USD)
            await pool.query(`UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [montoDestinoSafe, fondoDestinoIdSafe]);

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Transferencia procesada exitosamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    // ðŸ” OBTENER GASTOS PENDIENTES POR PAGAR AL PROVEEDOR
    app.get('/gastos-pendientes-pago', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = condoRes.rows[0].id;

            const result = await pool.query<IGastoPendienteRow>(`
                SELECT g.id, g.concepto, g.monto_usd, COALESCE(g.monto_pagado_usd, 0) as pagado,
                       (g.monto_usd - COALESCE(g.monto_pagado_usd, 0)) as deuda_restante,
                       p.nombre as proveedor, g.fecha_gasto
                FROM gastos g
                JOIN proveedores p ON g.proveedor_id = p.id
                WHERE g.condominio_id = $1 AND (g.monto_usd - COALESCE(g.monto_pagado_usd, 0)) > 0
                ORDER BY g.fecha_gasto ASC
            `, [condoId]);

            res.json({ status: 'success', gastos: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerBancosRoutes };

