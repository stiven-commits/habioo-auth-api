import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { Faker } from '@faker-js/faker';

interface AuthUser {
    id: number;
    cedula?: string;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface IIdRow {
    id: number;
}

interface ICondominioAdminRow {
    id: number;
    mes_actual: string | null;
    tipo: string | null;
}

interface IMisPropiedadRow extends Record<string, unknown> {
    condominio_nombre: string;
}

interface ITotalDeudaRow {
    total_deuda: string | null;
}

interface IResumenSumRow {
    total: string | null;
}

interface IMonthlySumRow {
    mes: string;
    total: string | null;
}

interface IGastoRubroRow {
    name: string;
    value: string | null;
}

interface IUltimoPagoDashboardRow {
    monto_usd: string | number | null;
    metodo: string | null;
    fecha_pago: string | Date | null;
    estado: string | null;
    identificador: string;
}

interface ICountDashboardRow {
    total: string | number;
}

interface ICuentaPorCobrarRow extends Record<string, unknown> {
    apto: string;
}

interface IPropConfig {
    iden: string;
    zona: number;
    saldo: number;
    alicuota: number;
}

interface IGastoConfig {
    concepto: string;
    usd: number;
    tipo: 'Comun' | 'No Comun' | 'Zona' | 'Individual' | 'Extra';
    zona: number | null;
    prop: number | null;
    cuotas: number;
}

const buildSeedGastoNota = (concepto: string): string => {
    const base = `Gasto de prueba para "${concepto}" registrado por el seeder con detalle operativo y justificacion administrativa para pruebas integrales del flujo contable.`;
    if (base.length >= 80) return base;
    return `${base} Incluye contexto adicional para cumplir longitud minima requerida.`;
};

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

const getFaker = async (): Promise<Faker> => {
    try {
        const pkg = require('@faker-js/faker') as { faker?: Faker; fakerES?: Faker };
        return (pkg.faker || pkg.fakerES || pkg) as Faker;
    } catch (_err) {
        const pkg = await import('@faker-js/faker');
        return (pkg.faker || pkg.fakerES) as Faker;
    }
};

const registerDashboardRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    const seederEnabled = ['1', 'true', 'yes', 'on'].includes(
        String(process.env.ENABLE_TEST_SEEDER || '').trim().toLowerCase(),
    );
    const buildCedula = (_faker: Faker, seedNum: number): string => `V${String(10000000 + seedNum).slice(-8)}`;
    const buildRif = (seedNum: number): string => `J${String(100000000 + seedNum).slice(-9)}`;
    const buildVzlaPhone = (faker: Faker): string => `04${faker.helpers.arrayElement(['12', '14', '16', '24', '26'])}${faker.string.numeric(7)}`;
    const buildSeedEmail = (prefix: string, seedNum: number): string => `${prefix}.${seedNum}@seed.habioo.test`;
    const VENEZUELA_ESTADOS = [
        'Distrito Capital', 'Miranda', 'Carabobo', 'Aragua', 'Lara', 'Zulia', 'Anzoategui',
        'Bolivar', 'Merida', 'Tachira', 'Nueva Esparta', 'Monagas', 'Sucre', 'Falcon',
    ];
    const addMonthsSeed = (yyyyMm: string, offset: number): string => {
        const [year, month] = String(yyyyMm).split('-').map(Number);
        const d = new Date(Date.UTC(year, (month - 1) + offset, 1));
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    };
    const mesCobroFromYyyyMm = (yyyyMm: string): string => {
        const monthNames = [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
        ];
        const [year, month] = String(yyyyMm).split('-').map(Number);
        const mes = monthNames[(month || 1) - 1] || 'enero';
        return `${mes} ${year}`;
    };

    const resolveCondoIdForInmuebles = async (adminUserId: number, res: Response): Promise<number | null> => {
        const condoRes = await pool.query<ICondominioAdminRow>(
            'SELECT id, mes_actual, tipo FROM condominios WHERE admin_user_id = $1 LIMIT 1',
            [adminUserId],
        );
        const condo = condoRes.rows[0];
        if (!condo?.id) {
            res.status(403).json({ status: 'error', message: 'No autorizado para consultar módulos de inmuebles.' });
            return null;
        }
        if (String(condo.tipo || '').trim().toLowerCase() === 'junta general') {
            res.status(403).json({ status: 'error', message: 'La Junta General no puede acceder a módulos de detalle por inmueble.' });
            return null;
        }
        return condo.id;
    };

    app.get('/mis-propiedades', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const query = `
                SELECT p.*, c.nombre as condominio_nombre
                FROM propiedades p
                JOIN usuarios_propiedades up ON p.id = up.propiedad_id
                JOIN condominios c ON p.condominio_id = c.id
                WHERE up.user_id = $1 AND COALESCE(up.acceso_portal, true) = true
            `;
            const result = await pool.query<IMisPropiedadRow>(query, [user.id]);
            res.json({ status: 'success', propiedades: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/mis-finanzas', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const queryDeuda = `
                SELECT SUM(r.monto_usd) as total_deuda
                FROM recibos r
                JOIN propiedades p ON r.propiedad_id = p.id
                JOIN usuarios_propiedades up ON p.id = up.propiedad_id
                WHERE up.user_id = $1
                  AND COALESCE(up.acceso_portal, true) = true
                  AND r.estado NOT IN ('Pagado', 'Solvente')
            `;
            const resultDeuda = await pool.query<ITotalDeudaRow>(queryDeuda, [user.id]);

            res.json({
                status: 'success',
                finanzas: {
                    total_deuda: parseFloat(resultDeuda.rows[0].total_deuda || '0').toFixed(2),
                },
            });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    const adminResumenHandler = async (req: Request, res: Response): Promise<Response | void> => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondoIdForInmuebles(user.id, res);
            if (!condominioId) return;

            const [liquidezRes, porCobrarRes, cuentasPorPagarRes, egresosMesRes] = await Promise.all([
                pool.query<IResumenSumRow>(
                    `SELECT COALESCE(SUM(f.saldo_actual), 0)::text AS total
                     FROM fondos f
                     WHERE f.condominio_id = $1`,
                    [condominioId],
                ),
                pool.query<IResumenSumRow>(
                    `SELECT COALESCE(SUM(GREATEST(p.saldo_actual, 0)), 0)::text AS total
                     FROM propiedades p
                     WHERE p.condominio_id = $1`,
                    [condominioId],
                ),
                pool.query<IResumenSumRow>(
                    `SELECT COALESCE(SUM(gc.monto_cuota_usd), 0)::text AS total
                     FROM gastos_cuotas gc
                     INNER JOIN gastos g ON g.id = gc.gasto_id
                     WHERE g.condominio_id = $1
                       AND gc.estado = 'Pendiente'`,
                    [condominioId],
                ),
                pool.query<IResumenSumRow>(
                    `SELECT COALESCE(
                        SUM(
                          CASE
                            WHEN UPPER(COALESCE(f.moneda, 'BS')) = 'USD'
                              THEN COALESCE(mf.monto, 0)
                            ELSE
                              COALESCE(mf.monto, 0) / NULLIF(COALESCE(mf.tasa_cambio, 0), 0)
                          END
                        ), 0
                      )::text AS total
                     FROM movimientos_fondos mf
                     INNER JOIN fondos f ON f.id = mf.fondo_id
                     WHERE f.condominio_id = $1
                       AND UPPER(COALESCE(mf.tipo, '')) IN ('EGRESO', 'SALIDA', 'DEBITO', 'DESCUENTO', 'PAGO_PROVEEDOR', 'EGRESO_PAGO')
                       AND date_trunc('month', COALESCE(mf.fecha, CURRENT_DATE)::timestamp) = date_trunc('month', CURRENT_DATE)`,
                    [condominioId],
                ),
            ]);

            const toNumber = (value: string | null | undefined): number => {
                const parsed = parseFloat(String(value ?? '0'));
                return Number.isFinite(parsed) ? parsed : 0;
            };

            return res.json({
                status: 'success',
                data: {
                    liquidez: toNumber(liquidezRes.rows[0]?.total),
                    por_cobrar: toNumber(porCobrarRes.rows[0]?.total),
                    cuentas_por_pagar: toNumber(cuentasPorPagarRes.rows[0]?.total),
                    egresos_mes: toNumber(egresosMesRes.rows[0]?.total),
                },
            });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ status: 'error', message: error.message });
        }
    };

    app.get('/admin-resumen', verifyToken, (req: Request, res: Response) => {
        void adminResumenHandler(req, res);
    });
    app.get('/api/dashboard/admin-resumen', verifyToken, (req: Request, res: Response) => {
        void adminResumenHandler(req, res);
    });

    app.get('/admin-graficos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondoIdForInmuebles(user.id, res);
            if (!condominioId) return;

            const [ingresosRes, egresosRes, gastosRubrosRes] = await Promise.all([
                pool.query<IMonthlySumRow>(
                    `SELECT to_char(date_trunc('month', COALESCE(p.created_at, p.fecha_pago::timestamp)), 'YYYY-MM') AS mes,
                            COALESCE(SUM(p.monto_usd), 0)::text AS total
                     FROM pagos p
                     INNER JOIN propiedades pr ON pr.id = p.propiedad_id
                     WHERE pr.condominio_id = $1
                        AND p.estado = 'Validado'
                        AND date_trunc('month', COALESCE(p.created_at, p.fecha_pago::timestamp)) >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
                        AND date_trunc('month', COALESCE(p.created_at, p.fecha_pago::timestamp)) <= date_trunc('month', CURRENT_DATE)
                     GROUP BY 1
                     ORDER BY 1 ASC`,
                    [condominioId],
                ),
                pool.query<IMonthlySumRow>(
                    `SELECT to_char(date_trunc('month', COALESCE(mf.fecha, CURRENT_DATE)::timestamp), 'YYYY-MM') AS mes,
                            COALESCE(
                              SUM(
                                CASE
                                  WHEN UPPER(COALESCE(f.moneda, 'BS')) = 'USD'
                                    THEN COALESCE(mf.monto, 0)
                                  ELSE
                                    COALESCE(mf.monto, 0) / NULLIF(COALESCE(mf.tasa_cambio, 0), 0)
                                END
                              ), 0
                            )::text AS total
                     FROM movimientos_fondos mf
                     INNER JOIN fondos f ON f.id = mf.fondo_id
                     WHERE f.condominio_id = $1
                        AND UPPER(COALESCE(mf.tipo, '')) IN ('EGRESO', 'SALIDA', 'DEBITO', 'DESCUENTO', 'PAGO_PROVEEDOR', 'EGRESO_PAGO')
                        AND date_trunc('month', COALESCE(mf.fecha, CURRENT_DATE)::timestamp) >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
                        AND date_trunc('month', COALESCE(mf.fecha, CURRENT_DATE)::timestamp) <= date_trunc('month', CURRENT_DATE)
                     GROUP BY 1
                     ORDER BY 1 ASC`,
                    [condominioId],
                ),
                pool.query<IGastoRubroRow>(
                    `SELECT COALESCE(NULLIF(BTRIM(pr.rubro), ''), 'Otros') AS name,
                            COALESCE(SUM(gc.monto_cuota_usd), 0)::text AS value
                     FROM gastos_cuotas gc
                     INNER JOIN gastos g ON g.id = gc.gasto_id
                     LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
                     WHERE g.condominio_id = $1
                        AND gc.mes_asignado = to_char(CURRENT_DATE, 'YYYY-MM')
                        AND COALESCE(gc.estado, 'Pendiente') = 'Pendiente'
                     GROUP BY 1
                     ORDER BY SUM(gc.monto_cuota_usd) DESC`,
                    [condominioId],
                ),
            ]);

            const toNumber = (value: string | null | undefined): number => {
                const parsed = parseFloat(String(value ?? '0'));
                return Number.isFinite(parsed) ? parsed : 0;
            };

            const monthNames: string[] = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
            const ingresosMap = new Map<string, number>(
                ingresosRes.rows.map((row) => [row.mes, toNumber(row.total)]),
            );
            const egresosMap = new Map<string, number>(
                egresosRes.rows.map((row) => [row.mes, toNumber(row.total)]),
            );

            const monthKeys: string[] = Array.from({ length: 6 }, (_v, idx) => {
                const d = new Date();
                d.setDate(1);
                d.setMonth(d.getMonth() - (5 - idx));
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                return `${y}-${m}`;
            });

            const dataBalance = monthKeys.map((key) => {
                const [, monthPart] = key.split('-');
                const monthIdx = Number(monthPart) - 1;
                return {
                    mes: monthNames[monthIdx] || key,
                    ingresos: ingresosMap.get(key) || 0,
                    egresos: egresosMap.get(key) || 0,
                };
            });

            const dataGastos = gastosRubrosRes.rows.map((row) => ({
                name: row.name || 'Otros',
                value: toNumber(row.value),
            }));

            return res.json({ status: 'success', dataBalance, dataGastos });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ status: 'error', message: error.message });
        }
    });

    app.get('/admin-movimientos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await resolveCondoIdForInmuebles(user.id, res);
            if (!condominioId) return;

            const [ultimosPagosRes, pagosPendientesRes, reservasPendientesRes, reservasPagoReportadoRes] = await Promise.all([
                pool.query<IUltimoPagoDashboardRow>(
                    `SELECT
                        p.monto_usd,
                        p.metodo,
                        COALESCE(p.created_at, p.fecha_pago::timestamp) AS fecha_pago,
                        p.estado,
                        pr.identificador
                      FROM pagos p
                      INNER JOIN propiedades pr ON pr.id = p.propiedad_id
                      WHERE pr.condominio_id = $1
                        AND p.estado IN ('Validado', 'PendienteAprobacion')
                      ORDER BY COALESCE(p.created_at, p.fecha_pago::timestamp) DESC
                      LIMIT 5`,
                    [condominioId],
                ),
                pool.query<ICountDashboardRow>(
                    `SELECT COUNT(*)::int AS total
                     FROM pagos p
                     INNER JOIN propiedades pr ON pr.id = p.propiedad_id
                     WHERE pr.condominio_id = $1
                       AND p.estado = 'PendienteAprobacion'`,
                    [condominioId],
                ),
                pool.query<ICountDashboardRow>(
                    `SELECT COUNT(*)::int AS total
                     FROM reservaciones r
                     INNER JOIN propiedades p ON p.id = r.propiedad_id
                     WHERE p.condominio_id = $1
                       AND r.estado = 'Pendiente'`,
                    [condominioId],
                ),
                pool.query<ICountDashboardRow>(
                    `SELECT COUNT(*)::int AS total
                     FROM reservaciones r
                     INNER JOIN propiedades p ON p.id = r.propiedad_id
                     WHERE p.condominio_id = $1
                       AND r.estado = 'Pago_Reportado'`,
                    [condominioId],
                ),
            ]);

            const pagosPendientes = Number(pagosPendientesRes.rows[0]?.total || 0);
            const reservasPendientes = Number(reservasPendientesRes.rows[0]?.total || 0);
            const reservasPagoReportado = Number(reservasPagoReportadoRes.rows[0]?.total || 0);

            return res.json({
                status: 'success',
                data: {
                    ultimosPagos: ultimosPagosRes.rows,
                    alertas: {
                        pagosPendientesAprobacion: pagosPendientes,
                        solicitudesAlquilerPendientes: reservasPendientes,
                        pagosAlquilerReportados: reservasPagoReportado,
                    },
                },
            });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ status: 'error', message: error.message });
        }
    });

    app.get('/cuentas-por-cobrar', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condoId = await resolveCondoIdForInmuebles(user.id, res);
            if (!condoId) return;

            const query = `
                SELECT r.*, p.identificador as apto
                FROM recibos r
                JOIN propiedades p ON r.propiedad_id = p.id
                WHERE p.condominio_id = $1
                  AND r.estado NOT IN ('Pagado', 'Solvente')
                ORDER BY r.fecha_emision DESC
            `;
            const result = await pool.query<ICuentaPorCobrarRow>(query, [condoId]);
            res.json({ status: 'success', recibos: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/dashboard-admin/seed-prueba', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            if (!seederEnabled) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Seeder de prueba deshabilitado por configuracion (ENABLE_TEST_SEEDER).',
                });
            }
            const user = asAuthUser(req.user);
            const cedulaAuth = String(user.cedula || '').trim().toUpperCase();
            if (cedulaAuth !== 'J123456789') {
                return res.status(403).json({
                    status: 'error',
                    message: 'Seeder de prueba habilitado solo para el usuario J123456789.',
                });
            }
            const faker = await getFaker();

            await pool.query('BEGIN');

            const condoRes = await pool.query<ICondominioAdminRow>(
                'SELECT id, mes_actual, tipo FROM condominios WHERE admin_user_id = $1 LIMIT 1',
                [user.id],
            );

            if (condoRes.rows.length === 0) {
                throw new Error('Condominio no encontrado para este administrador.');
            }
            if (String(condoRes.rows[0].tipo || '').trim().toLowerCase() === 'junta general') {
                return res.status(403).json({
                    status: 'error',
                    message: 'La Junta General no puede ejecutar seeder de inmuebles.',
                });
            }

            const condoId = condoRes.rows[0].id;
            const seedUsersRes = await pool.query<IIdRow>(
                `SELECT DISTINCT u.id
                 FROM users u
                 JOIN usuarios_propiedades up ON up.user_id = u.id
                 JOIN propiedades p ON p.id = up.propiedad_id
                 WHERE p.condominio_id = $1
                   AND u.email ILIKE '%@seed.habioo.test'`,
                [condoId],
            );
            const seedUserIdsToDelete = seedUsersRes.rows.map((row) => row.id);
            const now = new Date();
            const mesAnteriorDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
            const mesActual = `${mesAnteriorDate.getUTCFullYear()}-${String(mesAnteriorDate.getUTCMonth() + 1).padStart(2, '0')}`;
            const fechaSaldoFondosSeed = '2024-01-01';
            const tasaCambioSeed = 40;
            await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [mesActual, condoId]);

            // Asegura compatibilidad del tipo "Extra" en entornos donde el CHECK aun no fue migrado.
            await pool.query('ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_tipo_check');
            await pool.query(`
                ALTER TABLE gastos
                ADD CONSTRAINT gastos_tipo_check
                CHECK (tipo IN ('Comun', 'No Comun', 'Zona', 'Individual', 'Extra'))
            `);

            // 1) Limpieza completa operativa del condominio para pruebas
            // Se borra TODO lo operativo del condominio para evitar residuos de pruebas manuales anteriores.
            await pool.query(
                `DELETE FROM pagos p
                 USING recibos r, propiedades pr
                 WHERE p.recibo_id = r.id
                   AND r.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condoId],
            );

            await pool.query(
                `DELETE FROM pagos p
                 USING propiedades pr
                 WHERE p.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condoId],
            );

            await pool.query(
                `DELETE FROM recibos r
                 USING propiedades pr
                 WHERE r.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condoId],
            );

            await pool.query(
                `DELETE FROM transferencias WHERE condominio_id = $1`,
                [condoId],
            );

            await pool.query(
                `DELETE FROM pagos_proveedores
                 WHERE fondo_id IN (SELECT id FROM fondos WHERE condominio_id = $1)
                    OR gasto_id IN (SELECT id FROM gastos WHERE condominio_id = $1)`,
                [condoId],
            );

            await pool.query(
                `DELETE FROM movimientos_fondos
                 WHERE fondo_id IN (SELECT id FROM fondos WHERE condominio_id = $1)`,
                [condoId],
            );

            await pool.query(
                `DELETE FROM historial_saldos_inmuebles
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condoId],
            );
            await pool.query(
                `DELETE FROM reservaciones
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condoId],
            );
            await pool.query(
                `DELETE FROM usuarios_propiedades
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condoId],
            );
            await pool.query(
                `DELETE FROM propiedades_zonas
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condoId],
            );

            await pool.query(
                "DELETE FROM gastos_cuotas WHERE gasto_id IN (SELECT id FROM gastos WHERE condominio_id = $1)",
                [condoId],
            );
            await pool.query('DELETE FROM gastos WHERE condominio_id = $1', [condoId]);
            await pool.query('DELETE FROM proveedores WHERE condominio_id = $1', [condoId]);
            await pool.query('DELETE FROM fondos WHERE condominio_id = $1', [condoId]);
            await pool.query('DELETE FROM cuentas_bancarias WHERE condominio_id = $1', [condoId]);
            await pool.query('DELETE FROM propiedades WHERE condominio_id = $1', [condoId]);
            await pool.query('DELETE FROM zonas WHERE condominio_id = $1', [condoId]);

            if (seedUserIdsToDelete.length > 0) {
                await pool.query(
                    `DELETE FROM users
                     WHERE id = ANY($1::int[])
                       AND id <> $2`,
                    [seedUserIdsToDelete, user.id],
                );
            }

            // 2) Datos de prueba frescos
            // Seeder bancario: 4 cuentas (3 en BS y 1 en USD), cada una con su fondo y saldo acorde a su moneda.
            const nombresBancosBs = ['Banco de Venezuela', 'Banesco', 'Mercantil', 'Provincial', 'Bancamiga'];
            const nombreTitularSeed = faker.person.fullName();
            const rifTitularSeed = `J${faker.string.numeric(9)}`;

            const cuentaPrincipalBs = await pool.query<IIdRow>(
                `INSERT INTO cuentas_bancarias
                    (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada, acepta_transferencia, acepta_pago_movil, pago_movil_telefono, pago_movil_cedula_rif)
                 VALUES
                    ($1, $2, $3, $4, 'Transferencia', $5, $6, $7, true, true, true, $7, $6)
                 RETURNING id`,
                [
                    condoId,
                    faker.finance.accountNumber({ length: 20 }),
                    faker.helpers.arrayElement(nombresBancosBs),
                    '[TEST] Cuenta Principal Bs',
                    nombreTitularSeed,
                    rifTitularSeed,
                    buildVzlaPhone(faker),
                ],
            );

            const cuentaPagoMovilBs = await pool.query<IIdRow>(
                `INSERT INTO cuentas_bancarias
                    (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada, acepta_transferencia, acepta_pago_movil, pago_movil_telefono, pago_movil_cedula_rif)
                 VALUES
                    ($1, $2, $3, $4, 'Pago Movil', $5, $6, $7, false, false, true, $7, $6)
                 RETURNING id`,
                [
                    condoId,
                    faker.finance.accountNumber({ length: 20 }),
                    faker.helpers.arrayElement(nombresBancosBs),
                    '[TEST] Cuenta Pago Movil Bs',
                    nombreTitularSeed,
                    rifTitularSeed,
                    buildVzlaPhone(faker),
                ],
            );

            const cuentaSecundariaBs = await pool.query<IIdRow>(
                `INSERT INTO cuentas_bancarias
                    (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada, acepta_transferencia, acepta_pago_movil, pago_movil_telefono, pago_movil_cedula_rif)
                 VALUES
                    ($1, $2, $3, $4, 'Transferencia', $5, $6, $7, false, true, false, NULL, NULL)
                 RETURNING id`,
                [
                    condoId,
                    faker.finance.accountNumber({ length: 20 }),
                    faker.helpers.arrayElement(nombresBancosBs),
                    '[TEST] Cuenta Secundaria Bs',
                    nombreTitularSeed,
                    rifTitularSeed,
                    buildVzlaPhone(faker),
                ],
            );

            const cuentaUsd = await pool.query<IIdRow>(
                `INSERT INTO cuentas_bancarias
                    (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada, acepta_transferencia, acepta_pago_movil, pago_movil_telefono, pago_movil_cedula_rif)
                 VALUES
                    ($1, $2, $3, $4, 'Zelle', $5, $6, NULL, false, false, false, NULL, NULL)
                 RETURNING id`,
                [
                    condoId,
                    `seed.${Date.now()}@habioo.test`,
                    'Bank of America',
                    '[TEST] Cuenta USD',
                    nombreTitularSeed,
                    rifTitularSeed,
                ],
            );

            await pool.query(
                `INSERT INTO fondos
                    (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo, fecha_saldo)
                 VALUES
                    ($1, $2, '[TEST] Fondo Operativo Principal Bs', 'BS', 0, 8000, true, $6::date),
                    ($1, $3, '[TEST] Fondo Caja Chica Bs', 'BS', 0, 2500, false, $6::date),
                    ($1, $4, '[TEST] Fondo Reserva General Bs', 'BS', 0, 3200, false, $6::date),
                    ($1, $5, '[TEST] Fondo USD', 'USD', 0, 1500, false, $6::date)`,
                [
                    condoId,
                    cuentaPrincipalBs.rows[0].id,
                    cuentaPagoMovilBs.rows[0].id,
                    cuentaSecundariaBs.rows[0].id,
                    cuentaUsd.rows[0].id,
                    fechaSaldoFondosSeed,
                ],
            );

            const zA = await pool.query<IIdRow>("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre A') RETURNING id", [condoId]);
            const zB = await pool.query<IIdRow>("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre B') RETURNING id", [condoId]);
            const zC = await pool.query<IIdRow>("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre C') RETURNING id", [condoId]);
            const zD = await pool.query<IIdRow>("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre D') RETURNING id", [condoId]);
            const zonas = [zA.rows[0].id, zB.rows[0].id, zC.rows[0].id, zD.rows[0].id];

            const props: number[] = [];
            let apto101Id: number | null = null;
            const alicuotasSeed = [4.0, 5.0, 6.0];
            const propConfigs: IPropConfig[] = Array.from({ length: 20 }, (_, idx) => {
                const i = idx + 1;
                let saldo = 0;
                if (i % 3 === 1) saldo = Number((10 + i * 1.75).toFixed(2));
                if (i % 3 === 2) saldo = Number((-6 - i * 1.35).toFixed(2));

                return {
                    iden: `TEST-${String(i).padStart(2, '0')}`,
                    zona: zonas[idx % zonas.length],
                    saldo,
                    alicuota: alicuotasSeed[idx % alicuotasSeed.length],
                };
            });
            if (propConfigs.length > 0) {
                propConfigs[0].iden = 'Apto 101';
            }

            for (const pc of propConfigs) {
                const p = await pool.query<IIdRow>(
                    `INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id, saldo_actual)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING id`,
                    [condoId, pc.iden, pc.alicuota, pc.zona, pc.saldo],
                );
                props.push(p.rows[0].id);
                if (pc.iden === 'Apto 101') {
                    apto101Id = p.rows[0].id;
                }
                await pool.query('INSERT INTO propiedades_zonas (propiedad_id, zona_id) VALUES ($1, $2)', [p.rows[0].id, pc.zona]);

                if (pc.saldo !== 0) {
                    await pool.query(
                        `INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota, fecha)
                         VALUES ($1, 'SALDO_INICIAL', $2, $3, CURRENT_DATE)`,
                        [
                            p.rows[0].id,
                            Math.abs(pc.saldo),
                            pc.saldo > 0 ? 'Saldo inicial de prueba (DEUDA)' : 'Saldo inicial de prueba (FAVOR)',
                        ],
                    );
                }

                const seedNum = Date.now() + props.length;
                const propCedula = buildCedula(faker, seedNum);
                const propNombre = faker.person.fullName();
                const propEmail = buildSeedEmail('prop', seedNum);
                const propTelefono = buildVzlaPhone(faker);

                const ownerUser = await pool.query<IIdRow>(
                    `INSERT INTO users (cedula, nombre, email, telefono, password)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING id`,
                    [propCedula, propNombre, propEmail, propTelefono, propCedula],
                );

                await pool.query(
                    `INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol)
                     VALUES ($1, $2, 'Propietario')`,
                    [ownerUser.rows[0].id, p.rows[0].id],
                );
            }

            const proveedorIds: number[] = [];
            for (let i = 1; i <= 8; i += 1) {
                const seedNum = Date.now() + i;
                const prov = await pool.query<IIdRow>(
                    `INSERT INTO proveedores
                        (condominio_id, identificador, nombre, email, rubro, estado_venezuela, direccion, telefono1)
                     VALUES
                        ($1, $2, $3, $4, $5, $6, $7, $8)
                     RETURNING id`,
                    [
                        condoId,
                        buildRif(seedNum),
                        `[TEST] ${faker.company.name()}`.slice(0, 120),
                        buildSeedEmail('proveedor', seedNum),
                        faker.company.buzzPhrase().slice(0, 255),
                        faker.helpers.arrayElement(VENEZUELA_ESTADOS),
                        `${faker.location.streetAddress()} - ${faker.location.city()}`.slice(0, 255),
                        buildVzlaPhone(faker),
                    ],
                );
                proveedorIds.push(prov.rows[0].id);
            }

            const gastosConfig: IGastoConfig[] = [
                { concepto: '[TEST] Limpieza y aseo general', usd: 95, tipo: 'Comun', zona: null, prop: null, cuotas: 1 },
                { concepto: '[TEST] Mantenimiento portones', usd: 120, tipo: 'Comun', zona: null, prop: null, cuotas: 1 },
                { concepto: '[TEST] Reparacion bomba hidroneumatica', usd: 160, tipo: 'Comun', zona: null, prop: null, cuotas: 1 },
                { concepto: '[TEST] Compra insumos de limpieza', usd: 80, tipo: 'Comun', zona: null, prop: null, cuotas: 1 },
                { concepto: '[TEST] Servicio vigilancia nocturna', usd: 140, tipo: 'Comun', zona: null, prop: null, cuotas: 1 },
                { concepto: '[TEST] Impermeabilizacion azotea', usd: 210, tipo: 'Comun', zona: null, prop: null, cuotas: 4 },
                { concepto: '[TEST] Reparacion ascensor Torre A', usd: 110, tipo: 'Zona', zona: zA.rows[0].id, prop: null, cuotas: 1 },
                { concepto: '[TEST] Pintura pasillos Torre B', usd: 75, tipo: 'Zona', zona: zB.rows[0].id, prop: null, cuotas: 1 },
                { concepto: '[TEST] Electricidad area comun Torre C', usd: 65, tipo: 'Zona', zona: zC.rows[0].id, prop: null, cuotas: 4 },
                { concepto: '[TEST] Mantenimiento hidroneumatico Torre D', usd: 98, tipo: 'Zona', zona: zD.rows[0].id, prop: null, cuotas: 1 },
                { concepto: '[TEST] Reparacion cerradura apto', usd: 32, tipo: 'Individual', zona: null, prop: props[0], cuotas: 1 },
                { concepto: '[TEST] Cambio luminaria apto', usd: 28, tipo: 'Individual', zona: null, prop: props[5], cuotas: 1 },
                { concepto: '[TEST] Reparacion toma de agua apto', usd: 41, tipo: 'Individual', zona: null, prop: props[10], cuotas: 4 },
                { concepto: '[TEST] Servicio tecnico aire acondicionado', usd: 55, tipo: 'Extra', zona: null, prop: null, cuotas: 4 },
                { concepto: '[TEST] Gasto extraordinario impermeabilizacion puntual', usd: 73, tipo: 'Extra', zona: null, prop: null, cuotas: 1 },
            ];

            for (const g of gastosConfig) {
                const proveedorId = faker.helpers.arrayElement(proveedorIds);
                const totalCuotas = Math.max(1, parseInt(String(g.cuotas || 1), 10));
                const fechaGastoSeed = `${mesActual}-05`;
                const clasificacionSeed = faker.helpers.arrayElement(['Fijo', 'Variable']);
                const notaSeed = buildSeedGastoNota(g.concepto);
                const gas = await pool.query<IIdRow>(
                    `INSERT INTO gastos
                        (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, nota, clasificacion, tipo, zona_id, propiedad_id, fecha_gasto)
                     VALUES
                        ($1, $2, $3, $4, 40, $5, $6, $7, $8, $9, $10, $11, $12::date)
                     RETURNING id`,
                    [condoId, proveedorId, g.concepto, g.usd * 40, g.usd, totalCuotas, notaSeed, clasificacionSeed, g.tipo, g.zona, g.prop, fechaGastoSeed],
                );

                let restante = parseFloat(String(g.usd));
                for (let i = 1; i <= totalCuotas; i += 1) {
                    const cuota = i === totalCuotas ? restante : parseFloat((g.usd / totalCuotas).toFixed(2));
                    restante = parseFloat((restante - cuota).toFixed(2));
                    await pool.query(
                        `INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, mes_asignado, estado)
                         VALUES ($1, $2, $3, $4, 'Pendiente')`,
                        [gas.rows[0].id, i, cuota, addMonthsSeed(mesActual, i - 1)],
                    );
                }
            }

            if (!apto101Id) {
                throw new Error('No se pudo determinar la propiedad Apto 101 para escenarios de prueba.');
            }
            const apto101PropId = apto101Id;

            const recibosColsRes = await pool.query<{ column_name: string }>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'recibos'
                  AND column_name IN ('fecha_emision')
                `
            );
            const recibosCols = new Set(recibosColsRes.rows.map((r) => r.column_name));

            const pagosColsRes = await pool.query<{ column_name: string }>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'pagos'
                  AND column_name IN ('nota', 'es_ajuste_historico', 'metodo')
                `
            );
            const pagosCols = new Set(pagosColsRes.rows.map((r) => r.column_name));

            // -----------------------------------------------------------
            // ESCENARIO FIFO BASE: 4 recibos pendientes consecutivos para Apto 101
            // -----------------------------------------------------------
            const recibosSeedConfig = [
                { offsetMes: 0, montoUsd: 120.00, fecha: `${mesActual}-01` },
                { offsetMes: 1, montoUsd: 95.00, fecha: `${addMonthsSeed(mesActual, 1)}-01` },
                { offsetMes: 2, montoUsd: 105.00, fecha: `${addMonthsSeed(mesActual, 2)}-01` },
                { offsetMes: 3, montoUsd: 130.00, fecha: `${addMonthsSeed(mesActual, 3)}-01` },
            ];

            const recibosApto101: Array<{ id: number; montoUsd: number; mesCobro: string }> = [];
            for (const rc of recibosSeedConfig) {
                const mesRecibo = addMonthsSeed(mesActual, rc.offsetMes);
                const mesCobro = mesCobroFromYyyyMm(mesRecibo);
                const insertCols = ['propiedad_id', 'mes_cobro', 'monto_usd', 'monto_pagado_usd', 'estado'];
                const insertVals: Array<number | string> = [apto101PropId, mesCobro, rc.montoUsd, 0, 'Pendiente'];
                if (recibosCols.has('fecha_emision')) {
                    insertCols.push('fecha_emision');
                    insertVals.push(rc.fecha);
                }
                const placeholders = insertVals.map((_, idx) => `$${idx + 1}`).join(', ');
                const reciboRes = await pool.query<IIdRow>(
                    `INSERT INTO recibos (${insertCols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
                    insertVals
                );
                recibosApto101.push({ id: reciboRes.rows[0].id, montoUsd: rc.montoUsd, mesCobro });
            }

            const cuentaSeedId = cuentaPrincipalBs.rows[0].id;
            const upsertPagoSeed = async (input: {
                fechaPago: string;
                montoUsd: number;
                referencia: string;
                nota: string;
                esAjusteHistorico?: boolean;
            }): Promise<void> => {
                const montoOrigen = Number((input.montoUsd * tasaCambioSeed).toFixed(2));
                const insertCols = [
                    'propiedad_id',
                    'recibo_id',
                    'cuenta_bancaria_id',
                    'monto_origen',
                    'tasa_cambio',
                    'monto_usd',
                    'moneda',
                    'referencia',
                    'fecha_pago',
                    'estado',
                ];
                const insertVals: Array<number | string | null | boolean> = [
                    apto101PropId,
                    null,
                    cuentaSeedId,
                    montoOrigen,
                    tasaCambioSeed,
                    input.montoUsd,
                    'BS',
                    input.referencia,
                    input.fechaPago,
                    'Pendiente',
                ];
                if (pagosCols.has('metodo')) {
                    insertCols.push('metodo');
                    insertVals.push('Transferencia');
                }
                if (pagosCols.has('nota')) {
                    insertCols.push('nota');
                    insertVals.push(input.nota);
                }
                if (pagosCols.has('es_ajuste_historico')) {
                    insertCols.push('es_ajuste_historico');
                    insertVals.push(Boolean(input.esAjusteHistorico));
                }
                const placeholders = insertVals.map((_, idx) => `$${idx + 1}`).join(', ');
                await pool.query(
                    `INSERT INTO pagos (${insertCols.join(', ')}) VALUES (${placeholders})`,
                    insertVals
                );
            };

            // -----------------------------------------------------------
            // ESCENARIO A: Pago Histórico (anterior a fecha_saldo de fondos)
            // -----------------------------------------------------------
            await upsertPagoSeed({
                fechaPago: '2023-12-15',
                montoUsd: 75.00,
                referencia: '[TEST][HIST] PAGO-APTO101-20231215',
                nota: 'Escenario A: regularizacion historica previa a fecha_saldo.',
                esAjusteHistorico: true,
            });

            // -----------------------------------------------------------
            // ESCENARIO B: Pago Parcial (mitad exacta del primer recibo pendiente)
            // -----------------------------------------------------------
            const mitadPrimerReciboUsd = Number((recibosApto101[0].montoUsd / 2).toFixed(2));
            await upsertPagoSeed({
                fechaPago: `${mesActual}-10`,
                montoUsd: mitadPrimerReciboUsd,
                referencia: '[TEST][PARCIAL] PAGO-APTO101-MITAD-R1',
                nota: 'Escenario B: pago parcial, mitad exacta del primer recibo.',
            });

            // -----------------------------------------------------------
            // ESCENARIO C: Pago Múltiple/Cascada (cubre R1 + R2 y deja saldo a favor)
            // -----------------------------------------------------------
            const montoCascadaUsd = Number((recibosApto101[0].montoUsd + recibosApto101[1].montoUsd + 35).toFixed(2));
            await upsertPagoSeed({
                fechaPago: `${mesActual}-15`,
                montoUsd: montoCascadaUsd,
                referencia: '[TEST][CASCADA] PAGO-APTO101-R1-R2-FAVOR',
                nota: 'Escenario C: pago en cascada, cubre recibo 1 y 2, dejando saldo a favor.',
            });

            await pool.query('COMMIT');
            res.json({
                status: 'success',
                message: 'Simulacion lista: fondos con fecha_saldo, propiedad Apto 101 con recibos FIFO y pagos escenario historico/parcial/cascada.',
            });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerDashboardRoutes };

