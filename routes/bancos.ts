import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
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
    moneda?: string | null;
    swift?: string | null;
    aba?: string | null;
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
    pago_id?: number | null;
    inmueble?: string | null;
    created_at?: string | Date | null;
}

interface IExtraInfoRow {
    pago_id: number;
    fecha: string | Date;
    referencia: string | null;
    inmueble: string | null;
    concepto: string;
    monto_bs: number | null;
    monto_usd: number;
    fondo_destino: string | null;
    nota?: string | null;
    tasa_cambio?: number | null;
}

interface IGastoHistoricoExtraRow {
    id: number;
    concepto: string;
    nota: string | null;
    referencia: string | null;
    tasa_cambio: number | null;
    fecha_gasto: string | Date | null;
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
    moneda?: string | null;
    swift?: string | null;
    aba?: string | null;
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

interface ManualEgresoBody {
    cuenta_id: unknown;
    fondo_id: unknown;
    monto_origen: unknown;
    tasa_cambio?: unknown;
    tipo_movimiento?: unknown;
    referencia: string | null;
    concepto: string | null;
    fecha: string | Date;
}

interface IFondoTransferRow {
    id: number;
    cuenta_bancaria_id: number;
    condominio_id: number;
    moneda: string;
    porcentaje_asignacion: number | string;
    es_operativo: boolean;
}

interface IFondoFechaSaldoRow {
    id: number;
    fecha_saldo: string | null;
}

interface IAjusteRollbackMovimientoRow {
    id: number;
    fondo_id: number;
    tipo: string | null;
    monto: string | number;
    nota: string | null;
    fecha: string | Date;
    condominio_id: number;
    saldo_fondo: string | number;
}

interface IAjusteHistorialRollbackRow {
    id: number;
    propiedad_id: number;
    tipo: string | null;
    monto: string | number;
}

interface ITransferenciaRollbackRow {
    id: number;
    condominio_id: number;
    fondo_origen_id: number;
    fondo_destino_id: number;
    monto_origen: string | number;
    monto_destino: string | number;
    saldo_origen: string | number;
    saldo_destino: string | number;
}

interface IEgresoManualRollbackRow {
    id: number;
    condominio_id: number;
    fondo_id: number;
    tipo: string | null;
    nota: string | null;
    monto: string | number;
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

const inferAccountCurrency = (tipo: unknown): 'USD' | 'BS' => {
    const raw = String(tipo || '').trim().toUpperCase();
    if (!raw) return 'BS';
    if (raw.includes('ZELLE') || raw.includes('USD')) return 'USD';
    return 'BS';
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

const formatYmdToDmy = (ymd: string): string => {
    const [y, m, d] = String(ymd || '').split('-');
    if (!y || !m || !d) return ymd;
    return `${d}/${m}/${y}`;
};

const toEpochDay = (ymd: string): number => {
    const [y, m, d] = String(ymd || '').split('-').map((v) => parseInt(v, 10));
    if (!y || !m || !d) return NaN;
    return Date.UTC(y, m - 1, d);
};

const registerBancosRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    const ensureNotJuntaGeneralForInmuebleAjustes = async (adminUserId: number, res: Response): Promise<boolean> => {
        const condo = await getCondominioByAdminUserId(pool, adminUserId);
        if (!condo) {
            res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            return false;
        }
        if (isJuntaGeneralTipo(condo.tipo)) {
            res.status(403).json({
                status: 'error',
                message: 'La Junta General no puede revertir ajustes de saldo por inmueble.',
            });
            return false;
        }
        return true;
    };
    const getMovimientoFondoTiposPermitidos = async (): Promise<string[]> => {
        try {
            const r = await pool.query<{ def: string }>(
                `
                SELECT pg_get_constraintdef(oid) AS def
                FROM pg_constraint c
                INNER JOIN pg_class t ON t.oid = c.conrelid
                WHERE c.contype = 'c'
                  AND t.relname = 'movimientos_fondos'
                `
            );
            const defs = r.rows.map((row) => String(row.def || ''));
            const tipoDef = defs.find((def) => /tipo/i.test(def)) || defs[0] || '';
            const matches = Array.from(tipoDef.matchAll(/'([^']+)'/g)).map((m) => String(m[1] || '').trim()).filter(Boolean);
            if (matches.length > 0) return Array.from(new Set(matches));
        } catch {
            // noop, fallback below
        }
        return [];
    };

    const resolveMovimientoFondoTipo = async (preferred: string[], fallback: string): Promise<string> => {
        const allowed = await getMovimientoFondoTiposPermitidos();
        for (const t of preferred) {
            const selected = allowed.find((m) => m.toUpperCase() === t.toUpperCase());
            if (selected) return selected;
        }
        if (allowed.length > 0) return allowed[0] || fallback;
        return fallback;
    };

    const validarFechaVsAperturaFondo = async (fondoId: number, fechaMovimiento: string): Promise<void> => {
        let r: { rows: IFondoFechaSaldoRow[] };
        try {
            r = await pool.query<IFondoFechaSaldoRow>(
                'SELECT id, fecha_saldo::text AS fecha_saldo FROM fondos WHERE id = $1 LIMIT 1',
                [fondoId]
            );
        } catch (err: unknown) {
            const message = asError(err).message;
            if (message.toLowerCase().includes('fecha_saldo')) return;
            throw err;
        }
        const fechaSaldo = r.rows[0]?.fecha_saldo || null;
        if (!fechaSaldo) return;
        const movDay = toEpochDay(fechaMovimiento);
        const saldoDay = toEpochDay(fechaSaldo);
        if (Number.isFinite(movDay) && Number.isFinite(saldoDay) && movDay < saldoDay) {
            throw new Error(`No está permitido este registro porque es previo a la fecha ${formatYmdToDmy(fechaSaldo)} registrada en la apertura del fondo.`);
        }
    };

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
            moneda,
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
            const monedaSafe = String(moneda || '').trim().toUpperCase() === 'USD' ? 'USD' : 'BS';
            const swiftSafe = String(req.body.swift || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) || null;
            const abaSafe = String(req.body.aba || '').replace(/\D/g, '').slice(0, 9) || null;
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

            if (hasCuentaCol('moneda')) {
                insertCols.push('moneda');
                insertVals.push(monedaSafe);
            }
            if (hasCuentaCol('swift')) {
                insertCols.push('swift');
                insertVals.push(swiftSafe);
            }
            if (hasCuentaCol('aba')) {
                insertCols.push('aba');
                insertVals.push(abaSafe);
            }
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
            moneda,
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
            const monedaSafe = String(moneda || '').trim().toUpperCase() === 'USD' ? 'USD' : 'BS';
            const swiftSafe = String(req.body.swift || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) || null;
            const abaSafe = String(req.body.aba || '').replace(/\D/g, '').slice(0, 9) || null;
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

            if (hasCuentaCol('moneda')) {
                updateSets.push(`moneda = $${updateVals.length + 1}`);
                updateVals.push(monedaSafe);
            }
            if (hasCuentaCol('swift')) {
                updateSets.push(`swift = $${updateVals.length + 1}`);
                updateVals.push(swiftSafe);
            }
            if (hasCuentaCol('aba')) {
                updateSets.push(`aba = $${updateVals.length + 1}`);
                updateVals.push(abaSafe);
            }
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

            const cuentaRes = await pool.query<{ id: number; tipo: string | null }>(
                `SELECT id, tipo
                 FROM cuentas_bancarias
                 WHERE id = $1 AND condominio_id = $2
                 LIMIT 1`,
                [cuentaId, condoId]
            );
            if (!cuentaRes.rows.length) {
                return res.status(404).json({ status: 'error', message: 'Cuenta bancaria no encontrada.' });
            }
            const cuentaMoneda = inferAccountCurrency(cuentaRes.rows[0].tipo);

            await pool.query('BEGIN');
            await pool.query(
                `UPDATE cuentas_bancarias
                 SET es_predeterminada = false
                 WHERE condominio_id = $1
                   AND (
                     CASE
                       WHEN UPPER(COALESCE(tipo, '')) LIKE '%USD%' OR UPPER(COALESCE(tipo, '')) LIKE '%ZELLE%' THEN 'USD'
                       ELSE 'BS'
                     END
                   ) = $2`,
                [condoId, cuentaMoneda]
            );
            await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = true WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
            await pool.query('COMMIT');

            res.json({ status: 'success', message: `Cuenta principal ${cuentaMoneda} actualizada con exito.` });
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
                    (table_name = 'gastos_pagos_fondos' AND column_name IN ('id', 'cuenta_bancaria_id', 'referencia', 'monto_bs', 'tasa_cambio', 'nota', 'pago_proveedor_id'))
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
            const gpfNotaExpr = hasCol('gastos_pagos_fondos', 'nota')
                ? 'COALESCE(NULLIF(BTRIM(gpf.nota), \'\'), pp_match.nota)'
                : 'pp_match.nota';
            const gpfPagoProveedorIdExpr = hasCol('gastos_pagos_fondos', 'pago_proveedor_id')
                ? 'COALESCE(gpf.pago_proveedor_id, pp_match.id)'
                : 'pp_match.id';
            const proveedorNombreExpr = "COALESCE(NULLIF(BTRIM(prov.nombre), ''), 'Sin proveedor')";
            const gpfConceptoPagoProveedorExpr = `CASE
                            WHEN NULLIF(BTRIM(${gpfNotaExpr}), '') IS NOT NULL
                                THEN ('Pago a proveedor: ' || ${proveedorNombreExpr} || ' | Nota: ' || NULLIF(BTRIM(${gpfNotaExpr}), ''))
                            ELSE ('Pago a proveedor: ' || ${proveedorNombreExpr} || ' - Gasto: ' || COALESCE(NULLIF(BTRIM(g.concepto), ''), 'Sin concepto'))
                        END`;
            const ppConceptoPagoProveedorExpr = `CASE
                            WHEN NULLIF(BTRIM(pp.nota), '') IS NOT NULL
                                THEN ('Pago a proveedor: ' || ${proveedorNombreExpr} || ' | Nota: ' || NULLIF(BTRIM(pp.nota), ''))
                            ELSE ('Pago a proveedor: ' || ${proveedorNombreExpr} || ' - Gasto: ' || COALESCE(NULLIF(BTRIM(g.concepto), ''), 'Sin concepto'))
                        END`;

            const ppCuentaFilter = hasCol('pagos_proveedores', 'cuenta_bancaria_id')
                ? ' OR (pp.fondo_id IS NULL AND pp.cuenta_bancaria_id = $1)'
                : '';
            const pagoNotaExpr = hasCol('pagos', 'nota')
                ? "COALESCE(p.nota, '')"
                : "''";
            const pagoBancoDesdeNotaExpr = `NULLIF(BTRIM(COALESCE((regexp_match(${pagoNotaExpr}, '(?i)Banco origen:\\s*([^|]+)'))[1], '')), '')`;
            const pagoCedulaDesdeNotaExpr = `NULLIF(BTRIM(COALESCE((regexp_match(${pagoNotaExpr}, '(?i)Cedula origen:\\s*([^|]+)'))[1], '')), '')`;
            const ajusteNotaExpr = "COALESCE(mf.nota, '')";
            const ajusteBancoDesdeNotaExpr = `NULLIF(BTRIM(COALESCE((regexp_match(${ajusteNotaExpr}, '(?i)Banco origen:\\s*([^|\\[]+)'))[1], '')), '')`;
            const ajusteReferenciaDesdeNotaExpr = `NULLIF(BTRIM(COALESCE((regexp_match(${ajusteNotaExpr}, '(?i)Ref(?:erencia)?(?:\\s+origen)?:\\s*([^|\\[]+)'))[1], '')), '')`;
            const pagoBancoOrigenExpr = hasCol('pagos', 'banco_origen')
                ? `COALESCE(NULLIF(BTRIM(p.banco_origen), ''), ${pagoBancoDesdeNotaExpr})`
                : pagoBancoDesdeNotaExpr;
            const pagoCedulaOrigenExpr = hasCol('pagos', 'cedula_origen')
                ? `COALESCE(NULLIF(BTRIM(p.cedula_origen), ''), ${pagoCedulaDesdeNotaExpr})`
                : pagoCedulaDesdeNotaExpr;
            const pagoReciboIdExpr = hasCol('pagos', 'recibo_id')
                ? 'p.recibo_id'
                : 'NULL::int';

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
                        pp.nota,
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
                        CASE
                            WHEN p.id IS NOT NULL THEN NULLIF(BTRIM(COALESCE(p.referencia, '')), '')
                            WHEN COALESCE(mf.nota, '') ILIKE 'Ingreso manual libro mayor%'
                                THEN NULLIF(BTRIM(COALESCE((regexp_match(COALESCE(mf.nota, ''), '(?i)Ref:\\s*([^|]+)'))[1], '')), '')
                            WHEN mf.tipo = 'AJUSTE_INICIAL'
                                 AND COALESCE(mf.nota, '') ILIKE 'Saldo de apertura del fondo%'
                                THEN 'APERTURA'
                            WHEN mf.tipo = 'AJUSTE_INICIAL'
                                 AND (
                                       COALESCE(mf.nota, '') ILIKE '%Ajuste desde Cuentas por Cobrar%'
                                       OR COALESCE(mf.nota, '') ILIKE 'Ajuste manual a favor%'
                                       OR hsi.id IS NOT NULL
                                   )
                                THEN COALESCE(
                                    ${ajusteReferenciaDesdeNotaExpr},
                                    CASE
                                        WHEN hsi.id IS NOT NULL THEN ('AJ-' || hsi.id::text)
                                        ELSE ('AJ-MF-' || mf.id::text)
                                    END,
                                    ('AJ-MF-' || mf.id::text)
                                )
                            ELSE NULLIF(BTRIM(COALESCE((regexp_match(COALESCE(mf.nota, ''), '\\(([^)]*)\\)'))[1], '')), '')
                        END AS referencia,
                        CASE
                            WHEN p.id IS NOT NULL
                                THEN (
                                    CASE
                                        WHEN ${pagoReciboIdExpr} IS NOT NULL
                                            THEN ('Pago de Recibo #' || ${pagoReciboIdExpr}::text || ' - Inmueble: ' || COALESCE(pr.identificador, 'N/A') || ' - Fondo: ' || COALESCE(f.nombre, 'N/A'))
                                        ELSE ('Pago Ref: ' || COALESCE(NULLIF(BTRIM(p.referencia), ''), p.id::text) || ' - Inmueble: ' || COALESCE(pr.identificador, 'N/A') || ' - Fondo: ' || COALESCE(f.nombre, 'N/A'))
                                    END
                                )
                            WHEN mf.tipo = 'AJUSTE_INICIAL'
                                 AND COALESCE(mf.nota, '') ILIKE 'Saldo de apertura del fondo%'
                                THEN ('Saldo de apertura del fondo - Fondo: ' || COALESCE(f.nombre, 'N/A'))
                            WHEN mf.tipo = 'AJUSTE_INICIAL'
                                 AND (
                                        COALESCE(mf.nota, '') ILIKE '%Ajuste desde Cuentas por Cobrar%'
                                        OR COALESCE(mf.nota, '') ILIKE 'Ajuste manual a favor%'
                                        OR hsi.id IS NOT NULL
                                   )
                                THEN COALESCE(
                                    NULLIF(
                                        BTRIM(
                                            regexp_replace(
                                                regexp_replace(
                                                    regexp_replace(
                                                        COALESCE(mf.nota, ''),
                                                        '(?i)[[:space:]]*\\|[[:space:]]*\\[bs_raw:[^]]+\\]',
                                                        '',
                                                        'g'
                                                    ),
                                                    '(?i)[[:space:]]*\\|[[:space:]]*\\[tasa_raw:[^]]+\\]',
                                                    '',
                                                    'g'
                                                ),
                                                '(?i)[[:space:]]*\\|[[:space:]]*ajuste_historial_id:[0-9]+',
                                                '',
                                                'g'
                                            )
                                        ),
                                        ''
                                    ),
                                    ('Ajuste en fondo: ' || COALESCE(f.nombre, 'N/A'))
                                )
                            WHEN COALESCE(mf.nota, '') ILIKE 'Ingreso manual libro mayor%'
                                THEN COALESCE(
                                    NULLIF(BTRIM(COALESCE((regexp_match(COALESCE(mf.nota, ''), '(?i)Concepto:\\s*([^|]+)'))[1], '')), ''),
                                    'Ingreso manual libro mayor'
                                )
                            WHEN COALESCE(mf.nota, '') ILIKE 'Ingreso alquiler%'
                                THEN COALESCE(NULLIF(BTRIM(mf.nota), ''), ('Ingreso por alquiler - Fondo: ' || COALESCE(f.nombre, 'N/A')))
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
                        COALESCE(${pagoBancoOrigenExpr}, ${ajusteBancoDesdeNotaExpr}) AS banco_origen,
                        ${pagoCedulaOrigenExpr} AS cedula_origen,
                        f.id::int AS fondo_id,
                        NULL::int AS fondo_origen_id,
                        NULL::int AS fondo_destino_id,
                        f.nombre::text AS fondo_nombre,
                        p.id::int AS pago_id,
                        COALESCE(
                            pr.identificador,
                            pr_aj.identificador,
                            NULLIF(BTRIM(COALESCE((regexp_match(COALESCE(mf.nota, ''), '(?i)Inmueble:\\s*([^|]+)'))[1], '')), '')
                        )::text AS inmueble,
                        COALESCE(p.created_at, mf.fecha) AS created_at
                    FROM movimientos_fondos mf
                    JOIN fondos f ON f.id = mf.fondo_id
                    LEFT JOIN pagos p ON p.id = COALESCE(
                        mf.referencia_id,
                        NULLIF((regexp_match(COALESCE(mf.nota, ''), '(?i)pago\\s*#\\s*([0-9]+)'))[1], '')::int
                    )
                    LEFT JOIN propiedades pr ON pr.id = p.propiedad_id
                    LEFT JOIN historial_saldos_inmuebles hsi ON hsi.id = NULLIF((regexp_match(COALESCE(mf.nota, ''), '(?i)ajuste_historial_id:\\s*([0-9]+)'))[1], '')::int
                    LEFT JOIN propiedades pr_aj ON pr_aj.id = hsi.propiedad_id
                    WHERE f.cuenta_bancaria_id = $1
                      AND (
                        mf.tipo IN ('INGRESO', 'INGRESO_PAGO', 'ABONO')
                        OR (
                            mf.tipo = 'AJUSTE_INICIAL'
                            AND (
                                COALESCE(mf.nota, '') ILIKE '%Ajuste desde Cuentas por Cobrar%'
                                OR COALESCE(mf.nota, '') ILIKE 'Ajuste manual a favor%'
                                OR hsi.id IS NOT NULL
                            )
                        )
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
                        ) AS monto_distribuido_usd,
                        ROUND(
                            COALESCE(
                                SUM(CASE WHEN UPPER(COALESCE(f.moneda, '')) = 'BS' THEN mf.monto ELSE 0 END),
                                0
                            )::numeric,
                            2
                        ) AS monto_distribuido_bs
                    FROM pagos p
                    LEFT JOIN movimientos_fondos mf ON p.id = COALESCE(
                        mf.referencia_id,
                        NULLIF((regexp_match(COALESCE(mf.nota, ''), '(?i)pago\\s*#\\s*([0-9]+)'))[1], '')::int
                    )
                    LEFT JOIN fondos f ON f.id = mf.fondo_id AND f.cuenta_bancaria_id = $1
                    WHERE p.cuenta_bancaria_id = $1
                      AND p.estado = 'Validado'
                      AND COALESCE(p.es_ajuste_historico, false) = false
                      AND (
                        mf.id IS NULL
                        OR mf.tipo IN ('INGRESO', 'INGRESO_PAGO', 'ABONO')
                        OR mf.tipo = 'AJUSTE_INICIAL'
                      )
                    GROUP BY p.id
                ),
                ingresos_transito AS (
                    SELECT
                        ('ING-' || p.id::text) AS id,
                        p.fecha_pago::date AS fecha,
                        p.referencia,
                        (
                            CASE
                                WHEN ${pagoReciboIdExpr} IS NOT NULL
                                    THEN ('Pago de Recibo #' || ${pagoReciboIdExpr}::text || ' - Inmueble: ' || COALESCE(pr.identificador, 'N/A'))
                                ELSE ('Pago Ref: ' || COALESCE(NULLIF(BTRIM(p.referencia), ''), p.id::text) || ' - Inmueble: ' || COALESCE(pr.identificador, 'N/A'))
                            END
                        ) AS concepto,
                        'INGRESO'::text AS tipo,
                        CASE
                            WHEN UPPER(COALESCE(p.moneda, '')) = 'BS'
                                THEN GREATEST(0, ROUND((COALESCE(p.monto_origen, 0) - COALESCE(idp.monto_distribuido_bs, 0))::numeric, 2))
                            WHEN UPPER(COALESCE(p.moneda, '')) = 'USD' AND p.tasa_cambio IS NOT NULL AND p.tasa_cambio > 0
                                THEN (GREATEST(0, ROUND((p.monto_usd - COALESCE(idp.monto_distribuido_usd, 0))::numeric, 2)) * p.tasa_cambio)
                            ELSE NULL
                        END AS monto_bs,
                        p.tasa_cambio,
                        CASE
                            WHEN UPPER(COALESCE(p.moneda, '')) = 'BS' AND COALESCE(NULLIF(p.tasa_cambio, 0), 0) > 0
                                THEN GREATEST(0, ROUND((COALESCE(p.monto_origen, 0) - COALESCE(idp.monto_distribuido_bs, 0))::numeric, 2)) / p.tasa_cambio
                            ELSE
                                GREATEST(0, ROUND((p.monto_usd - COALESCE(idp.monto_distribuido_usd, 0))::numeric, 2))
                        END AS monto_usd,
                        p.monto_origen AS monto_origen_pago,
                        ${pagoBancoOrigenExpr} AS banco_origen,
                        ${pagoCedulaOrigenExpr} AS cedula_origen,
                        NULL::int AS fondo_id,
                        NULL::int AS fondo_origen_id,
                        NULL::int AS fondo_destino_id,
                        NULL::text AS fondo_nombre,
                        p.id::int AS pago_id,
                        pr.identificador::text AS inmueble,
                        p.created_at AS created_at
                    FROM pagos p
                    LEFT JOIN propiedades pr ON pr.id = p.propiedad_id
                    LEFT JOIN ingresos_distribuidos_por_pago idp ON idp.pago_id = p.id
                    WHERE p.cuenta_bancaria_id = $1
                      AND p.estado = 'Validado'
                      AND COALESCE(p.es_ajuste_historico, false) = false
                      AND (
                          CASE
                              WHEN UPPER(COALESCE(p.moneda, '')) = 'BS'
                                  THEN GREATEST(0, ROUND((COALESCE(p.monto_origen, 0) - COALESCE(idp.monto_distribuido_bs, 0))::numeric, 2))
                              ELSE
                                  GREATEST(0, ROUND((p.monto_usd - COALESCE(idp.monto_distribuido_usd, 0))::numeric, 2))
                          END
                      ) > 0
                ),
                ingresos_extra_detalle AS (
                    SELECT
                        ('ING-EXTRA-' || p.id::text) AS id,
                        p.fecha_pago::date AS fecha,
                        p.referencia,
                        ('Ingreso por gastos Extra - Inmueble: ' || COALESCE(pr.identificador, 'N/A')) AS concepto,
                        'INGRESO'::text AS tipo,
                        CASE
                            WHEN extra_meta.extra_bs > 0 THEN ROUND(extra_meta.extra_bs::numeric, 2)
                            WHEN p.tasa_cambio IS NOT NULL AND p.tasa_cambio > 0 THEN (extra_meta.extra_usd * p.tasa_cambio)
                            ELSE NULL
                        END AS monto_bs,
                        p.tasa_cambio,
                        CASE
                            WHEN extra_meta.extra_usd > 0 THEN extra_meta.extra_usd
                            WHEN extra_meta.extra_bs > 0 AND p.tasa_cambio IS NOT NULL AND p.tasa_cambio > 0
                                THEN ROUND((extra_meta.extra_bs / p.tasa_cambio)::numeric, 6)
                            ELSE 0
                        END AS monto_usd,
                        p.monto_origen AS monto_origen_pago,
                        ${pagoBancoOrigenExpr} AS banco_origen,
                        ${pagoCedulaOrigenExpr} AS cedula_origen,
                        NULL::int AS fondo_id,
                        NULL::int AS fondo_origen_id,
                        NULL::int AS fondo_destino_id,
                        NULL::text AS fondo_nombre,
                        p.id::int AS pago_id,
                        pr.identificador::text AS inmueble,
                        p.created_at AS created_at
                    FROM pagos p
                    LEFT JOIN propiedades pr ON pr.id = p.propiedad_id
                    CROSS JOIN LATERAL (
                        SELECT COALESCE(
                            NULLIF(
                                (regexp_match(COALESCE(${pagoNotaExpr}, ''), '(?i)\\[extra_usd:([0-9]+(?:\\.[0-9]+)?)\\]'))[1],
                                ''
                            )::numeric,
                            0
                        ) AS extra_usd,
                        COALESCE(
                            (
                                SELECT SUM(NULLIF(BTRIM(split_part(item, '=', 2)), '')::numeric)
                                FROM unnest(
                                    string_to_array(
                                        COALESCE((regexp_match(COALESCE(${pagoNotaExpr}, ''), '(?i)\\[extra_items_bs:([^\\]]+)\\]'))[1], ''),
                                        ';'
                                    )
                                ) AS item
                                WHERE NULLIF(BTRIM(item), '') IS NOT NULL
                                  AND NULLIF(BTRIM(split_part(item, '=', 1)), '') ~ '^[0-9]+$'
                                  AND NULLIF(BTRIM(split_part(item, '=', 2)), '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
                            ),
                            0
                        ) AS extra_bs
                    ) extra_meta
                    WHERE p.cuenta_bancaria_id = $1
                      AND p.estado = 'Validado'
                      AND COALESCE(p.es_ajuste_historico, false) = false
                      AND (extra_meta.extra_usd > 0 OR extra_meta.extra_bs > 0)
                      -- Evita doble visualizacion: si el pago ya genero ingresos en fondos, el extra
                      -- ya esta reflejado en ingresos_fondos y no debe repetirse como transito/extra.
                      AND NOT EXISTS (
                        SELECT 1
                        FROM movimientos_fondos mf_ex
                        JOIN fondos f_ex ON f_ex.id = mf_ex.fondo_id
                        WHERE mf_ex.referencia_id = p.id
                          AND f_ex.cuenta_bancaria_id = $1
                          AND UPPER(COALESCE(mf_ex.tipo, '')) IN ('INGRESO', 'INGRESO_PAGO', 'ABONO', 'AJUSTE_INICIAL')
                      )
                ),
                egresos_gpf AS (
                    SELECT
                        ('EGR-' || ${gpfIdExpr}) AS id,
                        gpf.fecha_pago::date AS fecha,
                        ${gpfReferenciaExpr} AS referencia,
                        ${gpfConceptoPagoProveedorExpr} AS concepto,
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
                        f.nombre::text AS fondo_nombre,
                        ${gpfPagoProveedorIdExpr}::int AS pago_id,
                        NULL::text AS inmueble,
                        NULL::timestamp AS created_at
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
                        ${ppConceptoPagoProveedorExpr} AS concepto,
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
                        f.nombre::text AS fondo_nombre,
                        pp.id::int AS pago_id,
                        NULL::text AS inmueble,
                        NULL::timestamp AS created_at
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
                egresos_manuales_fondos AS (
                    SELECT
                        ('EGR-MF-' || mf.id::text) AS id,
                        mf.fecha::date AS fecha,
                        NULLIF(BTRIM(COALESCE((regexp_match(COALESCE(mf.nota, ''), '(?i)Ref:\\s*([^|]+)'))[1], '')), '') AS referencia,
                        COALESCE(NULLIF(BTRIM(COALESCE((regexp_match(COALESCE(mf.nota, ''), '(?i)Concepto:\\s*([^|]+)'))[1], '')), ''), COALESCE(mf.nota, 'Egreso manual')) AS concepto,
                        'EGRESO'::text AS tipo,
                        CASE
                            WHEN UPPER(COALESCE(f.moneda, '')) = 'BS' THEN mf.monto
                            WHEN UPPER(COALESCE(f.moneda, '')) = 'USD' AND COALESCE(mf.tasa_cambio, 0) > 0 THEN (mf.monto * mf.tasa_cambio)
                            ELSE NULL
                        END AS monto_bs,
                        mf.tasa_cambio AS tasa_cambio,
                        CASE
                            WHEN UPPER(COALESCE(f.moneda, '')) = 'USD' THEN mf.monto
                            WHEN UPPER(COALESCE(f.moneda, '')) = 'BS' AND COALESCE(mf.tasa_cambio, 0) > 0 THEN (mf.monto / mf.tasa_cambio)
                            ELSE NULL
                        END AS monto_usd,
                        NULL::numeric AS monto_origen_pago,
                        NULL::text AS banco_origen,
                        NULL::text AS cedula_origen,
                        mf.fondo_id::int AS fondo_id,
                        NULL::int AS fondo_origen_id,
                        NULL::int AS fondo_destino_id,
                        f.nombre::text AS fondo_nombre,
                        NULL::int AS pago_id,
                        NULL::text AS inmueble,
                        mf.fecha AS created_at
                    FROM movimientos_fondos mf
                    JOIN fondos f ON f.id = mf.fondo_id
                    WHERE f.cuenta_bancaria_id = $1
                      AND (
                        UPPER(COALESCE(mf.tipo, '')) IN ('EGRESO', 'EGRESO_GASTO', 'SALIDA', 'DEBITO', 'DESCUENTO')
                        OR (
                            UPPER(COALESCE(mf.tipo, '')) = 'AJUSTE_INICIAL'
                            AND (
                                COALESCE(mf.nota, '') ILIKE 'Reclasificación/Pago histórico%'
                                OR COALESCE(mf.nota, '') ILIKE 'Reclasificacion/Pago historico%'
                            )
                        )
                      )
                      AND mf.referencia_id IS NULL
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
                        END AS fondo_nombre,
                        NULL::int AS pago_id,
                        NULL::text AS inmueble,
                        NULL::timestamp AS created_at
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
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre, pago_id, inmueble, created_at
                FROM ingresos_fondos
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre, pago_id, inmueble, created_at
                FROM ingresos_transito
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre, pago_id, inmueble, created_at
                FROM ingresos_extra_detalle
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre, pago_id, inmueble, created_at
                FROM egresos_gpf
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre, pago_id, inmueble, created_at
                FROM egresos_pp
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre, pago_id, inmueble, created_at
                FROM egresos_manuales_fondos
                UNION ALL
                SELECT id, fecha, referencia, concepto, tipo, monto_bs, tasa_cambio, monto_usd, monto_origen_pago, banco_origen, cedula_origen, fondo_id, fondo_origen_id, fondo_destino_id, fondo_nombre, pago_id, inmueble, created_at
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

    // Extras aplicados al fondo principal (solo informativo, no altera saldos en la consulta principal)
    app.get('/bancos-admin/:id/extras-info', verifyToken, async (req: Request<BancosParams>, res: Response, _next: NextFunction) => {
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

            const query = `
                WITH fondo_principal AS (
                    SELECT nombre
                    FROM fondos
                    WHERE cuenta_bancaria_id = $1
                      AND COALESCE(activo, true) = true
                      AND COALESCE(es_operativo, false) = true
                    ORDER BY id ASC
                    LIMIT 1
                ),
                fondo_fallback AS (
                    SELECT nombre
                    FROM fondos
                    WHERE cuenta_bancaria_id = $1
                      AND COALESCE(activo, true) = true
                    ORDER BY id ASC
                    LIMIT 1
                )
                SELECT
                    p.id::int AS pago_id,
                    p.fecha_pago::date AS fecha,
                    p.referencia,
                    pr.identificador::text AS inmueble,
                    COALESCE(
                        CASE
                            WHEN NULLIF(BTRIM(extra_conceptos.conceptos), '') IS NOT NULL
                                THEN ('Extra aplicado: ' || NULLIF(BTRIM(extra_conceptos.conceptos), ''))
                            ELSE NULL
                        END,
                        'Extra aplicado al fondo principal'
                    )::text AS concepto,
                    CASE
                        WHEN p.tasa_cambio IS NOT NULL AND p.tasa_cambio > 0
                            THEN ROUND((extra_meta.extra_usd * p.tasa_cambio)::numeric, 2)
                        ELSE NULL
                    END AS monto_bs,
                    ROUND(extra_meta.extra_usd::numeric, 6) AS monto_usd,
                    COALESCE(fp.nombre, ff.nombre, 'Fondo principal')::text AS fondo_destino,
                    p.nota,
                    p.tasa_cambio
                FROM pagos p
                LEFT JOIN propiedades pr ON pr.id = p.propiedad_id
                CROSS JOIN LATERAL (
                    SELECT COALESCE(
                        NULLIF(
                            (regexp_match(COALESCE(p.nota, ''), '(?i)\\[extra_usd:([0-9]+(?:\\.[0-9]+)?)\\]'))[1],
                            ''
                        )::numeric,
                        0
                    ) AS extra_usd
                ) extra_meta
                LEFT JOIN LATERAL (
                    SELECT string_agg(DISTINCT NULLIF(BTRIM(mf_ex.nota), ''), ' | ') AS conceptos
                    FROM movimientos_fondos mf_ex
                    JOIN fondos f_ex ON f_ex.id = mf_ex.fondo_id
                    WHERE mf_ex.referencia_id = p.id
                      AND f_ex.cuenta_bancaria_id = $1
                      AND UPPER(COALESCE(mf_ex.tipo, '')) IN ('INGRESO', 'INGRESO_PAGO', 'ABONO', 'AJUSTE_INICIAL')
                      AND NULLIF(BTRIM(mf_ex.nota), '') IS NOT NULL
                      AND COALESCE(mf_ex.nota, '') NOT ILIKE 'Pago de condominio%'
                      AND COALESCE(mf_ex.nota, '') NOT ILIKE 'Saldo de apertura%'
                      AND COALESCE(mf_ex.nota, '') NOT ILIKE 'Ingreso distribuido en fondo:%'
                ) extra_conceptos ON true
                LEFT JOIN fondo_principal fp ON true
                LEFT JOIN fondo_fallback ff ON true
                WHERE p.cuenta_bancaria_id = $1
                  AND p.estado = 'Validado'
                  AND COALESCE(p.es_ajuste_historico, false) = false
                  AND extra_meta.extra_usd > 0
                ORDER BY p.fecha_pago DESC, p.id DESC
            `;

            const extras = await pool.query<IExtraInfoRow>(query, [cuentaId]);
            const round2 = (n: unknown): number => {
                const parsed = parseFloat(String(n ?? 0));
                if (!Number.isFinite(parsed)) return 0;
                return parseFloat(parsed.toFixed(2));
            };
            const parseLocale = (value: unknown): number => {
                const raw = String(value ?? '').trim();
                if (!raw) return 0;
                const normalized = raw.includes(',')
                    ? (raw.includes('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.'))
                    : raw;
                const parsed = parseFloat(normalized);
                return Number.isFinite(parsed) ? parsed : 0;
            };

            const normalizedExtras = extras.rows.map((row: IExtraInfoRow) => {
                const notaRaw = String(row.nota || '');
                const tasa = round2(parseLocale(row.tasa_cambio || 0));
                const markerItemsBs = notaRaw.match(/\[extra_items_bs:([^\]]+)\]/i)?.[1] || '';
                let montoBsExacto = 0;
                if (markerItemsBs) {
                    const parts = markerItemsBs.split(';').map((v) => v.trim()).filter(Boolean);
                    for (const part of parts) {
                        const [, bsPart] = part.split('=');
                        const markerBs = round2(parseLocale(bsPart || 0));
                        if (markerBs > 0) {
                            montoBsExacto = round2(montoBsExacto + markerBs);
                        }
                    }
                }

                const montoBs = montoBsExacto > 0 ? montoBsExacto : (row.monto_bs !== null ? round2(parseLocale(row.monto_bs)) : null);
                let montoUsd = round2(parseLocale(row.monto_usd));
                if (montoUsd <= 0 && montoBs !== null && montoBs > 0 && tasa > 0) {
                    montoUsd = round2(montoBs / tasa);
                }

                return {
                    pago_id: row.pago_id,
                    fecha: row.fecha,
                    referencia: row.referencia,
                    inmueble: row.inmueble,
                    concepto: row.concepto,
                    monto_bs: montoBs,
                    monto_usd: montoUsd,
                    fondo_destino: row.fondo_destino,
                };
            });
            const gastosHistoricosRes = await pool.query<IGastoHistoricoExtraRow>(
                `
                SELECT
                    g.id,
                    g.concepto,
                    g.nota,
                    NULL::text AS referencia,
                    g.tasa_cambio,
                    g.fecha_gasto
                FROM gastos g
                WHERE g.condominio_id = $1
                  AND COALESCE(g.nota, '') ~* '\\[hist\\.recaudado_rows_b64:[A-Za-z0-9+/=_-]+\\]'
                `,
                [condoId]
            );
            const historicosExtras: IExtraInfoRow[] = [];
            for (const gasto of gastosHistoricosRes.rows) {
                const notaRaw = String(gasto.nota || '');
                const marker = notaRaw.match(/\[hist\.recaudado_rows_b64:([A-Za-z0-9+/=_-]+)\]/i)?.[1] || '';
                if (!marker) continue;
                let decodedRows: Array<Record<string, unknown>> = [];
                try {
                    decodedRows = JSON.parse(Buffer.from(marker, 'base64').toString('utf8'));
                } catch {
                    decodedRows = [];
                }
                if (!Array.isArray(decodedRows) || decodedRows.length === 0) continue;

                for (let idx = 0; idx < decodedRows.length; idx += 1) {
                    const row = decodedRows[idx] || {};
                    const rowCuentaId = parseInt(String(row.cuenta_bancaria_id ?? ''), 10);
                    if (!Number.isFinite(rowCuentaId) || rowCuentaId !== cuentaId) continue;

                    const montoBs = round2(parseLocale(row.monto_bs ?? 0));
                    const montoUsdRaw = round2(parseLocale(row.monto_usd ?? 0));
                    const tasaRow = round2(parseLocale(gasto.tasa_cambio ?? 0));
                    const montoUsd = montoUsdRaw > 0
                        ? montoUsdRaw
                        : (montoBs > 0 && tasaRow > 0 ? round2(montoBs / tasaRow) : 0);
                    if (montoBs <= 0 && montoUsd <= 0) continue;

                    const fechaOperacion = String(row.fecha_operacion || '').trim();
                    const fecha = fechaOperacion || (gasto.fecha_gasto ? String(gasto.fecha_gasto).slice(0, 10) : '');
                    historicosExtras.push({
                        pago_id: Number(`${gasto.id}${idx + 1}`),
                        fecha: fecha || new Date().toISOString().slice(0, 10),
                        referencia: gasto.referencia || `GH-${gasto.id}`,
                        inmueble: null,
                        concepto: `Recaudado histórico gasto: ${String(gasto.concepto || `#${gasto.id}`)}`,
                        monto_bs: montoBs > 0 ? montoBs : null,
                        monto_usd: montoUsd,
                        fondo_destino: 'Tránsito / Extra',
                    });
                }
            }

            const mergedExtras = [...normalizedExtras, ...historicosExtras].sort((a, b) => {
                const aTime = new Date(String(a.fecha || '')).getTime();
                const bTime = new Date(String(b.fecha || '')).getTime();
                return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
            });
            return res.json({ status: 'success', extras: mergedExtras });
        } catch (error: unknown) {
            const typedError = asError(error);
            console.error('Error en extras-info:', error);
            return res.status(500).json({ error: typedError.message });
        }
    });

    app.post('/movimientos-fondos/:id/rollback-ajuste', verifyToken, async (req: Request<BancosParams>, res: Response, _next: NextFunction) => {
        const movimientoId = asPositiveInt(asString(req.params.id), 'movimiento_fondo_id');
        try {
            const user = asAuthUser(req.user);
            if (!(await ensureNotJuntaGeneralForInmuebleAjustes(user.id, res))) return;
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (!condoRes.rows.length) {
                return res.status(403).json({ status: 'error', message: 'No autorizado para revertir ajustes.' });
            }
            const condominioId = condoRes.rows[0].id;

            await pool.query('BEGIN');
            const movRes = await pool.query<IAjusteRollbackMovimientoRow>(
                `
                SELECT
                    mf.id,
                    mf.fondo_id,
                    mf.tipo,
                    COALESCE(mf.monto, 0) AS monto,
                    mf.nota,
                    mf.fecha,
                    cb.condominio_id,
                    COALESCE(f.saldo_actual, 0) AS saldo_fondo
                FROM movimientos_fondos mf
                JOIN fondos f ON f.id = mf.fondo_id
                JOIN cuentas_bancarias cb ON cb.id = f.cuenta_bancaria_id
                WHERE mf.id = $1
                LIMIT 1
                FOR UPDATE
                `,
                [movimientoId]
            );
            if (!movRes.rows.length) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Movimiento no encontrado.' });
            }
            const mov = movRes.rows[0];
            if (mov.condominio_id !== condominioId) {
                await pool.query('ROLLBACK');
                return res.status(403).json({ status: 'error', message: 'No autorizado para revertir este ajuste.' });
            }

            const tipoMovimiento = String(mov.tipo || '').toUpperCase();
            const notaMovimiento = String(mov.nota || '');
            const esAjusteElegible = tipoMovimiento === 'AJUSTE_INICIAL' && /ajuste/i.test(notaMovimiento);
            if (!esAjusteElegible) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Este movimiento no corresponde a un ajuste de saldo reversible.' });
            }

            const historialMatch = notaMovimiento.match(/ajuste_historial_id:\s*(\d+)/i);
            let historialId = historialMatch?.[1] ? parseInt(historialMatch[1], 10) : NaN;

            if (!Number.isFinite(historialId) || historialId <= 0) {
                // Fallback para ajustes creados antes del tracking de ajuste_historial_id:
                // buscar por nota exacta + timestamp del movimiento (misma transacción)
                const fallbackRes = await pool.query<{ id: number }>(
                    `SELECT h.id FROM historial_saldos_inmuebles h
                     JOIN propiedades p ON p.id = h.propiedad_id
                     WHERE h.nota = $1
                       AND h.tipo IN ('AGREGAR_FAVOR', 'FAVOR')
                       AND p.condominio_id = $2
                       AND h.fecha BETWEEN $3::timestamp - INTERVAL '2 seconds'
                                       AND $3::timestamp + INTERVAL '2 seconds'
                     ORDER BY ABS(EXTRACT(EPOCH FROM (h.fecha - $3::timestamp))) ASC
                     LIMIT 1`,
                    [notaMovimiento, condominioId, mov.fecha]
                );
                if (fallbackRes.rows.length > 0) {
                    historialId = fallbackRes.rows[0].id;
                } else {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({
                        status: 'error',
                        message: 'Este ajuste no tiene trazabilidad suficiente para rollback automático. Realice un ajuste compensatorio manual.',
                    });
                }
            }

            const historialRes = await pool.query<IAjusteHistorialRollbackRow>(
                `
                SELECT h.id, h.propiedad_id, h.tipo, h.monto
                FROM historial_saldos_inmuebles h
                JOIN propiedades p ON p.id = h.propiedad_id
                WHERE h.id = $1
                  AND p.condominio_id = $2
                LIMIT 1
                FOR UPDATE
                `,
                [historialId, condominioId]
            );
            if (!historialRes.rows.length) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'No se encontró el historial del ajuste asociado.' });
            }
            const historial = historialRes.rows[0];
            const tipoHistorial = String(historial.tipo || '').toUpperCase();
            if (tipoHistorial !== 'AGREGAR_FAVOR' && tipoHistorial !== 'FAVOR') {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Solo se pueden revertir ajustes de saldo a favor.' });
            }

            const montoFondo = parseFloat(String(mov.monto ?? 0)) || 0;
            const saldoFondoActual = parseFloat(String(mov.saldo_fondo ?? 0)) || 0;
            if (montoFondo <= 0 || saldoFondoActual < montoFondo) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    status: 'error',
                    message: 'No se puede revertir porque el fondo ya no tiene saldo suficiente para deshacer este ajuste.',
                });
            }

            const montoPropiedad = parseFloat(String(historial.monto ?? 0)) || 0;
            if (montoPropiedad <= 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Monto del historial de ajuste inválido.' });
            }

            await pool.query('UPDATE fondos SET saldo_actual = GREATEST(0, COALESCE(saldo_actual, 0) - $1) WHERE id = $2', [montoFondo, mov.fondo_id]);
            await pool.query('UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2', [montoPropiedad, historial.propiedad_id]);
            await pool.query('DELETE FROM movimientos_fondos WHERE id = $1', [movimientoId]);
            await pool.query('DELETE FROM historial_saldos_inmuebles WHERE id = $1', [historialId]);

            await pool.query('COMMIT');
            return res.json({ status: 'success', message: 'Ajuste revertido correctamente.' });
        } catch (err: unknown) {
            await pool.query('ROLLBACK');
            const message = asError(err).message;
            const businessError =
                message.includes('No está permitido este registro') ||
                message.includes('tasa BCV') ||
                message.includes('Saldo insuficiente') ||
                message.includes('no encontrada') ||
                message.includes('no encontrado');
            return res.status(businessError ? 400 : 500).json({ status: 'error', message });
        }
    });

    app.post('/transferencias/:id/rollback', verifyToken, async (req: Request<BancosParams>, res: Response, _next: NextFunction) => {
        const transferenciaId = asPositiveInt(asString(req.params.id), 'transferencia_id');
        try {
            const user = asAuthUser(req.user);
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (!condoRes.rows.length) {
                return res.status(403).json({ status: 'error', message: 'No autorizado para revertir transferencias.' });
            }
            const condominioId = condoRes.rows[0].id;

            await pool.query('BEGIN');
            const transferRes = await pool.query<ITransferenciaRollbackRow>(
                `
                SELECT
                    t.id,
                    t.condominio_id,
                    t.fondo_origen_id,
                    t.fondo_destino_id,
                    COALESCE(t.monto_origen, 0) AS monto_origen,
                    COALESCE(t.monto_destino, 0) AS monto_destino,
                    COALESCE(fo.saldo_actual, 0) AS saldo_origen,
                    COALESCE(fd.saldo_actual, 0) AS saldo_destino
                FROM transferencias t
                JOIN fondos fo ON fo.id = t.fondo_origen_id
                JOIN fondos fd ON fd.id = t.fondo_destino_id
                WHERE t.id = $1
                  AND t.condominio_id = $2
                LIMIT 1
                FOR UPDATE
                `,
                [transferenciaId, condominioId]
            );

            if (!transferRes.rows.length) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Transferencia no encontrada.' });
            }

            const transferencia = transferRes.rows[0];
            const montoOrigen = parseFloat(String(transferencia.monto_origen || 0)) || 0;
            const montoDestino = parseFloat(String(transferencia.monto_destino || 0)) || 0;
            const saldoDestino = parseFloat(String(transferencia.saldo_destino || 0)) || 0;

            if (montoOrigen <= 0 || montoDestino <= 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'La transferencia no tiene montos válidos para rollback.' });
            }

            if (saldoDestino + 1e-6 < montoDestino) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    status: 'error',
                    message: 'No se puede eliminar: el fondo destino no tiene saldo suficiente para revertir esta transferencia.',
                });
            }

            await pool.query(
                'UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2',
                [montoOrigen, transferencia.fondo_origen_id]
            );
            await pool.query(
                'UPDATE fondos SET saldo_actual = saldo_actual - $1 WHERE id = $2',
                [montoDestino, transferencia.fondo_destino_id]
            );
            await pool.query('DELETE FROM transferencias WHERE id = $1', [transferenciaId]);

            await pool.query('COMMIT');
            return res.json({ status: 'success', message: 'Transferencia eliminada y saldos revertidos correctamente.' });
        } catch (error: unknown) {
            await pool.query('ROLLBACK');
            return res.status(500).json({ status: 'error', message: asError(error).message });
        }
    });

    app.post('/movimientos-fondos/:id/rollback-egreso-manual', verifyToken, async (req: Request<BancosParams>, res: Response, _next: NextFunction) => {
        const movimientoId = asPositiveInt(asString(req.params.id), 'movimiento_fondo_id');
        try {
            const user = asAuthUser(req.user);
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (!condoRes.rows.length) {
                return res.status(403).json({ status: 'error', message: 'No autorizado para revertir egresos.' });
            }
            const condominioId = condoRes.rows[0].id;

            await pool.query('BEGIN');
            const movRes = await pool.query<IEgresoManualRollbackRow>(
                `
                SELECT
                    mf.id,
                    cb.condominio_id,
                    mf.fondo_id,
                    mf.tipo,
                    mf.nota,
                    COALESCE(mf.monto, 0) AS monto
                FROM movimientos_fondos mf
                JOIN fondos f ON f.id = mf.fondo_id
                JOIN cuentas_bancarias cb ON cb.id = f.cuenta_bancaria_id
                WHERE mf.id = $1
                LIMIT 1
                FOR UPDATE
                `,
                [movimientoId]
            );

            if (!movRes.rows.length) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Movimiento no encontrado.' });
            }

            const mov = movRes.rows[0];
            if (mov.condominio_id !== condominioId) {
                await pool.query('ROLLBACK');
                return res.status(403).json({ status: 'error', message: 'No autorizado para revertir este egreso.' });
            }

            const nota = String(mov.nota || '');
            if (!/egreso manual libro mayor/i.test(nota)) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Este movimiento no corresponde a un egreso manual reversible.' });
            }

            const monto = parseFloat(String(mov.monto || 0)) || 0;
            if (monto <= 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Monto inválido para reversión del egreso.' });
            }

            await pool.query(
                'UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2',
                [monto, mov.fondo_id]
            );
            await pool.query('DELETE FROM movimientos_fondos WHERE id = $1', [movimientoId]);

            await pool.query('COMMIT');
            return res.json({ status: 'success', message: 'Egreso manual revertido correctamente.' });
        } catch (error: unknown) {
            await pool.query('ROLLBACK');
            return res.status(500).json({ status: 'error', message: asError(error).message });
        }
    });

    app.post('/egresos-manuales', verifyToken, async (req: Request<{}, unknown, ManualEgresoBody>, res: Response) => {
        const { cuenta_id, fondo_id, monto_origen, tasa_cambio, referencia, concepto, fecha, tipo_movimiento } = req.body;
        let client: PoolClient | null = null;
        try {
            client = await pool.connect();
            const user = asAuthUser(req.user);
            const tipoMovimiento = String(tipo_movimiento || 'EGRESO').trim().toUpperCase() === 'INGRESO' ? 'INGRESO' : 'EGRESO';
            const cuentaId = asPositiveInt(cuenta_id, 'cuenta_id');
            const fondoId = asPositiveInt(fondo_id, 'fondo_id');
            const montoOrigen = asDecimal(monto_origen, 'monto_origen');
            const tasaCambio = (tasa_cambio === null || tasa_cambio === undefined || String(tasa_cambio).trim() === '')
                ? null
                : asDecimal(tasa_cambio, 'tasa_cambio');
            const referenciaSafe = String(referencia || '').trim();
            const conceptoSafe = String(concepto || '').trim();
            const fechaSafe = toIsoDate(fecha, 'fecha');

            if (!referenciaSafe) return res.status(400).json({ status: 'error', message: 'La referencia es requerida.' });
            if (!conceptoSafe) return res.status(400).json({ status: 'error', message: 'El concepto es requerido.' });
            if (!Number.isFinite(montoOrigen) || montoOrigen <= 0) {
                return res.status(400).json({ status: 'error', message: 'El monto debe ser mayor a 0.' });
            }

            const condoRes = await client.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (!condoRes.rows.length) {
                return res.status(403).json({ status: 'error', message: 'No autorizado para registrar egresos.' });
            }
            const condominioId = condoRes.rows[0].id;

            await client.query('BEGIN');

            const cuentaRes = await client.query<{ id: number; nombre_banco: string | null; apodo: string | null; tipo: string | null }>(
                `
                SELECT id, nombre_banco, apodo, tipo
                FROM cuentas_bancarias
                WHERE id = $1
                  AND condominio_id = $2
                LIMIT 1
                `,
                [cuentaId, condominioId]
            );
            if (!cuentaRes.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Cuenta bancaria no encontrada.' });
            }

            const fondoRes = await client.query<{ id: number; moneda: string | null; saldo_actual: string | number; nombre: string | null }>(
                `
                SELECT id, moneda, saldo_actual, nombre
                FROM fondos
                WHERE id = $1
                  AND cuenta_bancaria_id = $2
                  AND condominio_id = $3
                  AND COALESCE(activo, true) = true
                LIMIT 1
                FOR UPDATE
                `,
                [fondoId, cuentaId, condominioId]
            );
            if (!fondoRes.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Fondo no encontrado para la cuenta seleccionada.' });
            }
            await validarFechaVsAperturaFondo(fondoId, fechaSafe);

            const cuenta = cuentaRes.rows[0];
            const fondo = fondoRes.rows[0];
            const cuentaText = `${String(cuenta.tipo || '')} ${String(cuenta.apodo || '')} ${String(cuenta.nombre_banco || '')}`.toUpperCase();
            const cuentaMoneda = /USD|ZELLE|DIVISA|DOLAR/.test(cuentaText) ? 'USD' : 'BS';
            const fondoMoneda = String(fondo.moneda || '').toUpperCase() === 'USD' ? 'USD' : 'BS';

            let montoBs = 0;
            let montoUsd = 0;

            if (cuentaMoneda === 'BS') {
                if (!tasaCambio || tasaCambio <= 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ status: 'error', message: 'La tasa BCV es requerida para cuentas en Bs.' });
                }
                montoBs = montoOrigen;
                montoUsd = montoBs / tasaCambio;
            } else {
                montoUsd = montoOrigen;
                montoBs = tasaCambio && tasaCambio > 0 ? (montoUsd * tasaCambio) : 0;
            }

            const montoFondo = fondoMoneda === 'USD' ? montoUsd : montoBs;
            const saldoFondo = parseFloat(String(fondo.saldo_actual ?? 0)) || 0;
            if (montoFondo <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'El monto calculado para el fondo es inválido.' });
            }
            if (tipoMovimiento === 'EGRESO' && saldoFondo + 0.0001 < montoFondo) {
                await client.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Saldo insuficiente en el fondo seleccionado.' });
            }

            await client.query(
                `UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) ${tipoMovimiento === 'INGRESO' ? '+' : '-'} $1 WHERE id = $2`,
                [montoFondo, fondoId]
            );

            const preferredTipos = tipoMovimiento === 'INGRESO'
                ? ['INGRESO_PAGO', 'ABONO', 'INGRESO']
                : ['EGRESO_GASTO', 'EGRESO', 'SALIDA', 'DEBITO', 'DESCUENTO', 'PAGO_PROVEEDOR', 'EGRESO_PAGO'];
            const tipoMovimientoFondo = await resolveMovimientoFondoTipo(preferredTipos, preferredTipos[0]);
            const nota = `${tipoMovimiento === 'INGRESO' ? 'Ingreso' : 'Egreso'} manual libro mayor | Concepto: ${conceptoSafe} | Ref: ${referenciaSafe} | Bs ${montoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | USD ${montoUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            const mfColsRes = await client.query<IColumnNameRow>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'movimientos_fondos'
                  AND column_name IN ('fecha', 'referencia_id', 'tasa_cambio')
                `
            );
            const mfCols = new Set(mfColsRes.rows.map((r) => r.column_name));
            const insertCols = ['fondo_id', 'tipo', 'monto', 'nota'];
            const insertVals: unknown[] = [fondoId, tipoMovimientoFondo, montoFondo, nota];
            if (mfCols.has('tasa_cambio')) {
                insertCols.push('tasa_cambio');
                insertVals.push(tasaCambio);
            }
            if (mfCols.has('referencia_id')) {
                insertCols.push('referencia_id');
                insertVals.push(null);
            }
            if (mfCols.has('fecha')) {
                insertCols.push('fecha');
                insertVals.push(fechaSafe);
            }
            const placeholders = insertVals.map((_, idx) => `$${idx + 1}`).join(', ');
            const allowedTipos = await getMovimientoFondoTiposPermitidos();
            const tiposCandidatos = Array.from(
                new Set([
                    tipoMovimientoFondo,
                    ...preferredTipos,
                    ...allowedTipos,
                ].map((t) => String(t || '').trim()).filter(Boolean))
            );
            let inserted = false;
            let lastInsertErr: unknown = null;
            for (const tipo of tiposCandidatos) {
                try {
                    await client.query('SAVEPOINT sp_mf_insert_tipo');
                    const vals = [...insertVals];
                    vals[1] = tipo;
                    await client.query(
                        `INSERT INTO movimientos_fondos (${insertCols.join(', ')}) VALUES (${placeholders})`,
                        vals
                    );
                    await client.query('RELEASE SAVEPOINT sp_mf_insert_tipo');
                    inserted = true;
                    break;
                } catch (insertErr: unknown) {
                    await client.query('ROLLBACK TO SAVEPOINT sp_mf_insert_tipo');
                    const errObj = insertErr as { code?: string; constraint?: string };
                    const isTipoCheck = errObj?.code === '23514' && (
                        String(errObj?.constraint || '').includes('movimientos_fondos_tipo_check') ||
                        String((errObj as { message?: string })?.message || '').includes('movimientos_fondos_tipo_check')
                    );
                    if (!isTipoCheck) throw insertErr;
                    lastInsertErr = insertErr;
                }
            }
            if (!inserted) {
                throw asError(lastInsertErr || new Error('No se pudo determinar un tipo valido para movimientos_fondos.'));
            }

            await client.query('COMMIT');
            return res.json({
                status: 'success',
                message: `${tipoMovimiento === 'INGRESO' ? 'Ingreso' : 'Egreso'} registrado correctamente.`,
                data: {
                    tipo_movimiento: tipoMovimiento,
                    cuenta_id: cuentaId,
                    fondo_id: fondoId,
                    referencia: referenciaSafe,
                    concepto: conceptoSafe,
                    monto_bs: Number(montoBs.toFixed(2)),
                    monto_usd: Number(montoUsd.toFixed(2)),
                },
            });
        } catch (err: unknown) {
            if (client) await client.query('ROLLBACK');
            const message = asError(err).message;
            const isBadRequest = err instanceof TypeError || /invalid\s+[a-z_]+\s+value/i.test(message) || /es requerida/i.test(message);
            return res.status(isBadRequest ? 400 : 500).json({ status: 'error', message });
        } finally {
            client?.release();
        }
    });

    // ðŸ”„ REGISTRAR TRANSFERENCIA ENTRE FONDOS/CUENTAS
    app.post('/transferencias', verifyToken, async (req: Request<{}, unknown, TransferenciaBody>, res: Response, _next: NextFunction) => {
        const { fondo_origen_id, fondo_destino_id, cuenta_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota } = req.body;
        let client: PoolClient | null = null;

        try {
            client = await pool.connect();
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
            const condoRes = await client.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (!condoRes.rows.length) {
                return res.status(403).json({ error: 'No autorizado para registrar transferencias.' });
            }
            const condoId = condoRes.rows[0].id;
            const hasCuentaDestino = cuenta_destino_id !== undefined && cuenta_destino_id !== null && String(cuenta_destino_id).trim() !== '';
            const hasFondoDestino = fondo_destino_id !== undefined && fondo_destino_id !== null && String(fondo_destino_id).trim() !== '';

            await client.query('BEGIN');

            const origenRes = await client.query<IFondoTransferRow>(
                'SELECT id, cuenta_bancaria_id, condominio_id, moneda, porcentaje_asignacion, es_operativo FROM fondos WHERE id = $1 AND condominio_id = $2 AND activo = true LIMIT 1',
                [fondoOrigenIdSafe, condoId]
            );
            if (origenRes.rows.length === 0) {
                throw new Error('Fondo de origen no encontrado o no pertenece al condominio.');
            }
            const fondoOrigen = origenRes.rows[0];
            await validarFechaVsAperturaFondo(fondoOrigenIdSafe, fechaSafe);

            const sourceBalanceRes = await client.query<{ saldo_actual: number | string }>(
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
            if (!hasFondoDestino) {
                throw new Error('Debe seleccionar un fondo destino.');
            }

            await client.query('UPDATE fondos SET saldo_actual = saldo_actual - $1 WHERE id = $2', [montoOrigenSafe, fondoOrigenIdSafe]);

            const fondoDestinoIdSafe = asPositiveInt(fondo_destino_id, 'fondo_destino_id');
            const destinoRes = await client.query<IFondoTransferRow>(
                `SELECT id, cuenta_bancaria_id, condominio_id, moneda, porcentaje_asignacion, es_operativo
                 FROM fondos
                 WHERE id = $1
                   AND condominio_id = $2
                   AND activo = true
                 LIMIT 1`,
                [fondoDestinoIdSafe, condoId]
            );
            if (destinoRes.rows.length === 0) {
                throw new Error('Fondo destino no encontrado o no pertenece al condominio.');
            }
            const fondoDestino = destinoRes.rows[0];
            if (fondoDestino.id === fondoOrigenIdSafe) {
                throw new Error('El fondo destino debe ser distinto al fondo de origen.');
            }
            if (String(fondoDestino.moneda || '').toUpperCase() !== String(fondoOrigen.moneda || '').toUpperCase()) {
                throw new Error('El fondo destino debe tener la misma moneda que el fondo de origen.');
            }
            if (hasCuentaDestino) {
                const cuentaDestinoIdSafe = asPositiveInt(cuenta_destino_id, 'cuenta_destino_id');
                if (fondoDestino.cuenta_bancaria_id !== cuentaDestinoIdSafe) {
                    throw new Error('El fondo destino no pertenece a la cuenta destino seleccionada.');
                }
            }

            await validarFechaVsAperturaFondo(fondoDestinoIdSafe, fechaSafe);
            await client.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [montoDestinoSafe, fondoDestinoIdSafe]);
            await client.query(
                `INSERT INTO transferencias (condominio_id, fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [condoId, fondoOrigenIdSafe, fondoDestinoIdSafe, montoOrigenSafe, tasaCambioSafe, montoDestinoSafe, referenciaSafe, fechaSafe, notaSafe]
            );

            await client.query('COMMIT');
            res.json({ status: 'success', message: 'Transferencia procesada exitosamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            if (client) await client.query('ROLLBACK');
            const businessError =
                error.message.includes('No está permitido este registro') ||
                error.message.includes('no encontrado') ||
                error.message.includes('Debe seleccionar') ||
                error.message.includes('saldo suficiente') ||
                error.message.includes('monto de transferencia');
            res.status(businessError ? 400 : 500).json({ error: error.message });
        } finally {
            client?.release();
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

