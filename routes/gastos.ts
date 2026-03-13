import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

const fs: typeof import('fs') = require('fs');
const path: typeof import('path') = require('path');
const multer: typeof import('multer') = require('multer');
const sharp: typeof import('sharp') = require('sharp');

interface AuthUser {
    id: number;
    cedula: string;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
    parseLocaleNumber: (value: unknown) => number;
    addMonths: (yyyyMm: string, offset: number) => string;
    formatMonthText: (yyyyMm: string) => string;
}

interface ICondominioBaseRow {
    id: number;
}

interface ICondominioConfigRow {
    id: number;
    mes_actual: string;
    metodo_division: 'Alicuota' | 'Partes Iguales' | string;
}

interface ICondominioMesRow {
    id: number;
    mes_actual: string;
}

interface IInsertedIdRow {
    id: number;
}

interface IGastoCuotaCheckRow {
    id: number;
}

interface IGastoImagenesRow {
    factura_img: string | null;
    imagenes: string[] | null;
}

interface IGastoListRow extends Record<string, unknown> {
    gasto_id: number;
    cuota_id: number;
    concepto: string;
    monto_bs: string | number;
    tasa_cambio: string | number;
    monto_total_usd: string | number;
    monto_pagado_usd: string | number | null;
    nota: string | null;
    proveedor: string;
    numero_cuota: number;
    total_cuotas: number;
    monto_cuota_usd: string | number;
    mes_asignado: string;
    estado: string | null;
    fecha_registro: string;
    fecha_factura: string | null;
    tipo: string;
    zona_nombre: string | null;
    propiedad_identificador: string | null;
    factura_img: string | null;
    imagenes: string[] | null;
    saldo_pendiente: string | number;
}

interface IPreliminarGastoRow {
    concepto: string;
    monto_cuota_usd: string | number;
    numero_cuota: number;
    total_cuotas: number;
    proveedor: string;
    nota: string | null;
    monto_total_usd: string | number;
    mes_asignado: string;
    saldo_restante: string | number;
}

interface IAlicuotaRow {
    alicuota: string | number;
}

interface IPropiedadCierreRow {
    id: number;
    alicuota: string | number;
    saldo_actual: string | number;
}

interface ICuotaCierreRow {
    monto_cuota_usd: string | number;
    tipo: string;
    zona_id: number | null;
    propiedad_id: number | null;
}

interface IPropiedadZonaRow {
    zona_id: number;
}

interface ICountRow {
    count: string;
}

interface ISumTotalRow {
    total: string | null;
}

interface CreateGastoBody {
    proveedor_id: string | number;
    concepto: string;
    monto_bs: unknown;
    tasa_cambio: unknown;
    total_cuotas: string | number;
    nota?: string | null;
    tipo?: string;
    zona_id?: string | number | null;
    propiedad_id?: string | number | null;
    fecha_gasto?: string | null;
}

interface MetodoDivisionBody {
    metodo: string;
}

interface DeleteGastoParams {
    id?: string;
}

interface UploadedFiles {
    factura_img?: Express.Multer.File[];
    soportes?: Express.Multer.File[];
}

const asAuthUser = (value: unknown): AuthUser => {
    if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as { id?: unknown }).id !== 'number' ||
        typeof (value as { cedula?: unknown }).cedula !== 'string'
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

const registerGastosRoutes = (app: Application, { pool, verifyToken, parseLocaleNumber, addMonths, formatMonthText }: AuthDependencies): void => {
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'gastos');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
    });

    app.post('/gastos', verifyToken, upload.fields([{ name: 'factura_img', maxCount: 1 }, { name: 'soportes', maxCount: 4 }]), async (req: Request<{}, unknown, CreateGastoBody>, res: Response, _next: NextFunction) => {
        const user = asAuthUser(req.user);
        if (!user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });

        const { proveedor_id, concepto, monto_bs, tasa_cambio, total_cuotas, nota, tipo, zona_id, propiedad_id, fecha_gasto } = req.body;

        try {
            let facturaGuardada: string | null = null;
            const soportesGuardados: string[] = [];

            const files = req.files as UploadedFiles | undefined;
            if (files) {
                if (files.factura_img && files.factura_img.length > 0) {
                    const file = files.factura_img[0];
                    const uniqueName = `factura_${Date.now()}_${Math.round(Math.random() * 1e9)}.webp`;
                    await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                    facturaGuardada = `/uploads/gastos/${uniqueName}`;
                }
                if (files.soportes && files.soportes.length > 0) {
                    for (const file of files.soportes) {
                        const uniqueName = `soporte_${Date.now()}_${Math.round(Math.random() * 1e9)}.webp`;
                        await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                        soportesGuardados.push(`/uploads/gastos/${uniqueName}`);
                    }
                }
            }

            const m_bs = parseLocaleNumber(monto_bs);
            const t_c = parseLocaleNumber(tasa_cambio);

            const condoRes = await pool.query<ICondominioMesRow>('SELECT id, mes_actual FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condominio_id = condoRes.rows[0].id;
            const mes_actual = condoRes.rows[0].mes_actual;

            const monto_usd = (m_bs / t_c).toFixed(2);
            const monto_cuota_usd = (parseFloat(monto_usd) / parseInt(String(total_cuotas), 10)).toFixed(2);

            const mes_factura = fecha_gasto ? fecha_gasto.substring(0, 7) : mes_actual;
            const mes_inicio_cobro = mes_factura > mes_actual ? mes_factura : mes_actual;

            const dbTipo = tipo || 'Comun';
            const zId = dbTipo === 'Zona' || dbTipo === 'No Comun' ? (zona_id || null) : null;
            const pId = dbTipo === 'Individual' ? (propiedad_id || null) : null;

            const result = await pool.query<IInsertedIdRow>(
                `
            INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, nota, tipo, zona_id, propiedad_id, fecha_gasto, factura_img, imagenes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id
        `,
                [condominio_id, proveedor_id, concepto, m_bs, t_c, monto_usd, total_cuotas, nota, dbTipo, zId, pId, fecha_gasto || null, facturaGuardada, soportesGuardados]
            );

            for (let i = 1; i <= Number(total_cuotas); i += 1) {
                const mes_cuota = addMonths(mes_inicio_cobro, i - 1);
                await pool.query('INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, mes_asignado) VALUES ($1, $2, $3, $4)', [result.rows[0].id, i, monto_cuota_usd, mes_cuota]);
            }
            res.json({ status: 'success', message: 'Gasto registrado con exito.' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/gastos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        const user = asAuthUser(req.user);
        if (!user.cedula.startsWith('J')) return res.status(403).json({ status: 'error' });
        try {
            const result = await pool.query<IGastoListRow>(
                `
            SELECT g.id as gasto_id, gc.id as cuota_id, g.concepto, g.monto_bs, g.tasa_cambio,
                   g.monto_usd as monto_total_usd, g.monto_pagado_usd, g.nota, p.nombre as proveedor,
                   gc.numero_cuota, g.total_cuotas, gc.monto_cuota_usd, gc.mes_asignado, gc.estado,
                   TO_CHAR(g.created_at, 'DD/MM/YYYY') as fecha_registro,
                   TO_CHAR(g.fecha_gasto, 'DD/MM/YYYY') as fecha_factura,
                   g.tipo, z.nombre as zona_nombre, prop.identificador as propiedad_identificador,
                   g.factura_img, g.imagenes,
                   GREATEST(0, g.monto_usd - (gc.monto_cuota_usd * gc.numero_cuota)) as saldo_pendiente
            FROM gastos g
            JOIN gastos_cuotas gc ON g.id = gc.gasto_id
            JOIN proveedores p ON g.proveedor_id = p.id
            JOIN condominios c ON g.condominio_id = c.id
            LEFT JOIN zonas z ON g.zona_id = z.id
            LEFT JOIN propiedades prop ON g.propiedad_id = prop.id
            WHERE c.admin_user_id = $1 ORDER BY g.id DESC, gc.numero_cuota ASC
        `,
                [user.id]
            );
            res.json({ status: 'success', gastos: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.delete('/gastos/:id', verifyToken, async (req: Request<DeleteGastoParams>, res: Response, _next: NextFunction) => {
        try {
            const gastoId = asString(req.params.id);
            const cuotasCheck = await pool.query<IGastoCuotaCheckRow>("SELECT id FROM gastos_cuotas WHERE gasto_id = $1 AND estado != 'Pendiente'", [gastoId]);
            if (cuotasCheck.rows.length > 0) return res.status(400).json({ status: 'error', message: 'No puedes eliminar un gasto con cuotas procesadas.' });

            const imgRes = await pool.query<IGastoImagenesRow>('SELECT factura_img, imagenes FROM gastos WHERE id = $1', [gastoId]);
            const { factura_img, imagenes } = imgRes.rows[0] || {};

            await pool.query('DELETE FROM gastos_cuotas WHERE gasto_id = $1', [gastoId]);
            await pool.query('DELETE FROM gastos WHERE id = $1', [gastoId]);

            if (factura_img) {
                const fullPath = path.join(__dirname, '..', factura_img);
                if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            }

            if (imagenes && imagenes.length > 0) {
                imagenes.forEach((imgPath: string) => {
                    const fullPath = path.join(__dirname, '..', imgPath);
                    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                });
            }

            res.json({ status: 'success', message: 'Gasto eliminado.' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/preliminar', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condoRes = await pool.query<ICondominioConfigRow>('SELECT id, mes_actual, metodo_division FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const { id: condominio_id, mes_actual, metodo_division } = condoRes.rows[0];
            const gastosRes = await pool.query<IPreliminarGastoRow>(
                `
            SELECT g.concepto, gc.monto_cuota_usd, gc.numero_cuota, g.total_cuotas, p.nombre as proveedor, g.nota, g.monto_usd as monto_total_usd, gc.mes_asignado,
                (g.monto_usd - (gc.monto_cuota_usd * gc.numero_cuota)) as saldo_restante
            FROM gastos_cuotas gc JOIN gastos g ON gc.gasto_id = g.id JOIN proveedores p ON g.proveedor_id = p.id
            WHERE g.condominio_id = $1 AND gc.mes_asignado >= $2 AND (gc.estado = 'Pendiente' OR gc.estado IS NULL) AND g.tipo IN ('Comun', 'Extra') ORDER BY gc.mes_asignado ASC
        `,
                [condominio_id, mes_actual]
            );
            const total_usd = gastosRes.rows.filter((g) => g.mes_asignado === mes_actual).reduce((sum, item) => sum + parseFloat(String(item.monto_cuota_usd)), 0);
            const alicuotasRes = await pool.query<IAlicuotaRow>('SELECT DISTINCT alicuota FROM propiedades WHERE condominio_id = $1 ORDER BY alicuota ASC', [condominio_id]);
            res.json({
                status: 'success',
                mes_actual,
                mes_texto: formatMonthText(mes_actual),
                metodo_division,
                gastos: gastosRes.rows,
                total_usd: total_usd.toFixed(2),
                alicuotas_disponibles: alicuotasRes.rows.map((r) => parseFloat(String(r.alicuota))),
            });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });
    // ðŸ’¡ NUEVA RUTA: CAMBIAR REGLA DE DIVISIÃ“N DE GASTOS
    app.put('/metodo-division', verifyToken, async (req: Request<{}, unknown, MetodoDivisionBody>, res: Response, _next: NextFunction) => {
        const user = asAuthUser(req.user);
        const { metodo } = req.body;
        if (!['Alicuota', 'Partes Iguales'].includes(metodo)) {
            return res.status(400).json({ error: 'MÃ©todo invÃ¡lido.' });
        }
        try {
            await pool.query(
                'UPDATE condominios SET metodo_division = $1 WHERE admin_user_id = $2',
                [metodo, user.id]
            );
            res.json({ status: 'success', message: `MÃ©todo actualizado a ${metodo}` });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/cerrar-ciclo', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');

            const condoRes = await pool.query<ICondominioConfigRow>('SELECT id, mes_actual, metodo_division FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const { id: condo_id, mes_actual, metodo_division } = condoRes.rows[0];

            // ðŸ’¡ 1. Agregamos "saldo_actual" a la bÃºsqueda de propiedades
            const propRes = await pool.query<IPropiedadCierreRow>('SELECT id, alicuota, saldo_actual FROM propiedades WHERE condominio_id = $1', [condo_id]);

            const cuotasRes = await pool.query<ICuotaCierreRow>(
                `SELECT gc.monto_cuota_usd, g.tipo, g.zona_id, g.propiedad_id FROM gastos_cuotas gc JOIN gastos g ON gc.gasto_id = g.id WHERE g.condominio_id = $1 AND gc.mes_asignado = $2 AND gc.estado = 'Pendiente'`,
                [condo_id, mes_actual]
            );

            for (const p of propRes.rows) {
                let total_deuda = 0;
                const viejoSaldo = parseFloat(String(p.saldo_actual || 0)); // ðŸ’¡ Capturamos la plata que tenÃ­a a favor

                const zonasApto = await pool.query<IPropiedadZonaRow>('SELECT zona_id FROM propiedades_zonas WHERE propiedad_id = $1', [p.id]);
                const zonaIds = zonasApto.rows.map((z) => z.zona_id);

                for (const c of cuotasRes.rows) {
                    if (c.tipo === 'Comun' || c.tipo === 'Extra') {
                        if (metodo_division === 'Partes Iguales') total_deuda += parseFloat(String(c.monto_cuota_usd)) / propRes.rows.length;
                        else total_deuda += parseFloat(String(c.monto_cuota_usd)) * (parseFloat(String(p.alicuota)) / 100);
                    } else if ((c.tipo === 'No Comun' || c.tipo === 'Zona') && c.zona_id !== null && zonaIds.includes(c.zona_id)) {
                        const propsZona = await pool.query<ICountRow>('SELECT COUNT(*) FROM propiedades_zonas WHERE zona_id = $1', [c.zona_id]);
                        if (metodo_division === 'Partes Iguales') total_deuda += parseFloat(String(c.monto_cuota_usd)) / parseInt(propsZona.rows[0].count, 10);
                        else {
                            const sumAl = await pool.query<ISumTotalRow>(
                                'SELECT SUM(p.alicuota) as total FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1',
                                [c.zona_id]
                            );
                            total_deuda += parseFloat(String(c.monto_cuota_usd)) * (parseFloat(String(p.alicuota)) / parseFloat(String(sumAl.rows[0].total)));
                        }
                    } else if (c.tipo === 'Individual' && c.propiedad_id === p.id) {
                        total_deuda += parseFloat(String(c.monto_cuota_usd));
                    }
                }

                if (total_deuda > 0) {
                    const deudaFinal = total_deuda.toFixed(2);

                    // 1. Guardamos el recibo inicial
                    const recRes = await pool.query<IInsertedIdRow>(
                        "INSERT INTO recibos (propiedad_id, mes_cobro, monto_usd, estado) VALUES ($1, $2, $3, 'Aviso de Cobro') RETURNING id",
                        [p.id, formatMonthText(mes_actual), deudaFinal]
                    );
                    const nuevoReciboId = recRes.rows[0].id;

                    // 2. Aumentar la deuda global
                    await pool.query(
                        'UPDATE propiedades SET saldo_actual = saldo_actual + $1 WHERE id = $2',
                        [deudaFinal, p.id]
                    );

                    // ðŸŒŸ 3. RECONCILIACIÃ“N AUTOMÃTICA (El Autopago) ðŸŒŸ
                    if (viejoSaldo < 0) {
                        const saldoAFavor = Math.abs(viejoSaldo);

                        if (saldoAFavor >= total_deuda) {
                            // TenÃ­a suficiente dinero a favor para pagar el recibo entero
                            await pool.query("UPDATE recibos SET monto_pagado_usd = monto_usd, estado = 'Pagado' WHERE id = $1", [nuevoReciboId]);
                        } else {
                            // Su saldo a favor no alcanzÃ³ para todo, se abona lo que tenÃ­a
                            await pool.query("UPDATE recibos SET monto_pagado_usd = $1, estado = 'Abonado' WHERE id = $2", [saldoAFavor, nuevoReciboId]);
                        }
                    }
                }
            }

            await pool.query("UPDATE gastos_cuotas SET estado = 'Procesado' FROM gastos WHERE gastos_cuotas.gasto_id = gastos.id AND gastos.condominio_id = $1 AND gastos_cuotas.mes_asignado = $2", [condo_id, mes_actual]);

            const proximoMes = addMonths(mes_actual, 1);
            await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [proximoMes, condo_id]);

            await pool.query('COMMIT');
            res.json({ status: 'success', message: `Recibos generados y saldos actualizados. Avanzando a ${formatMonthText(proximoMes)}.` });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerGastosRoutes };

