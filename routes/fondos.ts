import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

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
}

interface IUsageRow {
    total_usos: string;
}

interface FondosDeleteParams {
    id?: string;
}

interface CreateFondoBody {
    cuenta_bancaria_id: number;
    nombre: string;
    moneda: string;
    porcentaje: unknown;
    saldo_inicial: unknown;
    es_operativo?: boolean;
}

interface DeleteFondoBody {
    destino_id?: string | number;
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

const registerFondosRoutes = (app: Application, { pool, verifyToken, parseLocaleNumber }: AuthDependencies): void => {
    app.get('/fondos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const result = await pool.query<IFondoWithBancoRow>(
                `
            SELECT f.*, cb.nombre_banco, cb.apodo 
            FROM fondos f 
            JOIN cuentas_bancarias cb ON f.cuenta_bancaria_id = cb.id 
            WHERE f.condominio_id = $1 AND f.activo = true
            ORDER BY cb.nombre_banco ASC, f.es_operativo DESC, f.nombre ASC
        `,
                [condoRes.rows[0].id]
            );
            res.json({ status: 'success', fondos: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/fondos', verifyToken, async (req: Request<{}, unknown, CreateFondoBody>, res: Response, _next: NextFunction) => {
        const { cuenta_bancaria_id, nombre, moneda, porcentaje, saldo_inicial, es_operativo } = req.body;
        const porcNum = es_operativo ? 0 : parseLocaleNumber(porcentaje);
        const saldoNum = parseLocaleNumber(saldo_inicial);

        try {
            const user = asAuthUser(req.user);
            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const fondo = await pool.query<IInsertedIdRow>(
                'INSERT INTO fondos (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                [condoRes.rows[0].id, cuenta_bancaria_id, nombre, moneda, porcNum, saldoNum, es_operativo || false]
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

    // ðŸ’¡ NUEVO: Borrado inteligente (Hard Delete vs Soft Delete) y transferencia forzada
    app.delete('/fondos/:id', verifyToken, async (req: Request<FondosDeleteParams, unknown, DeleteFondoBody>, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const fondoId = asString(req.params.id);
            const { destino_id } = req.body || {};

            const condoRes = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = condoRes.rows[0].id;

            await pool.query('BEGIN');

            const fondoRes = await pool.query<IFondoRow>('SELECT * FROM fondos WHERE id = $1 AND condominio_id = $2 AND activo = true', [fondoId, condoId]);
            if (fondoRes.rows.length === 0) throw new Error('Fondo no encontrado o ya estÃ¡ inactivo.');

            const fondo = fondoRes.rows[0];
            const saldo = parseFloat(String(fondo.saldo_actual || 0));

            // ðŸ” EL JUEZ: Verificamos si el fondo tiene historial de uso real
            const usageRes = await pool.query<IUsageRow>(`
                SELECT 
                    (SELECT COUNT(*) FROM transferencias WHERE fondo_origen_id = $1 OR fondo_destino_id = $1) +
                    (SELECT COUNT(*) FROM pagos_proveedores WHERE fondo_id = $1) AS total_usos
            `, [fondoId]);
            const tieneHistorial = parseInt(usageRes.rows[0].total_usos, 10) > 0;

            // CASO 1: TIENE DINERO (Forzamos transferencia y Soft Delete)
            if (saldo > 0) {
                if (!destino_id) throw new Error('El fondo tiene saldo. Debe especificar un fondo de destino.');

                const destRes = await pool.query<IFondoRow>('SELECT * FROM fondos WHERE id = $1 AND condominio_id = $2 AND activo = true', [destino_id, condoId]);
                if (destRes.rows.length === 0) throw new Error('Fondo de destino no vÃ¡lido.');
                const destino = destRes.rows[0];

                if (fondo.moneda !== destino.moneda) {
                    throw new Error(`Debe transferir a un fondo con la misma moneda (${fondo.moneda}).`);
                }

                // 1. Inyectamos la transferencia al Libro Mayor
                await pool.query(
                    `INSERT INTO transferencias (condominio_id, fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota)
                     VALUES ($1, $2, $3, $4, null, $5, $6, CURRENT_DATE, $7)`,
                    [condoId, fondoId, destino_id, saldo, saldo, 'CIERRE', 'Transferencia de fondos por eliminaciÃ³n de fondo']
                );

                // 2. Sumamos el dinero al nuevo fondo destino
                await pool.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [saldo, destino_id]);

                // 3. Soft Delete: Desactivamos el fondo original dejÃ¡ndolo en cero
                await pool.query('UPDATE fondos SET activo = false, saldo_actual = 0 WHERE id = $1', [fondoId]);

                await pool.query('COMMIT');
                return res.json({ status: 'success', message: 'Fondo desactivado y saldo transferido con Ã©xito.' });
            }

            // CASO 2: ESTÃ EN CERO, PERO NUNCA SE HA USADO (HARD DELETE)
            if (!tieneHistorial) {
                // Borramos cualquier ajuste inicial (si lo hubo) para no romper las llaves forÃ¡neas
                await pool.query('DELETE FROM movimientos_fondos WHERE fondo_id = $1', [fondoId]);
                // Borramos el fondo de raÃ­z
                await pool.query('DELETE FROM fondos WHERE id = $1', [fondoId]);

                await pool.query('COMMIT');
                return res.json({ status: 'success', message: 'Fondo eliminado permanentemente (Sin uso previo).' });
            }

            // CASO 3: ESTÃ EN CERO, PERO SÃ TIENE HISTORIA (SOFT DELETE)
            else {
                await pool.query('UPDATE fondos SET activo = false, saldo_actual = 0 WHERE id = $1', [fondoId]);
                await pool.query('COMMIT');
                return res.json({ status: 'success', message: 'Fondo desactivado correctamente (Se conservÃ³ su historial).' });
            }

        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerFondosRoutes };

