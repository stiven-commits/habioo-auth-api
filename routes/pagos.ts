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
    telefono_origen?: boolean;
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

interface IPagoFullRow {
    id: number;
    monto_usd: string | number;
    monto_origen: string | number | null;
    tasa_cambio: string | number | null;
    propiedad_id: number;
    estado: string;
    cuenta_bancaria_id: number | null;
    moneda: string | null;
    referencia: string | null;
    created_at?: string | Date | null;
    recibo_id?: number | null;
    es_ajuste_historico?: boolean;
}

interface IPagoPendienteAdminRow {
    id: number;
    propiedad_id: number;
    recibo_id: number | null;
    identificador: string;
    propietario: string | null;
    monto_origen: string | number | null;
    monto_usd: string | number | null;
    moneda: string | null;
    referencia: string | null;
    fecha_pago: string | Date | null;
    estado: string;
    nota: string | null;
    es_ajuste_historico?: boolean;
}

interface IRechazarPagoBody {
    nota?: string | null;
}

interface IMovimientoFondoPagoRow {
    id: number;
    fondo_id: number;
    monto: string | number;
}

interface IReciboPagadoCountRow {
    total: string;
}

interface AbonoFondosInput {
    cuentaId: string | number;
    montoDistribuibleUsd: number;
    montoDistribuibleOrigen: number;
    monedaPago: string;
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
    telefono_origen?: string | null;
    moneda?: string | null;
    metodo?: string | null;
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

interface PagoProveedorDetalleParams {
    gasto_id?: string;
}

interface PagoProveedorDetalleRow {
    id: string;
    fondo_id: number | null;
    fondo_nombre: string | null;
    banco_nombre: string | null;
    monto_bs: number | null;
    tasa_cambio: number | null;
    monto_usd: number | null;
    referencia: string | null;
    fecha_pago: string | Date | null;
    fecha_registro: string | Date | null;
    nota: string | null;
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

const toIsoDate = (value: unknown, fieldName: string): string => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const raw = String(value ?? '').trim();
    if (!raw) throw new Error(`${fieldName} es requerida.`);

    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
        const [_, y, m, d] = ymd;
        const dt = new Date(`${y}-${m}-${d}T00:00:00`);
        if (!Number.isNaN(dt.getTime())) return `${y}-${m}-${d}`;
    }

    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) {
        const [_, d, m, y] = dmy;
        const dt = new Date(`${y}-${m}-${d}T00:00:00`);
        if (!Number.isNaN(dt.getTime())) return `${y}-${m}-${d}`;
    }

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

    const getPagosColumns = async (): Promise<OptionalPagosColumns & { propiedad_id: boolean; es_ajuste_historico: boolean }> => {
        const optionalCols = await getPagosOptionalColumns();
        try {
            const result = await pool.query<IColumnNameRow>(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'pagos'
                  AND column_name IN ('propiedad_id', 'es_ajuste_historico')
            `);
            const cols = new Set(result.rows.map((r) => r.column_name));
            return {
                ...optionalCols,
                propiedad_id: cols.has('propiedad_id'),
                es_ajuste_historico: cols.has('es_ajuste_historico'),
            };
        } catch (_err) {
            return { ...optionalCols, propiedad_id: false, es_ajuste_historico: false };
        }
    };

    const getCuentaFechaLimiteSaldo = async (cuentaId: number): Promise<string | null> => {
        try {
            const r = await pool.query<{ fecha_limite: string | null }>(
                `
                SELECT MAX(fecha_saldo)::text AS fecha_limite
                FROM fondos
                WHERE cuenta_bancaria_id = $1
                  AND fecha_saldo IS NOT NULL
                `,
                [cuentaId]
            );
            return r.rows[0]?.fecha_limite || null;
        } catch (err: unknown) {
            const message = asError(err).message;
            if (message.toLowerCase().includes('fecha_saldo')) return null;
            throw err;
        }
    };

    const getFondoFechaSaldo = async (fondoId: number): Promise<string | null> => {
        try {
            const r = await pool.query<{ fecha_saldo: string | null }>(
                'SELECT fecha_saldo::text AS fecha_saldo FROM fondos WHERE id = $1 LIMIT 1',
                [fondoId]
            );
            return r.rows[0]?.fecha_saldo || null;
        } catch (err: unknown) {
            const message = asError(err).message;
            if (message.toLowerCase().includes('fecha_saldo')) return null;
            throw err;
        }
    };

    const userHasPropiedadPortalAccess = async (userId: number, propiedadId: number): Promise<boolean> => {
        const r = await pool.query<{ ok: number }>(
            `
              SELECT 1 AS ok
              FROM usuarios_propiedades up
              WHERE up.user_id = $1
                AND up.propiedad_id = $2
                AND COALESCE(up.acceso_portal, true) = true
              LIMIT 1
            `,
            [userId, propiedadId]
        );
        return r.rows.length > 0;
    };

    const adminHasPropiedadAccess = async (adminUserId: number, propiedadId: number): Promise<boolean> => {
        const r = await pool.query<{ ok: number }>(
            `
              SELECT 1 AS ok
              FROM propiedades p
              INNER JOIN condominios c ON c.id = p.condominio_id
              WHERE p.id = $1
                AND c.admin_user_id = $2
              LIMIT 1
            `,
            [propiedadId, adminUserId]
        );
        return r.rows.length > 0;
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
    const distribuirAbonoEnFondos = async (client: QueryClient, { cuentaId, montoDistribuibleUsd, montoDistribuibleOrigen, monedaPago, tasaNum, pagoId, referencia }: AbonoFondosInput): Promise<void> => {
        const monedaBase = String(monedaPago || '').toUpperCase() === 'USD' ? 'USD' : 'BS';
        const montoBase = monedaBase === 'BS'
            ? round2(montoDistribuibleOrigen)
            : round2(montoDistribuibleUsd);
        if (montoBase <= 0) return;

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

        const distBase: Array<IFondoActivoRow & { montoBaseParte: number }> = [];
        let acumuladoBase = 0;
        noOperativos.forEach((f) => {
            const pct = parseFloat(String(f.porcentaje_asignacion || 0));
            const parte = round2((montoBase * pct) / 100);
            acumuladoBase = round2(acumuladoBase + parte);
            distBase.push({ ...f, montoBaseParte: parte });
        });

        const remanenteBase = round2(montoBase - acumuladoBase);
        if (fondoPrincipal) {
            distBase.push({ ...fondoPrincipal, montoBaseParte: remanenteBase });
        } else if (distBase.length > 0) {
            distBase[distBase.length - 1].montoBaseParte = round2(distBase[distBase.length - 1].montoBaseParte + remanenteBase);
        } else {
            distBase.push({ ...fondosActivos[0], montoBaseParte: montoBase });
        }

        const tipoMovimiento = await resolveMovimientoFondoTipo(['ABONO', 'ENTRADA', 'INGRESO', 'AJUSTE_INICIAL'], 'AJUSTE_INICIAL');
        for (const d of distBase) {
            const parteBase = round2(d.montoBaseParte || 0);
            if (parteBase <= 0) continue;

            const monedaFondo = String(d.moneda || '').toUpperCase();
            let montoFondo = parteBase;
            if (monedaFondo !== monedaBase) {
                if (!tasaNum || tasaNum <= 0) {
                    throw new Error('No hay tasa de cambio valida para convertir entre monedas en la distribucion de fondos.');
                }
                if (monedaBase === 'BS' && monedaFondo === 'USD') {
                    montoFondo = round2(parteBase / tasaNum);
                } else if (monedaBase === 'USD' && monedaFondo === 'BS') {
                    montoFondo = round2(parteBase * tasaNum);
                }
            }

            await client.query('UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2', [montoFondo, d.id]);
            await client.query(
                'INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, tasa_cambio, nota) VALUES ($1, $2, $3, $4, $5, $6)',
                [d.id, tipoMovimiento, montoFondo, pagoId, tasaNum || null, `Abono distribuible de pago${pagoId ? ` #${pagoId}` : ''} (${referencia || 'sin referencia'})`]
            );
        }
    };

    const aplicarPagoEnCascada = async (client: QueryClient, pago: IPagoFullRow): Promise<void> => {
        const montoUsd = round2(parseFloat(String(pago.monto_usd || 0)));
        if (montoUsd <= 0) return;

        const propiedadId = pago.propiedad_id;
        await client.query('UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) - $1 WHERE id = $2', [montoUsd, propiedadId]);
        await client.query(
            'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
            [propiedadId, 'AGREGAR_FAVOR', montoUsd, `Pago validado${pago.referencia ? ` (Ref: ${pago.referencia})` : ''}${pago.id ? ` #${pago.id}` : ''}`]
        );

        let dineroRestante = montoUsd;
        let montoDistribuibleFondos = 0;
        let montoExtraTotalUsd = 0;

        const recibosPendientes = await client.query<IReciboRow>(
            "SELECT * FROM recibos WHERE propiedad_id = $1 AND estado != 'Pagado' ORDER BY fecha_emision ASC, id ASC",
            [propiedadId]
        );

        for (const rec of recibosPendientes.rows) {
            if (dineroRestante <= 0) break;

            const deudaRecibo = round2(parseFloat(String(rec.monto_usd || 0)) - parseFloat(String(rec.monto_pagado_usd || 0)));
            if (deudaRecibo <= 0) {
                await client.query("UPDATE recibos SET estado = 'Pagado' WHERE id = $1", [rec.id]);
                continue;
            }

            const montoAplicadoRecibo = Math.min(dineroRestante, deudaRecibo);

            if (dineroRestante >= deudaRecibo) {
                await client.query("UPDATE recibos SET monto_pagado_usd = monto_usd, estado = 'Pagado' WHERE id = $1", [rec.id]);
                dineroRestante = round2(dineroRestante - deudaRecibo);
            } else {
                await client.query(
                    "UPDATE recibos SET monto_pagado_usd = COALESCE(monto_pagado_usd, 0) + $1, estado = 'Abonado' WHERE id = $2",
                    [dineroRestante, rec.id]
                );
                dineroRestante = 0;
            }

            const { montoDistribuibleUsd, montoExtraUsd } = await imputarReciboEnGastos(client, rec, montoAplicadoRecibo);
            montoDistribuibleFondos = round2(montoDistribuibleFondos + montoDistribuibleUsd);
            montoExtraTotalUsd = round2(montoExtraTotalUsd + montoExtraUsd);
        }

        if (dineroRestante > 0) {
            montoDistribuibleFondos = round2(montoDistribuibleFondos + dineroRestante);
        }

        const monedaPago = String(pago.moneda || 'BS').toUpperCase();
        const tasaNum = monedaPago === 'BS' ? (parseFloat(String(pago.tasa_cambio || 0)) || 1) : 1;
        const montoOrigenNum = parseFloat(String(pago.monto_origen || 0)) || 0;
        const montoDistribuibleOrigen = monedaPago === 'BS'
            ? round2(Math.max(0, montoOrigenNum - round2(montoExtraTotalUsd * tasaNum)))
            : montoDistribuibleFondos;

        if (pago.cuenta_bancaria_id && montoDistribuibleFondos > 0) {
            await distribuirAbonoEnFondos(client, {
                cuentaId: pago.cuenta_bancaria_id,
                montoDistribuibleUsd: montoDistribuibleFondos,
                montoDistribuibleOrigen,
                monedaPago,
                tasaNum,
                pagoId: pago.id,
                referencia: pago.referencia || null,
            });
        }
    };

    // Ruta de administradores para registrar y aprobar pagos en cascada al instante.
    app.post('/pagos-admin', verifyToken, async (req: Request<{}, unknown, PagosAdminBody>, res: Response, _next: NextFunction) => {
        const { propiedad_id, cuenta_id, monto_origen, tasa_cambio, referencia, fecha_pago, nota, cedula_origen, banco_origen, telefono_origen, moneda, metodo } = req.body;

        try {
            const user = asAuthUser(req.user);

            const propiedadIdNum = parseInt(String(propiedad_id), 10);
            if (!Number.isFinite(propiedadIdNum) || propiedadIdNum <= 0) {
                return res.status(400).json({ status: 'error', error: 'propiedad_id invalido.' });
            }
            const hasAccess = await adminHasPropiedadAccess(user.id, propiedadIdNum);
            if (!hasAccess) {
                return res.status(403).json({ status: 'error', error: 'No autorizado para este inmueble.' });
            }

            await pool.query('BEGIN');

            // 1. Calculamos montos normalizados.
            const cuentaIdNum = parseInt(String(cuenta_id), 10);
            if (!Number.isFinite(cuentaIdNum) || cuentaIdNum <= 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', error: 'cuenta_id invalido.' });
            }
            const monedaFinal = moneda || 'BS';
            const metodoFinal = String(metodo || 'Transferencia').trim() || 'Transferencia';
            const montoOrigenNum = parseLocaleNumber(monto_origen);
            const tasaNum = monedaFinal === 'BS' ? (parseLocaleNumber(tasa_cambio) || 1) : 1;
            const montoUsd = monedaFinal === 'BS' ? round2(montoOrigenNum / tasaNum) : round2(montoOrigenNum);
            const fechaPagoSafe = toIsoDate(fecha_pago || new Date(), 'fecha_pago');
            const fechaLimiteSaldo = await getCuentaFechaLimiteSaldo(cuentaIdNum);
            if (fechaLimiteSaldo) {
                const pagoDay = toEpochDay(fechaPagoSafe);
                const limiteDay = toEpochDay(fechaLimiteSaldo);
                if (Number.isFinite(pagoDay) && Number.isFinite(limiteDay) && pagoDay < limiteDay) {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({
                        status: 'error',
                        message: `No está permitido este registro porque es previo a la fecha ${formatYmdToDmy(fechaLimiteSaldo)} registrada en la apertura del fondo.`,
                    });
                }
            }

            // 2. Insertamos el pago ya Validado (registro administrativo).
            const optionalCols = await getPagosColumns();
            const bancoOrigenSafe = (banco_origen || '').trim();
            const cedulaOrigenSafe = (cedula_origen || '').trim();
            const telefonoOrigenSafe = String(telefono_origen || '').replace(/\D/g, '').trim();
            const notaBase = (nota || '').trim();
            const notaOrigenPartes: string[] = [];
            if (bancoOrigenSafe) notaOrigenPartes.push(`Banco origen: ${bancoOrigenSafe}`);
            if (cedulaOrigenSafe) notaOrigenPartes.push(`Cedula origen: ${cedulaOrigenSafe}`);
            if (telefonoOrigenSafe) notaOrigenPartes.push(`Telefono origen: ${telefonoOrigenSafe}`);
            const notaConOrigen = [notaBase, ...notaOrigenPartes].filter(Boolean).join(' | ');
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
                cuentaIdNum,
                montoOrigenNum,
                monedaFinal === 'BS' ? tasaNum : null,
                montoUsd,
                monedaFinal,
                referencia || null,
                fechaPagoSafe,
                metodoFinal,
                'Validado',
            ];

            if (optionalCols.nota) {
                insertColumns.push('nota');
                insertValues.push(notaConOrigen || null);
            }
            if (optionalCols.cedula_origen) {
                insertColumns.push('cedula_origen');
                insertValues.push(cedulaOrigenSafe || null);
            }
            if (optionalCols.banco_origen) {
                insertColumns.push('banco_origen');
                insertValues.push(bancoOrigenSafe || null);
            }
            if (optionalCols.telefono_origen) {
                insertColumns.push('telefono_origen');
                insertValues.push(telefonoOrigenSafe || null);
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
            let montoExtraTotalUsd = 0;

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
                const { montoDistribuibleUsd, montoExtraUsd } = await imputarReciboEnGastos(pool, rec, montoAplicadoRecibo);
                montoDistribuibleFondos = round2(montoDistribuibleFondos + montoDistribuibleUsd);
                montoExtraTotalUsd = round2(montoExtraTotalUsd + montoExtraUsd);
            }

            // Si sobro dinero, queda como saldo a favor y es distribuible en fondos (no proviene de gasto Extra).
            if (dineroRestante > 0) {
                montoDistribuibleFondos = round2(montoDistribuibleFondos + dineroRestante);
            }

            const montoDistribuibleOrigen = monedaFinal === 'BS'
                ? round2(Math.max(0, montoOrigenNum - round2(montoExtraTotalUsd * tasaNum)))
                : montoDistribuibleFondos;

            // 5. Distribucion en fondos: solo monto no-Extra.
            // Regla requerida: el componente Extra no genera movimientos_fondos.
            await distribuirAbonoEnFondos(pool, {
                cuentaId: cuenta_id,
                montoDistribuibleUsd: montoDistribuibleFondos,
                montoDistribuibleOrigen,
                monedaPago: monedaFinal,
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

    // Ruta de propietarios: registra el pago en estado PendienteAprobacion (no afecta saldos hasta aprobar).
    app.post('/pagos-propietario', verifyToken, async (req: Request<{}, unknown, PagosAdminBody>, res: Response, _next: NextFunction) => {
        const { propiedad_id, cuenta_id, monto_origen, tasa_cambio, referencia, fecha_pago, nota, cedula_origen, banco_origen, telefono_origen, moneda, recibo_id, metodo } = req.body as PagosAdminBody & { recibo_id?: number | string | null };

        try {
            const user = asAuthUser(req.user);
            const propiedadIdNum = parseInt(String(propiedad_id), 10);
            if (!Number.isFinite(propiedadIdNum) || propiedadIdNum <= 0) {
                return res.status(400).json({ status: 'error', error: 'propiedad_id invalido.' });
            }

            const hasAccess = await userHasPropiedadPortalAccess(user.id, propiedadIdNum);
            if (!hasAccess) {
                return res.status(403).json({ status: 'error', error: 'No autorizado para registrar pagos en este inmueble.' });
            }

            await pool.query('BEGIN');

            const cuentaIdNum = parseInt(String(cuenta_id), 10);
            if (!Number.isFinite(cuentaIdNum) || cuentaIdNum <= 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', error: 'cuenta_id invalido.' });
            }
            const monedaFinal = moneda || 'BS';
            const metodoFinal = String(metodo || 'Transferencia').trim() || 'Transferencia';
            const montoOrigenNum = parseLocaleNumber(monto_origen);
            const tasaNum = monedaFinal === 'BS' ? (parseLocaleNumber(tasa_cambio) || 1) : 1;
            const montoUsd = monedaFinal === 'BS' ? round2(montoOrigenNum / tasaNum) : round2(montoOrigenNum);
            const fechaPagoSafe = toIsoDate(fecha_pago || new Date(), 'fecha_pago');
            const fechaLimiteSaldo = await getCuentaFechaLimiteSaldo(cuentaIdNum);
            const esAjusteHistorico = Boolean(
                fechaLimiteSaldo
                && Number.isFinite(toEpochDay(fechaPagoSafe))
                && Number.isFinite(toEpochDay(fechaLimiteSaldo))
                && toEpochDay(fechaPagoSafe) < toEpochDay(fechaLimiteSaldo)
            );

            const optionalCols = await getPagosColumns();
            const bancoOrigenSafe = (banco_origen || '').trim();
            const cedulaOrigenSafe = (cedula_origen || '').trim();
            const telefonoOrigenSafe = String(telefono_origen || '').replace(/\D/g, '').trim();
            const notaBase = (nota || '').trim();
            const notaOrigenPartes: string[] = [];
            if (bancoOrigenSafe) notaOrigenPartes.push(`Banco origen: ${bancoOrigenSafe}`);
            if (cedulaOrigenSafe) notaOrigenPartes.push(`Cedula origen: ${cedulaOrigenSafe}`);
            if (telefonoOrigenSafe) notaOrigenPartes.push(`Telefono origen: ${telefonoOrigenSafe}`);
            const notaConOrigen = [notaBase, ...notaOrigenPartes].filter(Boolean).join(' | ');

            const reciboIdNum = parseInt(String(recibo_id ?? ''), 10);
            const reciboSafe = Number.isFinite(reciboIdNum) && reciboIdNum > 0 ? reciboIdNum : null;

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
                propiedadIdNum,
                reciboSafe,
                cuentaIdNum,
                montoOrigenNum,
                monedaFinal === 'BS' ? tasaNum : null,
                montoUsd,
                monedaFinal,
                referencia || null,
                fechaPagoSafe,
                metodoFinal,
                'PendienteAprobacion',
            ];

            if (optionalCols.nota) {
                insertColumns.push('nota');
                insertValues.push(notaConOrigen || null);
            }
            if (optionalCols.cedula_origen) {
                insertColumns.push('cedula_origen');
                insertValues.push(cedulaOrigenSafe || null);
            }
            if (optionalCols.banco_origen) {
                insertColumns.push('banco_origen');
                insertValues.push(bancoOrigenSafe || null);
            }
            if (optionalCols.telefono_origen) {
                insertColumns.push('telefono_origen');
                insertValues.push(telefonoOrigenSafe || null);
            }
            if (optionalCols.es_ajuste_historico) {
                insertColumns.push('es_ajuste_historico');
                insertValues.push(esAjusteHistorico);
            }

            const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ');
            await pool.query(
                `INSERT INTO pagos (${insertColumns.join(', ')}) VALUES (${placeholders})`,
                insertValues
            );

            await pool.query('COMMIT');
            return res.json({
                status: 'success',
                es_ajuste_historico: esAjusteHistorico,
                message: esAjusteHistorico
                    ? 'Hemos recibido la información de tu pago. Debido a que corresponde a un periodo anterior a la apertura de los fondos actuales del sistema, este registro será gestionado como un ajuste especial de saldo. Una vez validado por la Junta de Condominio, verás el descuento reflejado correctamente en tu histórico.'
                    : 'Pago enviado para aprobacion de la junta.',
            });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            return res.status(500).json({ status: 'error', error: error.message });
        }
    });

    // Pagos pendientes de aprobacion para la junta (opcionalmente filtrado por propiedad).
    app.get('/pagos/pendientes-aprobacion', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);

            const propiedadIdRaw = parseInt(String(req.query.propiedad_id || ''), 10);
            const whereByPropiedad = Number.isFinite(propiedadIdRaw) && propiedadIdRaw > 0 ? 'AND p.id = $2' : '';
            const params: Array<number> = [user.id];
            if (whereByPropiedad) params.push(propiedadIdRaw);
            const pagosCols = await getPagosColumns();
            const ajusteHistoricoExpr = pagosCols.es_ajuste_historico
                ? 'COALESCE(pa.es_ajuste_historico, false)'
                : 'false';

            const r = await pool.query<IPagoPendienteAdminRow>(
                `
                  SELECT
                    pa.id,
                    pa.propiedad_id,
                    pa.recibo_id,
                    p.identificador,
                    u.nombre AS propietario,
                    pa.monto_origen,
                    pa.monto_usd,
                    pa.moneda,
                    pa.referencia,
                    pa.fecha_pago,
                    pa.estado,
                    pa.nota,
                    ${ajusteHistoricoExpr} AS es_ajuste_historico
                  FROM pagos pa
                  INNER JOIN propiedades p ON p.id = pa.propiedad_id
                  INNER JOIN condominios c ON c.id = p.condominio_id
                  LEFT JOIN LATERAL (
                    SELECT u1.nombre
                    FROM usuarios_propiedades up1
                    INNER JOIN users u1 ON u1.id = up1.user_id
                    WHERE up1.propiedad_id = p.id
                    ORDER BY
                      CASE
                        WHEN LOWER(COALESCE(up1.rol, '')) IN ('propietario', 'owner') THEN 0
                        ELSE 1
                      END,
                      up1.id ASC
                    LIMIT 1
                  ) u ON true
                  WHERE c.admin_user_id = $1
                    AND pa.estado = 'PendienteAprobacion'
                    ${whereByPropiedad}
                  ORDER BY COALESCE(pa.created_at, pa.fecha_pago) DESC, pa.id DESC
                `,
                params
            );

            return res.json({ status: 'success', pagos: r.rows });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    // Validacion manual de pagos pendientes (FIFO por recibos de la propiedad).
    app.post('/pagos/:id/validar', verifyToken, async (req: Request<PagoValidarParams>, res: Response, _next: NextFunction) => {
        const pagoId = asString(req.params.id);

        try {
            const user = asAuthUser(req.user);

            await pool.query('BEGIN');
            const pagosCols = await getPagosColumns();
            const ajusteHistoricoExpr = pagosCols.es_ajuste_historico
                ? 'COALESCE(es_ajuste_historico, false)'
                : 'false';

            const pagoRes = await pool.query<IPagoFullRow>(
                `SELECT id, monto_usd, monto_origen, tasa_cambio, propiedad_id, estado, cuenta_bancaria_id, moneda, referencia, ${ajusteHistoricoExpr} AS es_ajuste_historico FROM pagos WHERE id = $1 AND estado IN ('Pendiente', 'PendienteAprobacion')`,
                [pagoId]
            );
            if (pagoRes.rows.length === 0) throw new Error('Pago no encontrado o ya fue procesado.');

            const pago = pagoRes.rows[0];
            const hasAccess = await adminHasPropiedadAccess(user.id, pago.propiedad_id);
            if (!hasAccess) {
                throw new Error('No autorizado para aprobar pagos de otro condominio.');
            }

            await pool.query("UPDATE pagos SET estado = 'Validado' WHERE id = $1", [pagoId]);
            if (pago.es_ajuste_historico) {
                const montoUsd = round2(parseFloat(String(pago.monto_usd || 0)));
                const montoBsRaw = parseFloat(String(pago.monto_origen ?? 0));
                const tasaRaw = parseFloat(String(pago.tasa_cambio ?? 0));
                const montoBs = Number.isFinite(montoBsRaw) && montoBsRaw > 0 ? round2(montoBsRaw) : null;
                const tasaCambio = Number.isFinite(tasaRaw) && tasaRaw > 0 ? tasaRaw : null;
                if (montoUsd > 0) {
                    await pool.query(
                        'UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) - $1 WHERE id = $2',
                        [montoUsd, pago.propiedad_id]
                    );
                    await pool.query(
                        'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, monto_bs, tasa_cambio, nota) VALUES ($1, $2, $3, $4, $5, $6)',
                        [
                            pago.propiedad_id,
                            'AGREGAR_FAVOR',
                            montoUsd,
                            montoBs,
                            tasaCambio,
                            `[Ajuste Histórico] Pago previo a apertura${pago.referencia ? ` (Ref: ${pago.referencia})` : ''}${pago.id ? ` #${pago.id}` : ''}`,
                        ]
                    );
                }
            } else {
                await aplicarPagoEnCascada(pool, pago);
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Pago aprobado y saldos distribuidos en cascada correctamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/pagos/:id/rechazar', verifyToken, async (req: Request<PagoValidarParams, unknown, IRechazarPagoBody>, res: Response, _next: NextFunction) => {
        const pagoId = asString(req.params.id);
        const notaRechazo = String(req.body?.nota || '').trim();

        if (!notaRechazo) {
            return res.status(400).json({ status: 'error', message: 'Debe indicar una nota de rechazo.' });
        }

        try {
            const user = asAuthUser(req.user);
            const pagoRes = await pool.query<IPagoFullRow>(
                "SELECT id, monto_usd, monto_origen, tasa_cambio, propiedad_id, estado, cuenta_bancaria_id, moneda, referencia FROM pagos WHERE id = $1 AND estado = 'PendienteAprobacion'",
                [pagoId]
            );
            if (pagoRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Pago no encontrado o ya procesado.' });
            }
            const pago = pagoRes.rows[0];
            const hasAccess = await adminHasPropiedadAccess(user.id, pago.propiedad_id);
            if (!hasAccess) {
                return res.status(403).json({ status: 'error', message: 'No autorizado para rechazar este pago.' });
            }

            const optionalCols = await getPagosColumns();
            if (optionalCols.nota) {
                await pool.query(
                    "UPDATE pagos SET estado = 'Rechazado', nota = CONCAT(COALESCE(NULLIF(TRIM(nota), ''), ''), CASE WHEN COALESCE(NULLIF(TRIM(nota), ''), '') = '' THEN '' ELSE ' | ' END, 'Rechazado: ', $2::text) WHERE id = $1",
                    [pagoId, notaRechazo]
                );
            } else {
                await pool.query("UPDATE pagos SET estado = 'Rechazado' WHERE id = $1", [pagoId]);
            }

            return res.json({ status: 'success', message: 'Pago rechazado correctamente.' });
        } catch (err: unknown) {
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.post('/pagos/:id/rollback', verifyToken, async (req: Request<PagoValidarParams>, res: Response, _next: NextFunction) => {
        const pagoId = asString(req.params.id);

        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');

            const pagoRes = await pool.query<IPagoFullRow>(
                `
                SELECT
                  id,
                  monto_usd,
                  monto_origen,
                  tasa_cambio,
                  propiedad_id,
                  estado,
                  cuenta_bancaria_id,
                  moneda,
                  referencia,
                  recibo_id,
                  created_at
                FROM pagos
                WHERE id = $1
                LIMIT 1
                `,
                [pagoId]
            );
            if (pagoRes.rows.length === 0) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Pago no encontrado.' });
            }

            const pago = pagoRes.rows[0];
            const hasAccess = await adminHasPropiedadAccess(user.id, pago.propiedad_id);
            if (!hasAccess) {
                await pool.query('ROLLBACK');
                return res.status(403).json({ status: 'error', message: 'No autorizado para revertir este pago.' });
            }

            if (String(pago.estado || '').trim() !== 'Validado') {
                await pool.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Solo se pueden revertir pagos en estado Validado.' });
            }

            if (pago.recibo_id) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    status: 'error',
                    message: 'Este pago está asociado a un recibo. Use ajuste manual para conservar trazabilidad contable.',
                });
            }

            // Simulación FIFO para determinar exactamente qué recibos tocó ESTE pago.
            // Se obtienen todos los recibos de la propiedad en orden cronológico y se simulan
            // primero los otros pagos validados, luego este pago, para saber cuánto aportó a cada recibo.
            const recibosFifoRes = await pool.query<IReciboRow>(
                `SELECT id, monto_usd, monto_pagado_usd, estado, mes_cobro, propiedad_id
                 FROM recibos WHERE propiedad_id = $1 ORDER BY fecha_emision ASC, id ASC`,
                [pago.propiedad_id]
            );
            const recibosFifo = recibosFifoRes.rows;

            const otrosPagosRes = await pool.query<{ total: string }>(
                `SELECT COALESCE(SUM(monto_usd), 0)::text AS total
                 FROM pagos WHERE propiedad_id = $1 AND estado = 'Validado' AND id != $2`,
                [pago.propiedad_id, pago.id]
            );
            let otrosPagosRemaining = round2(parseLocaleNumber(otrosPagosRes.rows[0].total));

            // Simular cuánta deuda queda por recibo después de los demás pagos
            const deudaRestantePorRecibo = new Map<number, number>();
            for (const rec of recibosFifo) {
                const deuda = round2(parseFloat(String(rec.monto_usd || 0)));
                if (deuda <= 0) { deudaRestantePorRecibo.set(rec.id, 0); continue; }
                if (otrosPagosRemaining >= deuda) {
                    otrosPagosRemaining = round2(otrosPagosRemaining - deuda);
                    deudaRestantePorRecibo.set(rec.id, 0);
                } else {
                    deudaRestantePorRecibo.set(rec.id, round2(deuda - otrosPagosRemaining));
                    otrosPagosRemaining = 0;
                }
            }

            // Determinar qué recibos tocó este pago y en cuánto
            const reciboHits: Array<{ recibo: IReciboRow; montoAportado: number }> = [];
            let thisRemaining = round2(parseLocaleNumber(pago.monto_usd));
            for (const rec of recibosFifo) {
                if (thisRemaining <= 0) break;
                const deudaRestante = deudaRestantePorRecibo.get(rec.id) ?? 0;
                if (deudaRestante <= 0) continue;
                const aportado = round2(Math.min(thisRemaining, deudaRestante));
                thisRemaining = round2(thisRemaining - aportado);
                reciboHits.push({ recibo: rec, montoAportado: aportado });
            }

            // Revertir recibos y gastos que este pago tocó
            for (const { recibo, montoAportado } of reciboHits) {
                await pool.query(
                    `UPDATE recibos
                     SET monto_pagado_usd = GREATEST(0, COALESCE(monto_pagado_usd, 0) - $1),
                         estado = CASE
                             WHEN GREATEST(0, COALESCE(monto_pagado_usd, 0) - $1) <= 0.005 THEN 'Pendiente'
                             ELSE 'Abonado'
                         END
                     WHERE id = $2`,
                    [montoAportado, recibo.id]
                );

                const breakdown = await buildReciboBreakdownByGasto(pool, recibo);
                if (breakdown.length > 0) {
                    const pagadoPrevio = round2(Math.max(0, parseFloat(String(recibo.monto_pagado_usd || 0)) - montoAportado));
                    const rows = breakdown.map((b) => ({ ...b, restante: round2(b.shareUsd) }));
                    let prevRemaining = pagadoPrevio;
                    for (const row of rows) {
                        if (prevRemaining <= 0) break;
                        const aplicadoAntes = Math.min(row.restante, prevRemaining);
                        row.restante = round2(row.restante - aplicadoAntes);
                        prevRemaining = round2(prevRemaining - aplicadoAntes);
                    }
                    let gastoRemaining = montoAportado;
                    for (const row of rows) {
                        if (gastoRemaining <= 0) break;
                        if (row.restante <= 0) continue;
                        const aplicar = Math.min(row.restante, gastoRemaining);
                        if (aplicar <= 0) continue;
                        await pool.query(
                            `UPDATE gastos SET monto_pagado_usd = GREATEST(0, COALESCE(monto_pagado_usd, 0) - $1) WHERE id = $2`,
                            [aplicar, row.gastoId]
                        );
                        gastoRemaining = round2(gastoRemaining - aplicar);
                    }
                }
            }

            const movimientosRes = await pool.query<IMovimientoFondoPagoRow>(
                `
                SELECT id, fondo_id, monto
                FROM movimientos_fondos
                WHERE referencia_id = $1
                ORDER BY id ASC
                `,
                [pago.id]
            );

            for (const mov of movimientosRes.rows) {
                await pool.query(
                    `
                    UPDATE fondos
                    SET saldo_actual = COALESCE(saldo_actual, 0) - $1
                    WHERE id = $2
                    `,
                    [round2(parseLocaleNumber(mov.monto)), mov.fondo_id]
                );
            }

            await pool.query('DELETE FROM movimientos_fondos WHERE referencia_id = $1', [pago.id]);
            await pool.query(
                'UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2',
                [round2(parseLocaleNumber(pago.monto_usd)), pago.propiedad_id]
            );
            await pool.query('DELETE FROM pagos WHERE id = $1', [pago.id]);

            await pool.query('COMMIT');
            return res.json({ status: 'success', message: 'Pago revertido correctamente.' });
        } catch (err: unknown) {
            await pool.query('ROLLBACK');
            return res.status(500).json({ status: 'error', message: asError(err).message });
        }
    });

    app.get('/pagos-proveedores/gasto/:gasto_id/detalles', verifyToken, async (req: Request<PagoProveedorDetalleParams>, res: Response) => {
        try {
            const user = asAuthUser(req.user);
            const gastoId = parseInt(asString(req.params.gasto_id), 10);
            if (!Number.isFinite(gastoId) || gastoId <= 0) {
                return res.status(400).json({ status: 'error', message: 'gasto_id invalido.' });
            }

            const condoRes = await pool.query<{ id: number }>(
                'SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1',
                [user.id]
            );
            const condoId = condoRes.rows[0]?.id;
            if (!condoId) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            }

            const gastoRes = await pool.query<{ id: number }>(
                'SELECT id FROM gastos WHERE id = $1 AND condominio_id = $2 LIMIT 1',
                [gastoId, condoId]
            );
            if (gastoRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Gasto no encontrado.' });
            }

            const colsRes = await pool.query<IColumnNameRow>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'gastos_pagos_fondos'
                  AND column_name IN ('id', 'cuenta_bancaria_id', 'monto_bs', 'tasa_cambio', 'referencia', 'created_at', 'nota', 'pago_proveedor_id')
                `
            );
            const cols = new Set(colsRes.rows.map((r) => r.column_name));
            const gpfIdExpr = cols.has('id')
                ? 'gpf.id::text'
                : "('GPF-' || gpf.gasto_id::text || '-' || to_char(gpf.fecha_pago, 'YYYYMMDD') || '-' || COALESCE(gpf.fondo_id::text, 'EXTRA'))";
            const gpfCuentaExpr = cols.has('cuenta_bancaria_id')
                ? 'gpf.cuenta_bancaria_id'
                : 'f.cuenta_bancaria_id';
            const gpfMontoBsExpr = cols.has('monto_bs')
                ? 'gpf.monto_bs'
                : `
                    CASE
                        WHEN COALESCE(pp.monto_bs, 0) > 0 AND COALESCE(pp.monto_usd, 0) > 0
                            THEN (pp.monto_bs * (gpf.monto_pagado_usd / NULLIF(pp.monto_usd, 0)))
                        WHEN COALESCE(pp.tasa_cambio, 0) > 0
                            THEN (gpf.monto_pagado_usd * pp.tasa_cambio)
                        ELSE NULL
                    END
                `;
            const gpfTasaExpr = cols.has('tasa_cambio')
                ? `
                    CASE
                        WHEN COALESCE(gpf.tasa_cambio, 0) > 0 THEN gpf.tasa_cambio
                        ${cols.has('monto_bs') ? 'WHEN COALESCE(gpf.monto_bs, 0) > 0 AND COALESCE(gpf.monto_pagado_usd, 0) > 0 THEN (gpf.monto_bs / NULLIF(gpf.monto_pagado_usd, 0))' : ''}
                        WHEN COALESCE(pp.tasa_cambio, 0) > 0 THEN pp.tasa_cambio
                        ELSE NULL
                    END
                `
                : `
                    CASE
                        ${cols.has('monto_bs') ? 'WHEN COALESCE(gpf.monto_bs, 0) > 0 AND COALESCE(gpf.monto_pagado_usd, 0) > 0 THEN (gpf.monto_bs / NULLIF(gpf.monto_pagado_usd, 0))' : ''}
                        WHEN COALESCE(pp.tasa_cambio, 0) > 0 THEN pp.tasa_cambio
                        ELSE NULL
                    END
                `;
            const gpfOrderExpr = cols.has('id') ? 'gpf.id ASC' : 'gpf.fondo_id NULLS LAST, gpf.monto_pagado_usd ASC';
            const gpfRefExpr = cols.has('referencia')
                ? "COALESCE(NULLIF(TRIM(gpf.referencia), ''), pp.referencia)"
                : 'pp.referencia';
            const gpfFechaRegistroExpr = cols.has('created_at') ? 'gpf.created_at' : 'pp.created_at';
            const gpfNotaExpr = cols.has('nota') ? 'COALESCE(NULLIF(TRIM(gpf.nota), \'\'), pp.nota)' : 'pp.nota';
            const gpfJoinPagoIdExpr = cols.has('pago_proveedor_id') ? 'gpf.pago_proveedor_id' : 'NULL';
            const bancoColsRes = await pool.query<IColumnNameRow>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'cuentas_bancarias'
                  AND column_name IN ('nombre_banco', 'nombre', 'banco', 'apodo')
                `
            );
            const bancoCols = new Set(bancoColsRes.rows.map((r) => r.column_name));
            const buildBancoNombreExpr = (alias: string): string => {
                const candidates: string[] = [];
                if (bancoCols.has('nombre_banco')) candidates.push(`${alias}.nombre_banco`);
                if (bancoCols.has('nombre')) candidates.push(`${alias}.nombre`);
                if (bancoCols.has('banco')) candidates.push(`${alias}.banco`);
                if (bancoCols.has('apodo')) candidates.push(`${alias}.apodo`);
                if (candidates.length === 0) return "'Banco N/A'";
                return `COALESCE(${candidates.join(', ')}, 'Banco N/A')`;
            };
            const bancoNombreExprCb = buildBancoNombreExpr('cb');

            const query = `
                WITH pp_rank AS (
                    SELECT
                        pp.id,
                        pp.gasto_id,
                        pp.fecha_pago::date AS fecha_pago,
                        pp.referencia,
                        pp.monto_bs,
                        pp.monto_usd,
                        pp.tasa_cambio,
                        pp.nota,
                        pp.created_at,
                        ROW_NUMBER() OVER (
                            PARTITION BY pp.gasto_id, pp.fecha_pago::date
                            ORDER BY pp.id ASC
                        ) AS rn_pp
                    FROM pagos_proveedores pp
                    WHERE pp.gasto_id = $1
                ),
                gpf_rank AS (
                    SELECT
                        gpf.*,
                        ROW_NUMBER() OVER (
                            PARTITION BY gpf.gasto_id, gpf.fecha_pago::date
                            ORDER BY ${gpfOrderExpr}
                        ) AS rn_gpf
                    FROM gastos_pagos_fondos gpf
                    WHERE gpf.gasto_id = $1
                ),
                detalles_gpf AS (
                    SELECT
                        ${gpfIdExpr} AS id,
                        gpf.fondo_id,
                        f.nombre AS fondo_nombre,
                        ${bancoNombreExprCb} AS banco_nombre,
                        ${gpfMontoBsExpr} AS monto_bs,
                        ${gpfTasaExpr} AS tasa_cambio,
                        gpf.monto_pagado_usd AS monto_usd,
                        ${gpfRefExpr} AS referencia,
                        gpf.fecha_pago AS fecha_pago,
                        ${gpfFechaRegistroExpr} AS fecha_registro,
                        ${gpfNotaExpr} AS nota
                    FROM gpf_rank gpf
                    LEFT JOIN fondos f ON f.id = gpf.fondo_id
                    LEFT JOIN cuentas_bancarias cb ON cb.id = ${gpfCuentaExpr}
                    LEFT JOIN pp_rank pp
                        ON pp.gasto_id = gpf.gasto_id
                       AND pp.fecha_pago = gpf.fecha_pago::date
                       AND (
                            (${gpfJoinPagoIdExpr} IS NOT NULL AND pp.id = ${gpfJoinPagoIdExpr})
                            OR (${gpfJoinPagoIdExpr} IS NULL AND pp.rn_pp = gpf.rn_gpf)
                       )
                ),
                detalles_pp_fallback AS (
                    SELECT
                        ('PP-' || pp.id::text) AS id,
                        pp.fondo_id,
                        f.nombre AS fondo_nombre,
                        ${bancoNombreExprCb} AS banco_nombre,
                        pp.monto_bs,
                        pp.tasa_cambio,
                        pp.monto_usd,
                        pp.referencia,
                        pp.fecha_pago,
                        pp.created_at AS fecha_registro,
                        pp.nota
                    FROM pagos_proveedores pp
                    LEFT JOIN fondos f ON f.id = pp.fondo_id
                    LEFT JOIN cuentas_bancarias cb ON cb.id = f.cuenta_bancaria_id
                    WHERE pp.gasto_id = $1
                      AND NOT EXISTS (
                          SELECT 1
                          FROM gastos_pagos_fondos gpf2
                          WHERE gpf2.gasto_id = pp.gasto_id
                            AND gpf2.fecha_pago::date = pp.fecha_pago::date
                      )
                )
                SELECT
                    u.id,
                    u.fondo_id,
                    u.fondo_nombre,
                    u.banco_nombre,
                    u.monto_bs,
                    u.tasa_cambio,
                    u.monto_usd,
                    u.referencia,
                    u.fecha_pago,
                    u.fecha_registro,
                    u.nota
                FROM (
                    SELECT id, fondo_id, fondo_nombre, banco_nombre, monto_bs, tasa_cambio, monto_usd, referencia, fecha_pago, fecha_registro, nota
                    FROM detalles_gpf
                    UNION ALL
                    SELECT id, fondo_id, fondo_nombre, banco_nombre, monto_bs, tasa_cambio, monto_usd, referencia, fecha_pago, fecha_registro, nota
                    FROM detalles_pp_fallback
                ) u
                ORDER BY COALESCE(u.fecha_registro, u.fecha_pago) DESC, u.id DESC
            `;

            const detalles = await pool.query<PagoProveedorDetalleRow>(query, [gastoId]);
            return res.json({ status: 'success', pagos: detalles.rows });
        } catch (err: unknown) {
            const error = asError(err);
            return res.status(500).json({ status: 'error', message: error.message });
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
            const fechaPagoSafe = toIsoDate(fecha, 'fecha');
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
                    montoUsdExact: moneda === 'USD'
                        ? parseFloat(String(montoOrigen))
                        : (tasaCambio > 0 ? (montoOrigen / tasaCambio) : 0),
                    referencia: referenciaOrigen || 'N/A',
                };
            });
            for (const origen of origenesNormalizados) {
                if (!origen.fondoId) continue;
                const fechaSaldo = await getFondoFechaSaldo(origen.fondoId);
                if (!fechaSaldo) continue;
                const pagoDay = toEpochDay(fechaPagoSafe);
                const limiteDay = toEpochDay(fechaSaldo);
                if (Number.isFinite(pagoDay) && Number.isFinite(limiteDay) && pagoDay < limiteDay) {
                    throw new Error(`No está permitido este registro porque es previo a la fecha ${formatYmdToDmy(fechaSaldo)} registrada en la apertura del fondo.`);
                }
            }

            const montoTotalPagoUsd = round2(
                origenesNormalizados.reduce((acc: number, origen) => acc + origen.montoUsd, 0)
            );
            const montoTotalPagoUsdExact = origenesNormalizados.reduce(
                (acc: number, origen) => acc + (Number.isFinite(origen.montoUsdExact) ? origen.montoUsdExact : 0),
                0
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
            const referencias = origenesNormalizados
                .map((origen) => origen.referencia?.trim())
                .filter((ref): ref is string => Boolean(ref));
            const referenciaPago = referencias.length > 0 ? referencias.join(' | ') : 'N/A';
            const tasaEfectiva = montoTotalPagoUsdExact > 0 && totalBs > 0
                ? round2(totalBs / montoTotalPagoUsdExact)
                : (montoTotalPagoUsd > 0 && totalBs > 0 ? round2(totalBs / montoTotalPagoUsd) : null);

            const pagoProveedorRes = await pool.query<IPagoInsertRow>(
                `
                INSERT INTO pagos_proveedores (gasto_id, fondo_id, monto_bs, tasa_cambio, monto_usd, referencia, fecha_pago, nota)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
                `,
                [gasto_id, null, totalBs > 0 ? totalBs : null, tasaEfectiva, montoTotalPagoUsd, referenciaPago, fechaPagoSafe, nota || null]
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
            const gpfColsRes = await pool.query<IColumnNameRow>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'gastos_pagos_fondos'
                  AND column_name IN ('cuenta_bancaria_id', 'monto_bs', 'tasa_cambio', 'referencia', 'nota', 'pago_proveedor_id')
                `
            );
            const gpfCols = new Set(gpfColsRes.rows.map((r) => r.column_name));

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

                const gpfInsertCols: string[] = ['gasto_id', 'fondo_id', 'monto_pagado_usd', 'fecha_pago'];
                const gpfInsertVals: Array<number | string | null> = [gasto_id, origen.fondoId, origen.montoUsd, fechaPagoSafe];
                if (gpfCols.has('cuenta_bancaria_id')) {
                    gpfInsertCols.push('cuenta_bancaria_id');
                    gpfInsertVals.push(origen.cuentaId);
                }
                if (gpfCols.has('monto_bs')) {
                    gpfInsertCols.push('monto_bs');
                    gpfInsertVals.push(origen.montoOrigen);
                }
                if (gpfCols.has('tasa_cambio')) {
                    gpfInsertCols.push('tasa_cambio');
                    gpfInsertVals.push(origen.tasaCambio);
                }
                if (gpfCols.has('referencia')) {
                    gpfInsertCols.push('referencia');
                    gpfInsertVals.push(origen.referencia || referenciaPago);
                }
                if (gpfCols.has('nota')) {
                    gpfInsertCols.push('nota');
                    gpfInsertVals.push((nota || '').trim() || null);
                }
                if (gpfCols.has('pago_proveedor_id')) {
                    gpfInsertCols.push('pago_proveedor_id');
                    gpfInsertVals.push(pagoProveedorId);
                }

                const gpfPlaceholders = gpfInsertVals.map((_, idx) => `$${idx + 1}`).join(', ');
                await pool.query(
                    `INSERT INTO gastos_pagos_fondos (${gpfInsertCols.join(', ')}) VALUES (${gpfPlaceholders})`,
                    gpfInsertVals
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
                error.message.includes('No está permitido este registro') ||
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
