import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

interface AuthUser {
    id: number;
    cedula?: string;
}

interface OptionalPagosColumns {
    nota?: boolean;
    cedula_origen?: boolean;
    banco_origen?: boolean;
    [key: string]: boolean | undefined;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
    parseLocaleNumber: (value: unknown) => number;
    getPagosOptionalColumns: () => Promise<OptionalPagosColumns>;
}

interface QueryClient {
    query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

interface IConstraintDefRow {
    def: string;
}

interface IColumnNameRow {
    column_name: string;
}

interface IPropiedadMetodoRow {
    id: number;
    alicuota: string | number;
    condominio_id: number;
    metodo_division: string;
}

interface IZonaIdRow {
    zona_id: number;
}

interface ICountTotalRow {
    total: string | number;
}

interface ICuotaDetalleRow {
    cuota_id: number | string;
    numero_cuota: number | string;
    monto_cuota_usd: string | number;
    gasto_id: number | string;
    tipo: string;
    zona_id: number | null;
    propiedad_id: number | string | null;
}

interface IReciboRow {
    id: number;
    propiedad_id: number;
    mes_cobro: string | null;
    monto_usd: string | number;
    monto_pagado_usd: string | number | null;
    estado: string;
    fecha_emision: string | Date;
}

interface IFondoActivoRow {
    id: number;
    moneda: string;
    porcentaje_asignacion: string | number;
    es_operativo: boolean;
}

interface IPagoInsertRow {
    id: number;
}

interface IPagoPendienteRow {
    id: number;
    monto_usd: string | number;
    propiedad_id: number;
    estado: string;
}

interface AbonoFondosInput {
    cuentaId: string | number;
    montoDistribuibleUsd: number;
    tasaNum: number;
    pagoId: number | null;
    referencia: string | null;
}

interface GastoBreakdownItem {
    gastoId: number;
    tipo: string;
    shareUsd: number;
}

interface ImputacionResultado {
    montoExtraUsd: number;
    montoDistribuibleUsd: number;
}

interface PagosAdminBody {
    propiedad_id: string | number;
    cuenta_id: string | number;
    monto_origen: unknown;
    tasa_cambio: unknown;
    referencia?: string | null;
    fecha_pago?: string | Date | null;
    nota?: string | null;
    cedula_origen?: string | null;
    banco_origen?: string | null;
    moneda?: string | null;
}

interface PagoValidarParams {
    id?: string;
}

interface PagoProveedorOrigenBody {
    cuenta_bancaria_id: number | string;
    fondo_id?: number | string | null;
    moneda: 'Bs' | 'USD';
    monto_origen: number | string;
    tasa_cambio: number | string;
    monto_usd: number | string;
}

interface PagoProveedorBody {
    gasto_id: number | string;
    fecha: string;
    referencia: string;
    nota?: string | null;
    origenes: PagoProveedorOrigenBody[];
}

interface GastoMontoRow {
    id?: number;
    monto_usd: number | string;
    monto_pagado_usd: number | string;
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

const registerPagosRoutes = (app: Application, { pool, verifyToken, parseLocaleNumber, getPagosOptionalColumns }: AuthDependencies): void => {
    const resolveMovimientoFondoTipo = async (preferred: string[], fallback: string): Promise<string> => {
        try {
            const r = await pool.query<IConstraintDefRow>(`
                SELECT pg_get_constraintdef(oid) AS def
                FROM pg_constraint
                WHERE conname = 'movimientos_fondos_tipo_check'
                LIMIT 1
            `);
            const def = r.rows?.[0]?.def || '';
            const matches = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
            const allowed = new Set(matches);

            const selected = preferred.find((t) => allowed.has(t));
            if (selected) return selected;
            if (matches.length > 0) return matches[0];
        } catch (_err) {
            // fallback below
        }
        return fallback;
    };

    const round2 = (n: unknown): number => parseFloat((parseFloat(String(n || 0))).toFixed(2));

    const getPagosColumns = async (): Promise<OptionalPagosColumns & { propiedad_id: boolean }> => {
        const optionalCols = await getPagosOptionalColumns();
        try {
            const result = await pool.query<IColumnNameRow>(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'pagos'
                  AND column_name IN ('propiedad_id')
            `);
            const cols = new Set(result.rows.map((r) => r.column_name));
            return { ...optionalCols, propiedad_id: cols.has('propiedad_id') };
        } catch (_err) {
            return { ...optionalCols, propiedad_id: false };
        }
    };

    const parseMesCobroToYyyyMm = (mesCobro: unknown): string | null => {
        if (!mesCobro) return null;
        const clean = String(mesCobro).trim().toLowerCase().replace(/\s+/g, ' ');
        const monthMap: Record<string, string> = {
            enero: '01',
            febrero: '02',
            marzo: '03',
            abril: '04',
            mayo: '05',
            junio: '06',
            julio: '07',
            agosto: '08',
            septiembre: '09',
            setiembre: '09',
            octubre: '10',
            noviembre: '11',
            diciembre: '12',
        };
        const m = clean.match(/^([a-z\u00f1]+)\s+(\d{4})$/i);
        if (!m) return null;
        const mm = monthMap[m[1]];
        if (!mm) return null;
        return `${m[2]}-${mm}`;
    };

    // Obtiene el detalle prorrateado del recibo por gasto origen (necesario para detectar tipo 'Extra').
    const buildReciboBreakdownByGasto = async (client: QueryClient, recibo: IReciboRow): Promise<GastoBreakdownItem[]> => {
        const propiedadId = recibo?.propiedad_id;
        const mesAsignado = parseMesCobroToYyyyMm(recibo?.mes_cobro);
        if (!propiedadId || !mesAsignado) return [];

        const propRes = await client.query<IPropiedadMetodoRow>(
            `
            SELECT p.id, p.alicuota, p.condominio_id, c.metodo_division
            FROM propiedades p
            JOIN condominios c ON c.id = p.condominio_id
            WHERE p.id = $1
            LIMIT 1
            `,
            [propiedadId]
        );
        if (propRes.rows.length === 0) return [];

        const { condominio_id: condominioId, alicuota, metodo_division: metodoDivision } = propRes.rows[0];

        const zonasRes = await client.query<IZonaIdRow>('SELECT zona_id FROM propiedades_zonas WHERE propiedad_id = $1', [propiedadId]);
        const zonaIds = new Set(zonasRes.rows.map((z) => z.zona_id));

        const totalPropsRes = await client.query<ICountTotalRow>('SELECT COUNT(*)::int AS total FROM propiedades WHERE condominio_id = $1', [condominioId]);
        const totalProps = parseInt(String(totalPropsRes.rows[0]?.total || 0), 10);

        // SQL: cuotas del mismo mes del recibo + tipo del gasto.
        const cuotasRes = await client.query<ICuotaDetalleRow>(
            `
            SELECT
                gc.id AS cuota_id,
                gc.numero_cuota,
                gc.monto_cuota_usd,
                g.id AS gasto_id,
                g.tipo,
                g.zona_id,
                g.propiedad_id
            FROM gastos_cuotas gc
            JOIN gastos g ON g.id = gc.gasto_id
            WHERE g.condominio_id = $1
              AND gc.mes_asignado = $2
              AND gc.estado IN ('Procesado', 'Pendiente')
            ORDER BY g.id ASC, gc.numero_cuota ASC
            `,
            [condominioId, mesAsignado]
        );

        const detail: GastoBreakdownItem[] = [];
        for (const c of cuotasRes.rows) {
            const montoCuota = parseFloat(String(c.monto_cuota_usd || 0));
            if (montoCuota <= 0) continue;

            let share = 0;
            if (c.tipo === 'Comun' || c.tipo === 'Extra') {
                if (metodoDivision === 'Partes Iguales') {
                    share = totalProps > 0 ? (montoCuota / totalProps) : 0;
                } else {
                    share = montoCuota * (parseFloat(String(alicuota || 0)) / 100);
                }
            } else if (c.tipo === 'No Comun' || c.tipo === 'Zona') {
                if (c.zona_id === null || !zonaIds.has(c.zona_id)) continue;
                if (metodoDivision === 'Partes Iguales') {
                    const propsZonaRes = await client.query<ICountTotalRow>('SELECT COUNT(*)::int AS total FROM propiedades_zonas WHERE zona_id = $1', [c.zona_id]);
                    const totalZona = parseInt(String(propsZonaRes.rows[0]?.total || 0), 10);
                    share = totalZona > 0 ? (montoCuota / totalZona) : 0;
                } else {
                    const sumAlRes = await client.query<ICountTotalRow>(
                        `
                        SELECT COALESCE(SUM(p.alicuota), 0) AS total
                        FROM propiedades p
                        JOIN propiedades_zonas pz ON pz.propiedad_id = p.id
                        WHERE pz.zona_id = $1
                        `,
                        [c.zona_id]
                    );
                    const totalAlZona = parseFloat(String(sumAlRes.rows[0]?.total || 0));
                    share = totalAlZona > 0 ? (montoCuota * (parseFloat(String(alicuota || 0)) / totalAlZona)) : 0;
                }
            } else if (c.tipo === 'Individual' && parseInt(String(c.propiedad_id), 10) === parseInt(String(propiedadId), 10)) {
                share = montoCuota;
            }

            if (share > 0) {
                detail.push({
                    gastoId: parseInt(String(c.gasto_id), 10),
                    tipo: c.tipo,
                    shareUsd: round2(share),
                });
            }
        }

        if (detail.length === 0) return [];

        const grouped = new Map<string, GastoBreakdownItem>();
        for (const d of detail) {
            const key = `${d.gastoId}:${d.tipo}`;
            const prev = grouped.get(key) || { gastoId: d.gastoId, tipo: d.tipo, shareUsd: 0 };
            prev.shareUsd = round2(prev.shareUsd + d.shareUsd);
            grouped.set(key, prev);
        }
        const groupedList = [...grouped.values()].sort((a, b) => a.gastoId - b.gastoId);

        // Ajuste por redondeo para que cuadre con monto_usd del recibo.
        const totalBreakdown = round2(groupedList.reduce((acc, x) => acc + x.shareUsd, 0));
        const montoRecibo = round2(recibo?.monto_usd || 0);
        if (groupedList.length > 0 && totalBreakdown > 0 && montoRecibo > 0 && Math.abs(totalBreakdown - montoRecibo) > 0.01) {
            const ratio = montoRecibo / totalBreakdown;
            let acumulado = 0;
            for (let i = 0; i < groupedList.length; i += 1) {
                if (i === groupedList.length - 1) {
                    groupedList[i].shareUsd = round2(montoRecibo - acumulado);
                } else {
                    groupedList[i].shareUsd = round2(groupedList[i].shareUsd * ratio);
                    acumulado = round2(acumulado + groupedList[i].shareUsd);
                }
            }
        }

        return groupedList;
    };

    // Imputa el abono aplicado al recibo en gastos.monto_pagado_usd y separa cuanto corresponde a tipo 'Extra'.
    const imputarReciboEnGastos = async (client: QueryClient, recibo: IReciboRow, montoAplicadoUsd: number): Promise<ImputacionResultado> => {
        const montoAplicado = round2(montoAplicadoUsd);
        if (montoAplicado <= 0) return { montoExtraUsd: 0, montoDistribuibleUsd: 0 };

        const breakdown = await buildReciboBreakdownByGasto(client, recibo);
        if (breakdown.length === 0) {
            return { montoExtraUsd: 0, montoDistribuibleUsd: montoAplicado };
        }

        const rows = breakdown.map((b) => ({ ...b, restante: round2(b.shareUsd) }));

        // Simulamos lo ya pagado del recibo para calcular el restante real por gasto.
        let pagadoPrevio = round2(recibo?.monto_pagado_usd || 0);
        for (const row of rows) {
            if (pagadoPrevio <= 0) break;
            const aplicadoAntes = Math.min(row.restante, pagadoPrevio);
            row.restante = round2(row.restante - aplicadoAntes);
            pagadoPrevio = round2(pagadoPrevio - aplicadoAntes);
        }

        let faltanteAplicar = montoAplicado;
        let extraAplicado = 0;

        for (const row of rows) {
            if (faltanteAplicar <= 0) break;
            if (row.restante <= 0) continue;

            const aplicar = Math.min(row.restante, faltanteAplicar);
            if (aplicar <= 0) continue;

            // SQL: control de deuda por proveedor acumulando pago al gasto.
            await client.query(
                `
                UPDATE gastos
                SET monto_pagado_usd = LEAST(COALESCE(monto_usd, 0), COALESCE(monto_pagado_usd, 0) + $1)
                WHERE id = $2
                `,
                [aplicar, row.gastoId]
            );

            if (row.tipo === 'Extra') {
                extraAplicado = round2(extraAplicado + aplicar);
            }
            faltanteAplicar = round2(faltanteAplicar - aplicar);
        }

        return {
            montoExtraUsd: extraAplicado,
            montoDistribuibleUsd: round2(Math.max(0, montoAplicado - extraAplicado)),
        };
    };

    // Distribuye SOLO el monto no-Extra en fondos + movimientos_fondos.
    const distribuirAbonoEnFondos = async (client: QueryClient, { cuentaId, montoDistribuibleUsd, tasaNum, pagoId, referencia }: AbonoFondosInput): Promise<void> => {
        const montoUsd = round2(montoDistribuibleUsd);
        if (montoUsd <= 0) return;

        const fondosRes = await client.query<IFondoActivoRow>(
            `
            SELECT id, moneda, porcentaje_asignacion, es_operativo
            FROM fondos
            WHERE cuenta_bancaria_id = $1 AND activo = true
            ORDER BY es_operativo DESC, id ASC
            `,
            [cuentaId]
        );
        const fondosActivos = fondosRes.rows || [];
        if (fondosActivos.length === 0) {
            throw new Error('La cuenta seleccionada no tiene fondos activos para distribuir el abono.');
        }

        const noOperativos = fondosActivos.filter((f) => !f.es_operativo);
        const fondoPrincipal = fondosActivos.find((f) => !!f.es_operativo) || null;
        const totalPctNoOper = noOperativos.reduce((acc, f) => acc + parseFloat(String(f.porcentaje_asignacion || 0)), 0);
        if (totalPctNoOper > 100) {
            throw new Error('La suma de porcentajes de fondos excede 100%. Ajuste la configuracion de fondos.');
        }

        const distUsd: Array<IFondoActivoRow & { montoUsdParte: number }> = [];
        let acumuladoUsd = 0;
        noOperativos.forEach((f) => {
            const pct = parseFloat(String(f.porcentaje_asignacion || 0));
            const parte = round2((montoUsd * pct) / 100);
            acumuladoUsd = round2(acumuladoUsd + parte);
            distUsd.push({ ...f, montoUsdParte: parte });
        });

        const remanenteUsd = round2(montoUsd - acumuladoUsd);
        if (fondoPrincipal) {
            distUsd.push({ ...fondoPrincipal, montoUsdParte: remanenteUsd });
        } else if (distUsd.length > 0) {
            distUsd[distUsd.length - 1].montoUsdParte = round2(distUsd[distUsd.length - 1].montoUsdParte + remanenteUsd);
        } else {
            distUsd.push({ ...fondosActivos[0], montoUsdParte: montoUsd });
        }

        const tipoMovimiento = await resolveMovimientoFondoTipo(['ABONO', 'ENTRADA', 'INGRESO', 'AJUSTE_INICIAL'], 'AJUSTE_INICIAL');
        for (const d of distUsd) {
            const usdParte = round2(d.montoUsdParte || 0);
            if (usdParte <= 0) continue;

            let montoFondo = usdParte;
            if (d.moneda === 'BS') {
                if (!tasaNum || tasaNum <= 0) {
                    throw new Error('No hay tasa de cambio valida para abonar un fondo en Bs.');
                }
                montoFondo = round2(usdParte * tasaNum);
            }

            await client.query('UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2', [montoFondo, d.id]);
            await client.query(
                'INSERT INTO movimientos_fondos (fondo_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
                [d.id, tipoMovimiento, montoFondo, `Abono distribuible de pago${pagoId ? ` #${pagoId}` : ''} (${referencia || 'sin referencia'})`]
            );
        }
    };

    // Ruta de administradores para registrar y aprobar pagos en cascada al instante.
    app.post('/pagos-admin', verifyToken, async (req: Request<{}, unknown, PagosAdminBody>, res: Response, _next: NextFunction) => {
        const { propiedad_id, cuenta_id, monto_origen, tasa_cambio, referencia, fecha_pago, nota, cedula_origen, banco_origen, moneda } = req.body;

        try {
            await pool.query('BEGIN');

            // 1. Calculamos montos normalizados.
            const monedaFinal = moneda || 'BS';
            const montoOrigenNum = parseLocaleNumber(monto_origen);
            const tasaNum = monedaFinal === 'BS' ? (parseLocaleNumber(tasa_cambio) || 1) : 1;
            const montoUsd = monedaFinal === 'BS' ? round2(montoOrigenNum / tasaNum) : round2(montoOrigenNum);

            // 2. Insertamos el pago ya Validado (registro administrativo).
            const optionalCols = await getPagosColumns();
            const insertColumns = [
                'propiedad_id',
                'recibo_id',
                'cuenta_bancaria_id',
                'monto_origen',
                'tasa_cambio',
                'monto_usd',
                'moneda',
                'referencia',
                'fecha_pago',
                'metodo',
                'estado',
            ];
            const insertValues: unknown[] = [
                propiedad_id,
                null,
                cuenta_id,
                montoOrigenNum,
                monedaFinal === 'BS' ? tasaNum : null,
                montoUsd,
                monedaFinal,
                referencia || null,
                fecha_pago || new Date(),
                'Transferencia',
                'Validado',
            ];

            if (optionalCols.nota) {
                insertColumns.push('nota');
                insertValues.push(nota || null);
            }
            if (optionalCols.cedula_origen) {
                insertColumns.push('cedula_origen');
                insertValues.push(cedula_origen || null);
            }
            if (optionalCols.banco_origen) {
                insertColumns.push('banco_origen');
                insertValues.push(banco_origen || null);
            }

            const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ');
            const pagoInsertRes = await pool.query<IPagoInsertRow>(
                `INSERT INTO pagos (${insertColumns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
                insertValues
            );
            const pagoId = pagoInsertRes.rows?.[0]?.id || null;

            // 3. Restamos el pago al saldo consolidado de la propiedad.
            await pool.query('UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) - $1 WHERE id = $2', [montoUsd, propiedad_id]);

            // 4. Cascada FIFO por recibos + imputacion por tipo de gasto.
            let dineroRestante = montoUsd;
            let montoDistribuibleFondos = 0;

            const recibosPendientes = await pool.query<IReciboRow>(
                "SELECT * FROM recibos WHERE propiedad_id = $1 AND estado != 'Pagado' ORDER BY fecha_emision ASC, id ASC",
                [propiedad_id]
            );

            for (const rec of recibosPendientes.rows) {
                if (dineroRestante <= 0) break;

                const deudaRecibo = round2(parseFloat(String(rec.monto_usd || 0)) - parseFloat(String(rec.monto_pagado_usd || 0)));
                if (deudaRecibo <= 0) {
                    await pool.query("UPDATE recibos SET estado = 'Pagado' WHERE id = $1", [rec.id]);
                    continue;
                }

                const montoAplicadoRecibo = Math.min(dineroRestante, deudaRecibo);

                if (dineroRestante >= deudaRecibo) {
                    await pool.query("UPDATE recibos SET monto_pagado_usd = monto_usd, estado = 'Pagado' WHERE id = $1", [rec.id]);
                    dineroRestante = round2(dineroRestante - deudaRecibo);
                } else {
                    await pool.query(
                        "UPDATE recibos SET monto_pagado_usd = COALESCE(monto_pagado_usd, 0) + $1, estado = 'Abonado' WHERE id = $2",
                        [dineroRestante, rec.id]
                    );
                    dineroRestante = 0;
                }

                // SQL + JS: separar porcion Extra y actualizar monto_pagado_usd en gastos.
                const { montoDistribuibleUsd } = await imputarReciboEnGastos(pool, rec, montoAplicadoRecibo);
                montoDistribuibleFondos = round2(montoDistribuibleFondos + montoDistribuibleUsd);
            }

            // Si sobro dinero, queda como saldo a favor y es distribuible en fondos (no proviene de gasto Extra).
            if (dineroRestante > 0) {
                montoDistribuibleFondos = round2(montoDistribuibleFondos + dineroRestante);
            }

            // 5. Distribucion en fondos: solo monto no-Extra.
            // Regla requerida: el componente Extra no genera movimientos_fondos.
            await distribuirAbonoEnFondos(pool, {
                cuentaId: cuenta_id,
                montoDistribuibleUsd: montoDistribuibleFondos,
                tasaNum,
                pagoId,
                referencia: referencia || null,
            });

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Pago registrado y saldos distribuidos exitosamente en la propiedad.' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    // Validacion manual de pagos pendientes (FIFO por recibos de la propiedad).
    app.post('/pagos/:id/validar', verifyToken, async (req: Request<PagoValidarParams>, res: Response, _next: NextFunction) => {
        const pagoId = asString(req.params.id);

        try {
            await pool.query('BEGIN');

            const pagoRes = await pool.query<IPagoPendienteRow>('SELECT * FROM pagos WHERE id = $1 AND estado = $2', [pagoId, 'Pendiente']);
            if (pagoRes.rows.length === 0) throw new Error('Pago no encontrado o ya fue procesado.');

            const pago = pagoRes.rows[0];
            const montoAprobado = round2(parseFloat(String(pago.monto_usd || 0)));
            const propiedadId = pago.propiedad_id;

            await pool.query("UPDATE pagos SET estado = 'Validado' WHERE id = $1", [pagoId]);
            await pool.query('UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) - $1 WHERE id = $2', [montoAprobado, propiedadId]);

            let dineroRestante = montoAprobado;
            const recibosPendientes = await pool.query<IReciboRow>(
                "SELECT * FROM recibos WHERE propiedad_id = $1 AND estado != 'Pagado' ORDER BY fecha_emision ASC, id ASC",
                [propiedadId]
            );

            for (const rec of recibosPendientes.rows) {
                if (dineroRestante <= 0) break;

                const deudaRecibo = round2(parseFloat(String(rec.monto_usd || 0)) - parseFloat(String(rec.monto_pagado_usd || 0)));
                if (deudaRecibo <= 0) {
                    await pool.query("UPDATE recibos SET estado = 'Pagado' WHERE id = $1", [rec.id]);
                    continue;
                }

                const montoAplicadoRecibo = Math.min(dineroRestante, deudaRecibo);

                if (dineroRestante >= deudaRecibo) {
                    await pool.query("UPDATE recibos SET monto_pagado_usd = monto_usd, estado = 'Pagado' WHERE id = $1", [rec.id]);
                    dineroRestante = round2(dineroRestante - deudaRecibo);
                } else {
                    await pool.query(
                        "UPDATE recibos SET monto_pagado_usd = COALESCE(monto_pagado_usd, 0) + $1, estado = 'Abonado' WHERE id = $2",
                        [dineroRestante, rec.id]
                    );
                    dineroRestante = 0;
                }

                // Tambien actualizamos el control de pago por gasto en validaciones manuales.
                await imputarReciboEnGastos(pool, rec, montoAplicadoRecibo);
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Pago aprobado y saldos distribuidos en cascada correctamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/pagos-proveedores', verifyToken, async (req: Request<{}, unknown, PagoProveedorBody>, res: Response) => {
        const { gasto_id, fecha, nota, origenes } = req.body;
        let txStarted = false;

        try {
            if (!gasto_id) {
                return res.status(400).json({ status: 'error', message: 'gasto_id es requerido.' });
            }
            if (!fecha) {
                return res.status(400).json({ status: 'error', message: 'fecha es requerida.' });
            }
            if (!Array.isArray(origenes) || origenes.length === 0) {
                return res.status(400).json({ status: 'error', message: 'origenes debe contener al menos un registro.' });
            }

            const origenesNormalizados = origenes.map((origen: PagoProveedorOrigenBody & { referencia?: string | null }) => {
                const cuentaId = parseInt(String(origen.cuenta_bancaria_id), 10);
                const fondoId = origen.fondo_id === null || origen.fondo_id === undefined || String(origen.fondo_id) === ''
                    ? null
                    : parseInt(String(origen.fondo_id), 10);
                const moneda = origen.moneda;
                const montoOrigen = round2(parseLocaleNumber(origen.monto_origen));
                const montoUsd = round2(parseLocaleNumber(origen.monto_usd));
                const referenciaOrigen = typeof origen.referencia === 'string' ? origen.referencia.trim() : '';
                const tasaCambio = moneda === 'USD' ? 1 : round2(parseLocaleNumber(origen.tasa_cambio));

                if (!Number.isFinite(cuentaId) || cuentaId <= 0) {
                    throw new Error('Cada origen debe incluir un cuenta_bancaria_id válido.');
                }
                if (moneda !== 'Bs' && moneda !== 'USD') {
                    throw new Error("Cada origen debe incluir una moneda válida ('Bs' o 'USD').");
                }
                if (!Number.isFinite(montoOrigen) || montoOrigen <= 0) {
                    throw new Error('Cada origen debe incluir monto_origen mayor a 0.');
                }
                if (!Number.isFinite(montoUsd) || montoUsd <= 0) {
                    throw new Error('Cada origen debe incluir monto_usd mayor a 0.');
                }
                if (moneda === 'Bs' && (!Number.isFinite(tasaCambio) || tasaCambio <= 0)) {
                    throw new Error('Cada origen debe incluir una tasa_cambio válida mayor a 0.');
                }

                return {
                    cuentaId,
                    fondoId,
                    moneda,
                    montoOrigen,
                    tasaCambio,
                    montoUsd,
                    referencia: referenciaOrigen || 'N/A',
                };
            });

            const montoTotalPagoUsd = round2(
                origenesNormalizados.reduce((acc: number, origen) => acc + origen.montoUsd, 0)
            );
            if (montoTotalPagoUsd <= 0) {
                return res.status(400).json({ status: 'error', message: 'El pago total en USD debe ser mayor a 0.' });
            }

            await pool.query('BEGIN');
            txStarted = true;

            const gastoUpdate = await pool.query<GastoMontoRow>(
                `
                UPDATE gastos
                SET monto_pagado_usd = COALESCE(monto_pagado_usd, 0) + $1
                WHERE id = $2
                RETURNING id, monto_usd, monto_pagado_usd
                `,
                [montoTotalPagoUsd, gasto_id]
            );

            if (gastoUpdate.rows.length === 0) {
                throw new Error('Gasto no encontrado.');
            }

            const gastoActualizado = gastoUpdate.rows[0];
            const montoTotalGastoUsd = round2(parseLocaleNumber(gastoActualizado.monto_usd));
            const montoPagadoGastoUsd = round2(parseLocaleNumber(gastoActualizado.monto_pagado_usd));
            if (montoPagadoGastoUsd - montoTotalGastoUsd > 0.009) {
                throw new Error('El pago excede el monto total del gasto.');
            }

            const totalBs = round2(
                origenesNormalizados.reduce((acc: number, origen) => acc + origen.montoOrigen, 0)
            );

            const pagoProveedorRes = await pool.query<IPagoInsertRow>(
                `
                INSERT INTO pagos_proveedores (gasto_id, fondo_id, monto_bs, tasa_cambio, monto_usd, referencia, fecha_pago, nota)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
                `,
                [gasto_id, null, totalBs > 0 ? totalBs : null, null, montoTotalPagoUsd, null, fecha, nota || null]
            );
            const pagoProveedorId = pagoProveedorRes.rows[0]?.id;
            if (!pagoProveedorId) {
                throw new Error('No se pudo crear el pago proveedor.');
            }

            const cuentaSaldoColRes = await pool.query<IColumnNameRow>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'cuentas_bancarias'
                  AND column_name IN ('saldo_actual', 'saldo')
                LIMIT 1
                `
            );
            const cuentaSaldoCol = cuentaSaldoColRes.rows[0]?.column_name || null;

            for (const origen of origenesNormalizados) {
                if (cuentaSaldoCol) {
                    await pool.query(
                        `UPDATE cuentas_bancarias SET ${cuentaSaldoCol} = COALESCE(${cuentaSaldoCol}, 0) - $1 WHERE id = $2`,
                        [origen.montoOrigen, origen.cuentaId]
                    );
                }

                if (origen.fondoId) {
                    const fondoRes = await pool.query<{ id: number; saldo_actual: string | number; moneda: string }>(
                        `
                        SELECT id, saldo_actual, moneda
                        FROM fondos
                        WHERE id = $1
                        FOR UPDATE
                        `,
                        [origen.fondoId]
                    );
                    if (fondoRes.rows.length === 0) {
                        throw new Error(`Fondo ${origen.fondoId} no encontrado.`);
                    }

                    const fondo = fondoRes.rows[0];
                    const monedaFondo = String(fondo.moneda || '').toUpperCase();
                    const montoDebitarFondo = monedaFondo === 'USD' ? origen.montoUsd : origen.montoOrigen;
                    const saldoActualFondo = round2(parseLocaleNumber(fondo.saldo_actual));

                    if (saldoActualFondo + 0.0001 < montoDebitarFondo) {
                        throw new Error(
                            `Saldo insuficiente en el fondo ${origen.fondoId}. Disponible: ${saldoActualFondo}, requerido: ${montoDebitarFondo}.`
                        );
                    }

                    const fondoUpdate = await pool.query(
                        `
                        UPDATE fondos
                        SET saldo_actual = COALESCE(saldo_actual, 0) - $1
                        WHERE id = $2
                        RETURNING id
                        `,
                        [montoDebitarFondo, origen.fondoId]
                    );
                    if (fondoUpdate.rows.length === 0) {
                        throw new Error(`Fondo ${origen.fondoId} no encontrado.`);
                    }

                    const tipoMovimientoEgreso = await resolveMovimientoFondoTipo(['EGRESO', 'SALIDA', 'DEBITO', 'DESCUENTO'], 'EGRESO');

                    await pool.query(
                        `
                        INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, tasa_cambio, nota)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        `,
                        [
                            origen.fondoId,
                            tipoMovimientoEgreso,
                            montoDebitarFondo,
                            pagoProveedorId,
                            origen.tasaCambio,
                            `Pago a proveedor - Ref: ${origen.referencia || 'N/A'}`,
                        ]
                    );
                }

                await pool.query(
                    `
                    INSERT INTO gastos_pagos_fondos (gasto_id, fondo_id, monto_pagado_usd, fecha_pago)
                    VALUES ($1, $2, $3, $4)
                    `,
                    [gasto_id, origen.fondoId, origen.montoUsd, fecha]
                );
            }

            await pool.query('COMMIT');

            return res.status(200).json({
                status: 'success',
                pago_proveedor_id: pagoProveedorId,
                gasto: {
                    id: gasto_id,
                    monto_usd: montoTotalGastoUsd,
                    monto_pagado_usd: montoPagadoGastoUsd,
                    saldo_pendiente_usd: round2(Math.max(0, montoTotalGastoUsd - montoPagadoGastoUsd)),
                },
            });
        } catch (err: unknown) {
            const error = asError(err);
            if (txStarted) await pool.query('ROLLBACK');
            const isBusinessError =
                error.message.includes('monto_') ||
                error.message.includes('tasa_cambio') ||
                error.message.includes('cuenta_bancaria_id') ||
                error.message.includes('Gasto no encontrado') ||
                error.message.includes('excede el monto total') ||
                error.message.includes('Saldo insuficiente') ||
                error.message.includes('Fondo') ||
                error.message.includes('moneda válida');
            return res.status(isBusinessError ? 400 : 500).json({ status: 'error', message: error.message });
        }
    });
};

module.exports = { registerPagosRoutes };
