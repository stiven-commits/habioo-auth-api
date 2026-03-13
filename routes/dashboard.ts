import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { Faker } from '@faker-js/faker';

interface AuthUser {
    id: number;
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
}

interface IMisPropiedadRow extends Record<string, unknown> {
    condominio_nombre: string;
}

interface ITotalDeudaRow {
    total_deuda: string | null;
}

interface ICuentaPorCobrarRow extends Record<string, unknown> {
    apto: string;
}

interface IPropConfig {
    iden: string;
    zona: number;
    saldo: number;
}

interface IGastoConfig {
    concepto: string;
    usd: number;
    tipo: 'Comun' | 'No Comun' | 'Zona' | 'Individual' | 'Extra';
    zona: number | null;
    prop: number | null;
    cuotas: number;
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

    app.get('/cuentas-por-cobrar', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const c = await pool.query<IIdRow>(
                'SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1',
                [user.id],
            );
            if (c.rows.length === 0) return res.status(403).json({ error: 'No autorizado' });
            const condoId = c.rows[0].id;

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
            const user = asAuthUser(req.user);
            const faker = await getFaker();

            await pool.query('BEGIN');

            const condoRes = await pool.query<ICondominioAdminRow>(
                'SELECT id, mes_actual FROM condominios WHERE admin_user_id = $1 LIMIT 1',
                [user.id],
            );

            if (condoRes.rows.length === 0) {
                throw new Error('Condominio no encontrado para este administrador.');
            }

            const condoId = condoRes.rows[0].id;
            const now = new Date();
            const mesAnteriorDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
            const mesActual = `${mesAnteriorDate.getUTCFullYear()}-${String(mesAnteriorDate.getUTCMonth() + 1).padStart(2, '0')}`;
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

            await pool.query(
                `DELETE FROM users u
                 WHERE u.email ILIKE '%@seed.habioo.test'
                   AND NOT EXISTS (SELECT 1 FROM usuarios_propiedades up WHERE up.user_id = u.id)
                   AND u.id <> $1`,
                [user.id],
            );

            // 2) Datos de prueba frescos
            const nombresBancos = ['Banco de Venezuela', 'Banesco', 'Mercantil', 'Provincial', 'Bancamiga'];
            const cuenta1 = await pool.query<IIdRow>(
                `INSERT INTO cuentas_bancarias
                    (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada)
                 VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, true)
                 RETURNING id`,
                [
                    condoId,
                    faker.finance.accountNumber({ length: 20 }),
                    faker.helpers.arrayElement(nombresBancos),
                    '[TEST] Cuenta Principal',
                    'Transferencia',
                    faker.person.fullName(),
                    `J${faker.string.numeric(9)}`,
                    buildVzlaPhone(faker),
                ],
            );

            await pool.query(
                `INSERT INTO fondos
                    (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo)
                 VALUES
                    ($1, $2, '[TEST] Fondo Operativo Principal', 'BS', 0, 8000, true)`,
                [condoId, cuenta1.rows[0].id],
            );

            const cuenta2 = await pool.query<IIdRow>(
                `INSERT INTO cuentas_bancarias
                    (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono, es_predeterminada)
                 VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, false)
                 RETURNING id`,
                [
                    condoId,
                    faker.finance.accountNumber({ length: 20 }),
                    faker.helpers.arrayElement(nombresBancos),
                    '[TEST] Cuenta Secundaria',
                    'Transferencia',
                    faker.person.fullName(),
                    `J${faker.string.numeric(9)}`,
                    buildVzlaPhone(faker),
                ],
            );

            await pool.query(
                `INSERT INTO fondos
                    (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo)
                 VALUES
                    ($1, $2, '[TEST] Fondo Reserva General', 'BS', 0, 3200, false),
                    ($1, $2, '[TEST] Fondo Prestaciones Empleados', 'USD', 0, 1500, false)`,
                [condoId, cuenta2.rows[0].id],
            );

            const zA = await pool.query<IIdRow>("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre A') RETURNING id", [condoId]);
            const zB = await pool.query<IIdRow>("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre B') RETURNING id", [condoId]);
            const zC = await pool.query<IIdRow>("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre C') RETURNING id", [condoId]);
            const zD = await pool.query<IIdRow>("INSERT INTO zonas (condominio_id, nombre) VALUES ($1, 'TEST-Torre D') RETURNING id", [condoId]);
            const zonas = [zA.rows[0].id, zB.rows[0].id, zC.rows[0].id, zD.rows[0].id];

            const props: number[] = [];
            const propConfigs: IPropConfig[] = Array.from({ length: 20 }, (_, idx) => {
                const i = idx + 1;
                let saldo = 0;
                if (i % 3 === 1) saldo = Number((10 + i * 1.75).toFixed(2));
                if (i % 3 === 2) saldo = Number((-6 - i * 1.35).toFixed(2));

                return {
                    iden: `TEST-${String(i).padStart(2, '0')}`,
                    zona: zonas[idx % zonas.length],
                    saldo,
                };
            });

            for (const pc of propConfigs) {
                const p = await pool.query<IIdRow>(
                    `INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id, saldo_actual)
                     VALUES ($1, $2, 5.00, $3, $4)
                     RETURNING id`,
                    [condoId, pc.iden, pc.zona, pc.saldo],
                );
                props.push(p.rows[0].id);
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
                const gas = await pool.query<IIdRow>(
                    `INSERT INTO gastos
                        (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, tipo, zona_id, propiedad_id, fecha_gasto)
                     VALUES
                        ($1, $2, $3, $4, 40, $5, $6, $7, $8, $9, $10::date)
                     RETURNING id`,
                    [condoId, proveedorId, g.concepto, g.usd * 40, g.usd, totalCuotas, g.tipo, g.zona, g.prop, fechaGastoSeed],
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

            await pool.query('COMMIT');
            res.json({
                status: 'success',
                message: 'Simulacion lista: 20 inmuebles, 8 proveedores, 2 cuentas (3 fondos) y 15 gastos (incluye 2 Extra y cuotas diferidas).',
            });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerDashboardRoutes };

