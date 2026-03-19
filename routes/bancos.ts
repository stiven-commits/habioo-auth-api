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
    acepta_transferencia?: boolean;
    acepta_pago_movil?: boolean;
    pago_movil_telefono?: string | null;
    pago_movil_cedula_rif?: string | null;
    activo: boolean;
    es_predeterminada: boolean;
}

interface ICountRow {
    count: string;
}

interface IMovimientoRow {
    id: string;
    tipo: string;
    fecha: string | Date;
    concepto: string;
    referencia: string | null;
    monto_bs: number | null;
    tasa_cambio: number | null;
    monto_usd: number | null;
    monto_origen_pago?: number | null;
    banco_origen?: string | null;
    cedula_origen?: string | null;
    fondo_id: number | null;
    fondo_origen_id: number | null;
    fondo_destino_id: number | null;
    fondo_nombre: string | null;
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

interface ITableColumnRow {
    table_name: string;
    column_name: string;
}

interface IColumnNameRow {
    column_name: string;
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
    acepta_transferencia?: boolean;
    acepta_pago_movil?: boolean;
    pago_movil_telefono?: string | null;
    pago_movil_cedula_rif?: string | null;
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
    fondo_origen_id: unknown;
    fondo_destino_id?: unknown;
    cuenta_destino_id?: unknown;
    monto_origen: unknown;
    tasa_cambio?: unknown;
    monto_destino: unknown;
    referencia: string | null;
    fecha: string | Date;
    nota: string | null;
}

interface IFondoTransferRow {
    id: number;
    cuenta_bancaria_id: number;
    condominio_id: number;
    moneda: string;
    porcentaje_asignacion: number | string;
    es_operativo: boolean;
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

const asPositiveInt = (value: unknown, fieldName: string): number => {
    const parsed = typeof value === 'number'
        ? value
        : parseInt(String(value ?? '').trim(), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new TypeError(`Invalid ${fieldName} value`);
    }
    return parsed;
};

const asDecimal = (value: unknown, fieldName: string): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = String(value ?? '').trim().replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
        throw new TypeError(`Invalid ${fieldName} value`);
    }
    return parsed;
};

const asOptionalStringOrNull = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null || typeof value === 'string') {
        return value as string | null | undefined;
    }
    throw new TypeError('Invalid optional string value');
};

const asOptionalBoolean = (value: unknown): boolean | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    throw new TypeError('Invalid optional boolean value');
};

const asError = (value: unknown): Error => {
    return value instanceof Error ? value : new Error(String(value));
};

const toIsoDate = (value: unknown, fieldName: string): string => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const raw = String(value ?? '').trim();
    if (!raw) throw new Error(`${fieldName} es requerida.`);

    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

    throw new Error(`${fieldName} inválida. Use dd/mm/yyyy o yyyy-mm-dd.`);
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
        const {
            numero_cuenta,
            nombre_banco,
            apodo,
            tipo,
            nombre_titular,
            cedula_rif,
            telefono,
            acepta_transferencia,
            acepta_pago_movil,
            pago_movil_telefono,
            pago_movil_cedula_rif,
        } = req.body;
        try {
            const user = asAuthUser(req.user);
            const numeroCuentaSafe = asOptionalStringOrNull(numero_cuenta);
            const nombreBancoSafe = asOptionalStringOrNull(nombre_banco);
            const apodoSafe = asOptionalStringOrNull(apodo);
            const tipoSafe = asOptionalStringOrNull(tipo);
            const nombreTitularSafe = asOptionalStringOrNull(nombre_titular);
            const cedulaRifSafe = asOptionalStringOrNull(cedula_rif);
            const telefonoSafe = asOptionalStringOrNull(telefono);
            const aceptaTransferenciaSafe = asOptionalBoolean(acepta_transferencia);
            const aceptaPagoMovilSafe = asOptionalBoolean(acepta_pago_movil);
            const pagoMovilTelefonoSafe = asOptionalStringOrNull(pago_movil_telefono);
            const pagoMovilCedulaRifSafe = asOptionalStringOrNull(pago_movil_cedula_rif);
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = c.rows[0].id;

            const cuentaCols = await pool.query<IColumnNameRow>(
                `SELECT column_name
                 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'cuentas_bancarias'`
            );
            const hasCuentaCol = (name: string): boolean => cuentaCols.rows.some((r) => r.column_name === name);

            const tipoNormalized = String(tipoSafe || '').trim();
            const isLegacyTransfer = tipoNormalized === 'Transferencia';
            const isLegacyPagoMovil = tipoNormalized === 'Pago Movil';

            const canales = {
                aceptaTransferencia: aceptaTransferenciaSafe ?? (isLegacyTransfer ? true : (isLegacyPagoMovil ? false : false)),
                aceptaPagoMovil: aceptaPagoMovilSafe ?? isLegacyPagoMovil,
                pagoMovilTelefono: (pagoMovilTelefonoSafe || telefonoSafe || '').trim(),
                pagoMovilCedulaRif: (pagoMovilCedulaRifSafe || cedulaRifSafe || '').trim(),
            };

            const insertCols: string[] = ['condominio_id', 'numero_cuenta', 'nombre_banco', 'apodo', 'tipo', 'nombre_titular', 'cedula_rif', 'telefono'];
            const insertVals: unknown[] = [condoId, numeroCuentaSafe || '', nombreBancoSafe || '', apodoSafe, tipoSafe, nombreTitularSafe || '', cedulaRifSafe || '', telefonoSafe || ''];

            if (hasCuentaCol('acepta_transferencia')) {
                insertCols.push('acepta_transferencia');
                insertVals.push(canales.aceptaTransferencia);
            }
            if (hasCuentaCol('acepta_pago_movil')) {
                insertCols.push('acepta_pago_movil');
                insertVals.push(canales.aceptaPagoMovil);
            }
            if (hasCuentaCol('pago_movil_telefono')) {
                insertCols.push('pago_movil_telefono');
                insertVals.push(canales.aceptaPagoMovil ? canales.pagoMovilTelefono : null);
            }
            if (hasCuentaCol('pago_movil_cedula_rif')) {
                insertCols.push('pago_movil_cedula_rif');
                insertVals.push(canales.aceptaPagoMovil ? canales.pagoMovilCedulaRif : null);
            }

            const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
            await pool.query(
                `INSERT INTO cuentas_bancarias (${insertCols.join(', ')}) VALUES (${placeholders})`,
                insertVals
            );
            res.json({ status: 'success', message: 'Cuenta agregada' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/bancos/:id', verifyToken, async (req: Request<BancosParams, unknown, CreateBancoBody>, res: Response, _next: NextFunction) => {
        const {
            numero_cuenta,
            nombre_banco,
            apodo,
            tipo,
            nombre_titular,
            cedula_rif,
            telefono,
            acepta_transferencia,
            acepta_pago_movil,
            pago_movil_telefono,
            pago_movil_cedula_rif,
        } = req.body;
        try {
            const user = asAuthUser(req.user);
            const cuentaId = asPositiveInt(req.params.id, 'id');
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (!c.rows.length) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            }
            const condoId = c.rows[0].id;

            const numeroCuentaSafe = asOptionalStringOrNull(numero_cuenta);
            const nombreBancoSafe = asOptionalStringOrNull(nombre_banco);
            const apodoSafe = asOptionalStringOrNull(apodo);
            const tipoSafe = asOptionalStringOrNull(tipo);
            const nombreTitularSafe = asOptionalStringOrNull(nombre_titular);
            const cedulaRifSafe = asOptionalStringOrNull(cedula_rif);
            const telefonoSafe = asOptionalStringOrNull(telefono);
            const aceptaTransferenciaSafe = asOptionalBoolean(acepta_transferencia);
            const aceptaPagoMovilSafe = asOptionalBoolean(acepta_pago_movil);
            const pagoMovilTelefonoSafe = asOptionalStringOrNull(pago_movil_telefono);
            const pagoMovilCedulaRifSafe = asOptionalStringOrNull(pago_movil_cedula_rif);

            const cuentaCols = await pool.query<IColumnNameRow>(
                `SELECT column_name
                 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'cuentas_bancarias'`
            );
            const hasCuentaCol = (name: string): boolean => cuentaCols.rows.some((r) => r.column_name === name);

            const tipoNormalized = String(tipoSafe || '').trim();
            const isLegacyTransfer = tipoNormalized === 'Transferencia';
            const isLegacyPagoMovil = tipoNormalized === 'Pago Movil';
            const canales = {
                aceptaTransferencia: aceptaTransferenciaSafe ?? (isLegacyTransfer ? true : (isLegacyPagoMovil ? false : false)),
                aceptaPagoMovil: aceptaPagoMovilSafe ?? isLegacyPagoMovil,
                pagoMovilTelefono: (pagoMovilTelefonoSafe || telefonoSafe || '').trim(),
                pagoMovilCedulaRif: (pagoMovilCedulaRifSafe || cedulaRifSafe || '').trim(),
            };

            const updateSets: string[] = [
                'numero_cuenta = $1',
                'nombre_banco = $2',
                'apodo = $3',
                'tipo = $4',
                'nombre_titular = $5',
                'cedula_rif = $6',
                'telefono = $7',
            ];
            const updateVals: unknown[] = [
                numeroCuentaSafe || '',
                nombreBancoSafe || '',
                apodoSafe || '',
                tipoSafe || '',
                nombreTitularSafe || '',
                cedulaRifSafe || '',
                telefonoSafe || '',
            ];

            if (hasCuentaCol('acepta_transferencia')) {
                updateSets.push(`acepta_transferencia = $${updateVals.length + 1}`);
                updateVals.push(canales.aceptaTransferencia);
            }
            if (hasCuentaCol('acepta_pago_movil')) {
                updateSets.push(`acepta_pago_movil = $${updateVals.length + 1}`);
                updateVals.push(canales.aceptaPagoMovil);
            }
            if (hasCuentaCol('pago_movil_telefono')) {
                updateSets.push(`pago_movil_telefono = $${updateVals.length + 1}`);
                updateVals.push(canales.aceptaPagoMovil ? canales.pagoMovilTelefono : null);
            }
            if (hasCuentaCol('pago_movil_cedula_rif')) {
                updateSets.push(`pago_movil_cedula_rif = $${updateVals.length + 1}`);
                updateVals.push(canales.aceptaPagoMovil ? canales.pagoMovilCedulaRif : null);
            }

            updateVals.push(cuentaId, condoId);
            const result = await pool.query(
                `UPDATE cuentas_bancarias
                 SET ${updateSets.join(', ')}
                 WHERE id = $${updateVals.length - 1} AND condominio_id = $${updateVals.length}
                 RETURNING id`,
                updateVals
            );
            if (!result.rows.length) {
                return res.status(404).json({ status: 'error', message: 'Cuenta bancaria no encontrada.' });
            }
            return res.json({ status: 'success', message: 'Cuenta actualizada.' });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ status: 'error', message: error.message });
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

    // ESTADO DE CUENTA BANCARIO (Libro Mayor unificado: ingresos y egresos)
    app.get('/bancos-admin/:id/estado-cuenta', verifyToken, async (req: Request<BancosParams>, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const cuentaId = parseInt(asString(req.params.id), 10);
            if (!Number.isFinite(cuentaId) || cuentaId <= 0) {
                return res.status(400).json({ error: 'ID de cuenta inválido.' });
            }

            const condoRes = await pool.query<ICondominioIdRow>(
                'SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1',
                [user.id]
            );
            if (condoRes.rows.length === 0) {
                return res.status(404).json({ error: 'Condominio no encontrado.' });
            }
            const condoId = condoRes.rows[0].id;

            const cuentaRes = await pool.query<ICuentaBancariaRow>(
                'SELECT id FROM cuentas_bancarias WHERE id = $1 AND condominio_id = $2 LIMIT 1',
                [cuentaId, condoId]
            );
            if (cuentaRes.rows.length === 0) {
                return res.status(404).json({ error: 'Cuenta bancaria no encontrada.' });
            }

            const colsRes = await pool.query<ITableColumnRow>(`
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND (
                    (table_name = 'gastos_pagos_fondos' AND column_name IN ('id', 'cuenta_bancaria_id', 'referencia', 'monto_bs', 'tasa_cambio'))
                    OR
                    (table_name = 'pagos_proveedores' AND column_name IN ('cuenta_bancaria_id'))
                    OR
                    (table_name = 'pagos' AND column_name IN ('banco_origen', 'cedula_origen', 'nota'))
                  )
            `);

            const hasCol = (table: string, column: string): boolean =>
                colsRes.rows.some((r) => r.table_name === table && r.column_name === column);

            const gpfIdExpr = hasCol('gastos_pagos_fondos', 'id') ? 'gpf.id::text' : "('GPF-' || gpf.gasto_id::text || '-' || to_char(gpf.fecha_pago, 'YYYYMMDD') || '-' || COALESCE(gpf.fondo_id::text, 'EXTRA'))";
            const gpfCuentaFilter = hasCol('gastos_pagos_fondos', 'cuenta_bancaria_id')
                ? ' OR (gpf.fondo_id IS NULL AND gpf.cuenta_bancaria_id = $1)'
                : '';
            const gpfReferenciaExpr = hasCol('gastos_pagos_fondos', 'referencia')
                ? 'COALESCE(gpf.referencia, pp_match.referencia)'
                : 'pp_match.referencia';
            const hasGpfTasaCambio = hasCol('gastos_pagos_fondos', 'tasa_cambio');
            const gpfOrderExpr = hasCol('gastos_pagos_fondos', 'id')
                ? 'gpf.id ASC'
                : 'gpf.fondo_id NULLS LAST, gpf.monto_pagado_usd ASC';
            const gpfMontoBsExpr = hasCol('gastos_pagos_fondos', 'monto_bs')
                ? 'gpf.monto_bs'
                : (hasGpfTasaCambio
                    ? 'CASE WHEN gpf.tasa_cambio IS NOT NULL AND gpf.tasa_cambio > 0 THEN (gpf.monto_pagado_usd * gpf.tasa_cambio) ELSE NULL END'
                    : `
                        CASE
                            WHEN pp_match.monto_bs IS NOT NULL AND pp_match.monto_bs > 0
                                 AND pp_match.monto_usd IS NOT NULL AND pp_match.monto_usd > 0
                                THEN (pp_match.monto_bs * (gpf.monto_pagado_usd / NULLIF(pp_match.monto_usd, 0)))
                            WHEN pp_match.tasa_cambio IS NOT NULL AND pp_match.tasa_cambio > 0
                                THEN (gpf.monto_pagado_usd * pp_match.tasa_cambio)
                            ELSE NULL
                        END
                    `);
            const gpfTasaExpr = hasGpfTasaCambio
                ? 'gpf.tasa_cambio'
                : 'pp_match.tasa_cambio';

            const ppCuentaFilter = hasCol('pagos_proveedores', 'cuenta_bancaria_id')
                ? ' OR (pp.fondo_id IS NULL AND pp.cuenta_bancaria_id = $1)'
                : '';
            const pagoNotaExpr = hasCol('pagos', 'nota')
                ? "COALESCE(p.nota, '')"
                : "''";
            const pagoBancoDesdeNotaExpr = `NULLIF(BTRIM(COALESCE((regexp_match(${pagoNotaExpr}, '(?i)Banco origen:\\s*([^|]+)'))[1], '')), '')`;
            const pagoCedulaDesdeNotaExpr = `NULLIF(BTRIM(COALESCE((regexp_match(${pagoNotaExpr}, '(?i)Cedula origen:\\s*([^|]+)'))[1], '')), '')`;
            const pagoBancoOrigenExpr = hasCol('pagos', 'banco_origen')
                ? `COALESCE(NULLIF(BTRIM(p.banco_origen), ''), ${pagoBancoDesdeNotaExpr})`
                : pagoBancoDesdeNotaExpr;
            const pagoCedulaOrigenExpr = hasCol('pagos', 'cedula_origen')
                ? `COALESCE(NULLIF(BTRIM(p.cedula_origen), ''), ${pagoCedulaDesdeNotaExpr})`
                : pagoCedulaDesdeNotaExpr;

            const query = `
                WITH pp_gasto_rank AS (
                    SELECT
                        pp.id,
                        pp.gasto_id,
                        pp.fecha_pago::date AS fecha_pago,
                        pp.referencia,
                        pp.monto_bs,
                        pp.monto_usd,
                        pp.tasa_cambio,
                        ROW_NUMBER() OVER (
                            PARTITION BY pp.gasto_id, pp.fecha_pago::date
                            ORDER BY pp.id ASC
                        ) AS rn_pp
                    FROM pagos_proveedores pp
                ),
                ingresos_fondos AS (
                    SELECT
                        ('ING-MF-' || mf.id::text) AS id,
                        COALESCE(p.fecha_pago::date, mf.fecha::date) AS fecha,
                        COALESCE(
                            p.referencia,
                            NULLIF(BTRIM(COALESCE((regexp_match(COALESCE(mf.nota, ''), '\\(([^)]*)\\)'))[1], '')), '')
                        ) AS referencia,
                        CASE
                            WHEN p.id IS NOT NULL
                                THEN ('Pago de Recibo #' || p.id::text || ' - Inmueble: ' || COALESCE(pr.identificador, 'N/A') || ' - Fondo: ' || COALESCE(f.nombre, 'N/A'))
                            ELSE ('Ingreso distribuido en fondo: ' || COALESCE(f.nombre, 'N/A'))
                        END AS concepto,
                        'INGRESO'::text AS tipo,
                        CASE
                            WHEN UPPER(COALESCE(f.moneda, '')) = 'BS' THEN mf.monto
                            WHEN UPPER(COALESCE(f.moneda, '')) = 'USD' AND COALESCE(p.tasa_cambio, mf.tasa_cambio) IS NOT NULL AND COALESCE(p.tasa_cambio, mf.tasa_cambio) > 0
                                THEN (mf.monto * COALESCE(p.tasa_cambio, mf.tasa_cambio))
                            ELSE NULL
                        END AS monto_bs,
                        COALESCE(p.tasa_cambio, mf.tasa_cambio) AS tasa_cambio,
                        CASE
                            WHEN UPPER(COALESCE(f.moneda, '')) = 'USD' THEN mf.monto
                            WHEN UPPER(COALESCE(f.moneda, '')) = 'BS' AND COALESCE(p.tasa_cambio, mf.tasa_cambio) IS NOT NULL AND COALESCE(p.tasa_cambio, mf.tasa_cambio) > 0
                                THEN (mf.monto / COALESCE(p.tasa_cambio, mf.tasa_cambio))
                            ELSE NULL
                        END AS monto_usd,
                        p.monto_origen AS monto_origen_pago,
                        ${pagoBancoOrigenExpr} AS banco_origen,
                        ${pagoCedulaOrigenExpr} AS cedula_origen,
                        f.id::int AS fondo_id,
                        NULL::int AS fondo_origen_id,
                        NULL::int AS fondo_destino_id,
                        f.nombre::text AS fondo_nombre
                    FROM movimientos_fondos mf
                    JOIN fondos f ON f.id = mf.fondo_id
                    LEFT JOIN pagos p ON p.id = COALESCE(
                        mf.referencia_id,
                        NULLIF((regexp_match(COALESCE(mf.nota, ''), '(?i)pago\\s*#\\s*([0-9]+)'))[1], '')::int
                    )
                    LEFT JOIN propiedades pr ON pr.id = p.propiedad_id
                    WHERE f.cuenta_bancaria_id = $1
                      AND (
                        mf.tipo IN ('INGRESO', 'INGRESO_PAGO', 'ABONO')
                        OR (mf.tipo = 'AJUSTE_INICIAL' AND COALESCE(mf.nota, '') ILIKE 'Abono distribuible de pago%')
                      )
                ),
                ingresos_distribuidos_por_pago AS (
                    SELECT
                        p.id AS pago_id,
                        ROUND(
                            COALESCE(
                                SUM(
                                    CASE
                                        WHEN UPPER(COALESCE(f.moneda, '')) = 'USD' THEN mf.monto
                                        WHEN UPPER(COALESCE(f.moneda, '')) = 'BS' AND COALESCE(p.tasa_cambio, mf.tasa_cambio) IS NOT NULL AND COALESCE(p.tasa_cambio, mf.tasa_cambio) > 0
                                            THEN (mf.monto / COALESCE(p.tasa_cambio, mf.tasa_cambio))
                                        ELSE 0
                                    END
                                ),
                                0
                            )::numeric,
                            2
                        ) AS monto_distribuido_usd
                    FROM pagos p
                    LEFT JOIN movimientos_fondos mf ON p.id = COALESCE(
                        mf.referencia_id,
                        NULLIF((regexp_match(COALESCE(mf.nota, ''), '(?i)pago\\s*#\\s*([0-9]+)'))[1], '')::int
                    )
                    LEFT JOIN fondos f ON f.id = mf.fondo_id AND f.cuenta_bancaria_id = $1
                    WHERE p.cuenta_bancaria_id = $1
                      AND p.estado = 'Validado'
                      AND (
                        mf.id IS NULL
                        OR mf.tipo IN ('INGRESO', 'INGRESO_PAGO', 'ABONO')
                        OR (mf.tipo = 'AJUSTE_INICIAL' AND COALESCE(mf.nota, '') ILIKE 'Abono distribuible de pago%')
                      )
                    GROUP BY p.id
                ),
                ingresos_transito AS (
                    SELECT
                        ('ING-' || p.id::text) AS id,
                        p.fecha_pago::date AS fecha,
                        p.referencia,
                        ('Pago de Recibo #' || p.id::text || ' - Inmueble: ' || COALESCE(pr.identificador, 'N/A')) AS concepto,
                        'INGRESO'::text AS tipo,
                        CASE
                            WHEN UPPER(COALESCE(p.moneda, '')) = 'BS'
                                THEN (GREATEST(0, ROUND((p.monto_usd - COALESCE(idp.monto_distribuido_usd, 0))::numeric, 2)) * COALESCE(NULLIF(p.tasa_cambio, 0), 1))
                            WHEN UPPER(COALESCE(p.moneda, '')) = 'USD' AND p.tasa_cambio IS NOT NULL AND p.tasa_cambio > 0
                                THEN (GREATEST(0, ROUND((p.monto_usd - COALESCE(idp.monto_distribuido_usd, 0))::numeric, 2)) * p.tasa_cambio)
                            ELSE NULL
                        END AS monto_bs,
                        p.tasa_cambio,
                        GREATEST(0, ROUND((p.monto_usd - COALESCE(idp.monto_distribuido_usd, 0))::numeric, 2)) AS monto_usd,
                        p.monto_origen AS monto_origen_pago,
                        ${pagoBancoOrigenExpr} AS banco_origen,
                        ${pagoCedulaOrigenExpr} AS cedula_origen,
                        NULL::int AS fondo_id,
                        NULL::int AS fondo_origen_id,
                        NULL::int AS fondo_destino_id,
                        NULL::text AS fondo_nombre
                    FROM pagos p
                    LEFT JOIN propiedades pr ON pr.id = p.propiedad_id
                    LEFT JOIN ingresos_distribuidos_por_pago idp ON idp.pago_id = p.id
                    WHERE p.cuenta_bancaria_id = $1
                      AND p.estado = 'Validado'
                      AND GREATEST(0, ROUND((p.monto_usd - COALESCE(idp.monto_distribuido_usd, 0))::numeric, 2)) > 0
                ),
                egresos_gpf AS (
                    SELECT
                        ('EGR-' || ${gpfIdExpr}) AS id,
                        gpf.fecha_pago::date AS fecha,
                        ${gpfReferenciaExpr} AS referencia,
                        ('Pago a Proveedor - Gasto: ' || COALESCE(g.concepto, prov.nombre, 'Sin concepto')) AS concepto,
                        'EGRESO'::text AS tipo,
                        ${gpfMontoBsExpr} AS monto_bs,
                        ${gpfTasaExpr} AS tasa_cambio,
                        gpf.monto_pagado_usd AS monto_usd,
                        NULL::numeric AS monto_origen_pago,
                        NULL::text AS banco_origen,
                        NULL::text AS cedula_origen,
                        gpf.fondo_id::int AS fondo_id,
                        NULL::int AS fondo_origen_id,
                        NULL::int AS fondo_destino_id,
                        f.nombre::text AS fondo_nombre
                    FROM (
                        SELECT
                            gpf.*,
                            ROW_NUMBER() OVER (
                                PARTITION BY gpf.gasto_id, gpf.fecha_pago::date
                                ORDER BY ${gpfOrderExpr}
                            ) AS rn_gpf
                        FROM gastos_pagos_fondos gpf
                    ) gpf
                    JOIN gastos g ON g.id = gpf.gasto_id
                    LEFT JOIN proveedores prov ON prov.id = g.proveedor_id
                    LEFT JOIN fondos f ON f.id = gpf.fondo_id
                    LEFT JOIN pp_gasto_rank pp_match
                        ON pp_match.gasto_id = gpf.gasto_id
                       AND pp_match.fecha_pago = gpf.fecha_pago::date
                       AND pp_match.rn_pp = gpf.rn_gpf
                    WHERE (f.cuenta_bancaria_id = $1${gpfCuentaFilter})
                ),
                egresos_pp AS (
                    SELECT
                        ('EGR-PP-' || pp.id::text) AS id,
                        pp.fecha_pago::date AS fecha,
                        pp.referencia,
                        ('Pago a Proveedor - Gasto: ' || COALESCE(g.concepto, prov.nombre, 'Sin concepto')) AS concepto,
                        'EGRESO'::text AS tipo,
                        pp.monto_bs,
                        pp.tasa_cambio,
                        pp.monto_usd,
                        NULL::numeric AS monto_origen_pago,
                        NULL::text AS banco_origen,
                        NULL::text AS cedula_origen,
                        pp.fondo_id::int AS fondo_id,
                        NULL::int AS fondo_origen_id,
                        NULL::int AS fondo_destino_id,
                        f.nombre::text AS fondo_nombre
                    FROM pagos_proveedores pp
                    JOIN gastos g ON g.id = pp.gasto_id
                    LEFT JOIN proveedores prov ON prov.id = g.proveedor_id
                    LEFT JOIN fondos f ON f.id = pp.fondo_id
                    WHERE (f.cuenta_bancaria_id = $1${ppCuentaFilter})
                      AND NOT EXISTS (
                        SELECT 1
                        FROM gastos_pagos_fondos gpf2
                        WHERE gpf2.gasto_id = pp.gasto_id
                          AND gpf2.fecha_pago = pp.fecha_pago
                      )
                ),
                transferencias_cuentas AS (
                    SELECT
                        ('TRF-' || t.id::text || '-' ||
                            CASE
                                WHEN f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id <> $1 THEN 'IN'
                                WHEN f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id <> $1 THEN 'OUT'
                                ELSE 'NA'
                            END
                        ) AS id,
                        t.fecha::date AS fecha,
                        t.referencia,
                        CASE
                            WHEN f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id <> $1
                                THEN ('Transferencia recibida desde ' || COALESCE(cb_orig.nombre_banco, 'Cuenta origen') || ' - Fondo: ' || COALESCE(f_orig.nombre, 'N/A'))
                            WHEN f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id <> $1
                                THEN ('Transferencia enviada a ' || COALESCE(cb_dest.nombre_banco, 'Cuenta destino') || ' - Fondo: ' || COALESCE(f_dest.nombre, 'N/A'))
                            ELSE 'Transferencia interna'
                        END AS concepto,
                        CASE
                            WHEN f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id <> $1 THEN 'INGRESO'
                            WHEN f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id <> $1 THEN 'EGRESO'
                            ELSE 'INGRESO'
                        END::text AS tipo,
                        CASE
                            WHEN f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id <> $1 THEN
                                CASE
                                    WHEN UPPER(COALESCE(f_dest.moneda, '')) = 'BS' THEN t.monto_destino
                                    WHEN UPPER(COALESCE(f_dest.moneda, '')) = 'USD' AND t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_destino * t.tasa_cambio)
                                    ELSE NULL
                                END
                            WHEN f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id <> $1 THEN
                                CASE
                                    WHEN UPPER(COALESCE(f_orig.moneda, '')) = 'BS' THEN t.monto_origen
                                    WHEN UPPER(COALESCE(f_orig.moneda, '')) = 'USD' AND t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_origen * t.tasa_cambio)
                                    ELSE NULL
                                END
                            ELSE NULL
                        END AS monto_bs,
                        t.tasa_cambio,
                        CASE
                            WHEN f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id <> $1 THEN
                                CASE
                                    WHEN UPPER(COALESCE(f_dest.moneda, '')) = 'USD' THEN t.monto_destino
                                    WHEN UPPER(COALESCE(f_dest.moneda, '')) = 'BS' AND t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_destino / t.tasa_cambio)
                                    ELSE NULL
                                END
                            WHEN f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id <> $1 THEN
                                CASE
                                    WHEN UPPER(COALESCE(f_orig.moneda, '')) = 'USD' THEN t.monto_origen
                                    WHEN UPPER(COALESCE(f_orig.moneda, '')) = 'BS' AND t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_origen / t.tasa_cambio)
                                    ELSE NULL
                                END
                            ELSE NULL
                        END AS monto_usd,
                        NULL::numeric AS monto_origen_pago,
                        NULL::text AS banco_origen,
                        NULL::text AS cedula_origen,
                        NULL::int AS fondo_id,
                        t.fondo_origen_id::int AS fondo_origen_id,
                        t.fondo_destino_id::int AS fondo_destino_id,
                        CASE
                            WHEN f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id <> $1 THEN f_dest.nombre::text
                            WHEN f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id <> $1 THEN f_orig.nombre::text
                            ELSE NULL::text
                        END AS fondo_nombre
                    FROM transferencias t
                    JOIN fondos f_orig ON f_orig.id = t.fondo_origen_id
                    JOIN fondos f_dest ON f_dest.id = t.fondo_destino_id
                    LEFT JOIN cuentas_bancarias cb_orig ON cb_orig.id = f_orig.cuenta_bancaria_id
                    LEFT JOIN cuentas_bancarias cb_dest ON cb_dest.id = f_dest.cuenta_bancaria_id
                    WHERE (
                        (f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id <> $1)
                        OR
                        (f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id <> $1)
                    )
                )
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre
                FROM ingresos_fondos
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre
                FROM ingresos_transito
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre
                FROM egresos_gpf
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre
                FROM egresos_pp
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre
                FROM transferencias_cuentas
                ORDER BY fecha DESC, id DESC
            `;

            const movimientos = await pool.query<IMovimientoRow>(query, [cuentaId]);
            res.json({ status: 'success', movimientos: movimientos.rows });
        } catch (error: unknown) {
            const typedError = asError(error);
            console.error('Error en estado de cuenta:', error);
            res.status(500).json({ error: typedError.message });
        }
    });

    // ðŸ”„ REGISTRAR TRANSFERENCIA ENTRE FONDOS/CUENTAS
    app.post('/transferencias', verifyToken, async (req: Request<{}, unknown, TransferenciaBody>, res: Response, _next: NextFunction) => {
        const { fondo_origen_id, fondo_destino_id, cuenta_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota } = req.body;

        try {
            const user = asAuthUser(req.user);
            const fondoOrigenIdSafe = asPositiveInt(fondo_origen_id, 'fondo_origen_id');
            const montoOrigenSafe = asDecimal(monto_origen, 'monto_origen');
            const montoDestinoSafe = asDecimal(monto_destino, 'monto_destino');
            const tasaCambioSafe = (tasa_cambio === null || tasa_cambio === undefined || String(tasa_cambio).trim() === '')
                ? null
                : asDecimal(tasa_cambio, 'tasa_cambio');
            const referenciaSafe = asOptionalStringOrNull(referencia);
            const notaSafe = asOptionalStringOrNull(nota);
            const fechaSafe = toIsoDate(fecha, 'fecha');
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = condoRes.rows[0].id;
            const hasCuentaDestino = cuenta_destino_id !== undefined && cuenta_destino_id !== null && String(cuenta_destino_id).trim() !== '';
            const hasFondoDestino = fondo_destino_id !== undefined && fondo_destino_id !== null && String(fondo_destino_id).trim() !== '';

            await pool.query('BEGIN');

            const origenRes = await pool.query<IFondoTransferRow>(
                'SELECT id, cuenta_bancaria_id, condominio_id, moneda, porcentaje_asignacion, es_operativo FROM fondos WHERE id = $1 AND condominio_id = $2 AND activo = true LIMIT 1',
                [fondoOrigenIdSafe, condoId]
            );
            if (origenRes.rows.length === 0) {
                throw new Error('Fondo de origen no encontrado o no pertenece al condominio.');
            }
            const fondoOrigen = origenRes.rows[0];

            const sourceBalanceRes = await pool.query<{ saldo_actual: number | string }>(
                'SELECT saldo_actual FROM fondos WHERE id = $1 AND condominio_id = $2 LIMIT 1',
                [fondoOrigenIdSafe, condoId]
            );
            const saldoOrigen = parseFloat(String(sourceBalanceRes.rows[0]?.saldo_actual ?? 0)) || 0;
            if (montoOrigenSafe <= 0 || montoDestinoSafe <= 0) {
                throw new Error('El monto de transferencia debe ser mayor a 0.');
            }
            if (saldoOrigen < montoOrigenSafe) {
                throw new Error('El fondo de origen no tiene saldo suficiente.');
            }
            if (!hasCuentaDestino && !hasFondoDestino) {
                throw new Error('Debe seleccionar un fondo destino o una cuenta destino.');
            }
            if (hasCuentaDestino && hasFondoDestino) {
                throw new Error('Seleccione solo un tipo de destino: fondo o cuenta.');
            }

            await pool.query('UPDATE fondos SET saldo_actual = saldo_actual - $1 WHERE id = $2', [montoOrigenSafe, fondoOrigenIdSafe]);

            if (hasCuentaDestino) {
                const cuentaDestinoIdSafe = asPositiveInt(cuenta_destino_id, 'cuenta_destino_id');
                const destinoFundsRes = await pool.query<IFondoTransferRow>(
                    `SELECT id, cuenta_bancaria_id, condominio_id, moneda, porcentaje_asignacion, es_operativo
                     FROM fondos
                     WHERE cuenta_bancaria_id = $1
                       AND condominio_id = $2
                       AND activo = true
                       AND moneda = $3
                     ORDER BY es_operativo DESC, id ASC`,
                    [cuentaDestinoIdSafe, condoId, fondoOrigen.moneda]
                );
                const destinoFunds = destinoFundsRes.rows.filter((f) => f.id !== fondoOrigenIdSafe);
                if (destinoFunds.length === 0) {
                    throw new Error(`La cuenta destino no tiene fondos activos en moneda ${fondoOrigen.moneda}.`);
                }

                const noOperativos = destinoFunds.filter((f) => !f.es_operativo);
                const fondoPrincipal = destinoFunds.find((f) => !!f.es_operativo) || destinoFunds[0];

                const distribuciones = noOperativos.map((f) => {
                    const pct = parseFloat(String(f.porcentaje_asignacion || 0)) || 0;
                    const amount = parseFloat(((montoDestinoSafe * pct) / 100).toFixed(2));
                    return { fondoId: f.id, monto: amount };
                });
                const usado = parseFloat(distribuciones.reduce((a, d) => a + d.monto, 0).toFixed(2));
                const resto = parseFloat((montoDestinoSafe - usado).toFixed(2));
                if (resto !== 0) {
                    const idx = distribuciones.findIndex((d) => d.fondoId === fondoPrincipal.id);
                    if (idx >= 0) {
                        distribuciones[idx].monto = parseFloat((distribuciones[idx].monto + resto).toFixed(2));
                    } else {
                        distribuciones.push({ fondoId: fondoPrincipal.id, monto: resto });
                    }
                }

                for (const dist of distribuciones) {
                    if (dist.monto <= 0) continue;
                    await pool.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [dist.monto, dist.fondoId]);
                    await pool.query(
                        `INSERT INTO transferencias (condominio_id, fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                        [
                            condoId,
                            fondoOrigenIdSafe,
                            dist.fondoId,
                            montoOrigenSafe,
                            tasaCambioSafe,
                            dist.monto,
                            referenciaSafe,
                            fechaSafe,
                            `${notaSafe || ''}${notaSafe ? ' | ' : ''}Distribución automática por cuenta destino`,
                        ]
                    );
                }
            } else {
                const fondoDestinoIdSafe = asPositiveInt(fondo_destino_id, 'fondo_destino_id');
                await pool.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [montoDestinoSafe, fondoDestinoIdSafe]);
                await pool.query(
                    `INSERT INTO transferencias (condominio_id, fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [condoId, fondoOrigenIdSafe, fondoDestinoIdSafe, montoOrigenSafe, tasaCambioSafe, montoDestinoSafe, referenciaSafe, fechaSafe, notaSafe]
                );
            }

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

