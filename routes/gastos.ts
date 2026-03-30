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
    metodo_division_manual?: boolean;
    nombre?: string | null;
    nombre_legal?: string | null;
    rif?: string | null;
    admin_nombre?: string | null;
    admin_rif?: string | null;
    admin_correo?: string | null;
    logo_url?: string | null;
    aviso_msg_1?: string | null;
    aviso_msg_2?: string | null;
    aviso_msg_3?: string | null;
    aviso_msg_4?: string | null;
}

interface ICondominioMesRow {
    id: number;
    mes_actual: string | null;
}

interface IInsertedIdRow {
    id: number;
}

interface IGastoCuotaCheckRow {
    id: number;
}

interface IGastoImagenesRow {
    id?: number;
    condominio_id?: number;
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
    clasificacion: string | null;
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
    identificador: string;
    alicuota: string | number;
    saldo_actual: string | number;
}

interface ICuotaCierreRow {
    gasto_id: number;
    concepto: string;
    monto_total_bs: string | number;
    monto_total_usd: string | number;
    tasa_cambio: string | number;
    monto_cuota_usd: string | number;
    nota: string | null;
    clasificacion: string | null;
    tipo: string;
    zona_id: number | null;
    propiedad_id: number | null;
    zona_nombre: string | null;
    propiedad_identificador: string | null;
}

interface IFondoSnapshotRow {
    id: number;
    cuenta_bancaria_id: number | null;
    nombre: string;
    moneda: string | null;
    porcentaje_asignacion: string | number | null;
    saldo_actual: string | number;
    banco: string | null;
    apodo: string | null;
    visible_propietarios: boolean;
}

interface IPropiedadZonaRow {
    zona_id: number;
}

interface IPropiedadParticipanteRow {
    rol: string;
    nombre: string;
}

interface ICountRow {
    count: string;
}

interface ISumTotalRow {
    total: string | null;
}

interface IPeriodRow {
    anio: number;
    mes: number;
}

interface IBcvApiResponse {
    promedio?: string | number;
}

interface CreateGastoBody {
    proveedor_id: string | number;
    concepto: string;
    numero_documento?: string | null;
    monto_bs: unknown;
    tasa_cambio: unknown;
    total_cuotas: string | number;
    nota?: string | null;
    clasificacion?: string;
    tipo?: string;
    zona_id?: string | number | null;
    propiedad_id?: string | number | null;
    fecha_gasto?: string | null;
    remove_factura_img?: string | boolean | null;
    keep_imagenes?: string | string[] | null;
}

interface MetodoDivisionBody {
    metodo: string;
}

interface DeleteGastoParams {
    id?: string;
}

interface UpdateGastoParams {
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

const toNumber = (value: string | number | null | undefined): number => parseFloat(String(value ?? 0)) || 0;
const getCurrentYyyyMm = (): string => new Date().toISOString().slice(0, 7);
const getPreviousYyyyMm = (): string => {
    const now = new Date();
    now.setUTCDate(1);
    now.setUTCMonth(now.getUTCMonth() - 1);
    return now.toISOString().slice(0, 7);
};
const asYyyyMmOrCurrent = (value: unknown): string => (/^\d{4}-\d{2}$/.test(String(value || '').trim()) ? String(value).trim() : getCurrentYyyyMm());
const asYyyyMmOrPrevious = (value: unknown): string => (/^\d{4}-\d{2}$/.test(String(value || '').trim()) ? String(value).trim() : getPreviousYyyyMm());
const isImageMime = (mime: unknown): boolean => String(mime || '').toLowerCase().startsWith('image/');
const isPdfMime = (mime: unknown): boolean => String(mime || '').toLowerCase() === 'application/pdf';
const MAX_PDF_SIZE_BYTES = 1 * 1024 * 1024;

const removeUploadedFileSafe = (relativePath: string | null | undefined): void => {
    if (!relativePath) return;
    const normalized = String(relativePath).trim();
    if (!normalized.startsWith('/uploads/')) return;
    const relativeWithoutSlash = normalized.replace(/^\//, '');
    const fullPath = path.join(__dirname, '..', relativeWithoutSlash);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
};

const parseKeepImagenesFromBody = (raw: unknown, allowed: string[]): string[] => {
    if (raw === null || raw === undefined) return allowed;

    let parsed: unknown = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            parsed = trimmed.includes(',') ? trimmed.split(',').map((x) => x.trim()) : [trimmed];
        }
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const normalized = arr.map((x) => String(x || '').trim()).filter((x) => x.length > 0);
    return allowed.filter((path) => normalized.includes(path));
};

let ensureMetodoDivisionManualColumnPromise: Promise<void> | null = null;

const ensureMetodoDivisionManualColumn = async (pool: Pool): Promise<void> => {
    if (!ensureMetodoDivisionManualColumnPromise) {
        ensureMetodoDivisionManualColumnPromise = pool
            .query("ALTER TABLE condominios ADD COLUMN IF NOT EXISTS metodo_division_manual boolean NOT NULL DEFAULT false")
            .then(() => undefined);
    }
    await ensureMetodoDivisionManualColumnPromise;
};

const fetchBcvRateToday = async (): Promise<number> => {
    const response = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    if (!response.ok) {
        throw new Error('No se pudo obtener la tasa BCV del día.');
    }
    const data = await response.json() as IBcvApiResponse;
    const rate = toNumber(data?.promedio);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('La tasa BCV del día es inválida.');
    }
    return rate;
};

const toIsoDateOrNull = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

    throw new Error('fecha_gasto invalida. Use dd/mm/yyyy o yyyy-mm-dd.');
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

        const { proveedor_id, concepto, numero_documento, monto_bs, tasa_cambio, total_cuotas, nota, clasificacion, tipo, zona_id, propiedad_id, fecha_gasto, remove_factura_img } = req.body;

        let inTransaction = false;
        try {
            let facturaGuardada: string | null = null;
            const soportesGuardados: string[] = [];

            const files = req.files as UploadedFiles | undefined;
            if (files) {
                if (files.factura_img && files.factura_img.length > 0) {
                    const file = files.factura_img[0];
                    if (isPdfMime(file.mimetype)) {
                        const uniqueName = `factura_${Date.now()}_${Math.round(Math.random() * 1e9)}.pdf`;
                        fs.writeFileSync(path.join(uploadsDir, uniqueName), file.buffer);
                        facturaGuardada = `/uploads/gastos/${uniqueName}`;
                    } else
                    if (!isImageMime(file.mimetype)) {
                        return res.status(400).json({ status: 'error', message: 'La factura o recibo debe ser imagen o PDF valido.' });
                    } else {
                        const uniqueName = `factura_${Date.now()}_${Math.round(Math.random() * 1e9)}.webp`;
                        await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                        facturaGuardada = `/uploads/gastos/${uniqueName}`;
                    }
                }
                if (files.soportes && files.soportes.length > 0) {
                    for (const file of files.soportes) {
                        if (isPdfMime(file.mimetype)) {
                            if ((file.size || 0) > MAX_PDF_SIZE_BYTES) {
                                return res.status(400).json({ status: 'error', message: 'Cada PDF en soportes debe pesar maximo 1 MB.' });
                            }
                            const uniqueName = `soporte_${Date.now()}_${Math.round(Math.random() * 1e9)}.pdf`;
                            fs.writeFileSync(path.join(uploadsDir, uniqueName), file.buffer);
                            soportesGuardados.push(`/uploads/gastos/${uniqueName}`);
                            continue;
                        }
                        if (!isImageMime(file.mimetype)) {
                            return res.status(400).json({ status: 'error', message: 'Los soportes solo permiten imagenes o PDF.' });
                        }
                        const uniqueName = `soporte_${Date.now()}_${Math.round(Math.random() * 1e9)}.webp`;
                        await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                        soportesGuardados.push(`/uploads/gastos/${uniqueName}`);
                    }
                }
            }

            const m_bs = parseLocaleNumber(monto_bs);
            const t_c = parseLocaleNumber(tasa_cambio);
            const fechaGastoSafe = toIsoDateOrNull(fecha_gasto);

            const condoRes = await pool.query<ICondominioMesRow>('SELECT id, mes_actual FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (condoRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado para el administrador.' });
            }
            const condominio_id = condoRes.rows[0].id;
            const mes_actual = asYyyyMmOrPrevious(condoRes.rows[0].mes_actual);

            const monto_usd = (m_bs / t_c).toFixed(2);
            const monto_cuota_usd = (parseFloat(monto_usd) / parseInt(String(total_cuotas), 10)).toFixed(2);

            const mes_factura = fechaGastoSafe ? fechaGastoSafe.substring(0, 7) : mes_actual;
            const mes_inicio_cobro = mes_factura > mes_actual ? mes_factura : mes_actual;

            const dbTipo = tipo || 'Comun';
            const dbClasificacion = String(clasificacion || '').trim().toLowerCase() === 'fijo' ? 'Fijo' : 'Variable';
            const zId = dbTipo === 'Zona' || dbTipo === 'No Comun' ? (zona_id || null) : null;
            const pId = dbTipo === 'Individual' ? (propiedad_id || null) : null;
            const numeroDocSafe = String(numero_documento || '').trim();
            const notaSafe = String(nota || '').trim();
            const notaFinal = numeroDocSafe
                ? (notaSafe ? `Nro. recibo/factura: ${numeroDocSafe} | ${notaSafe}` : `Nro. recibo/factura: ${numeroDocSafe}`)
                : (notaSafe || null);

            const result = await pool.query<IInsertedIdRow>(
                `
            INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas, nota, clasificacion, tipo, zona_id, propiedad_id, fecha_gasto, factura_img, imagenes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id
        `,
                [condominio_id, proveedor_id, concepto, m_bs, t_c, monto_usd, total_cuotas, notaFinal, dbClasificacion, dbTipo, zId, pId, fechaGastoSafe, facturaGuardada, soportesGuardados]
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

    app.put('/gastos/:id', verifyToken, upload.fields([{ name: 'factura_img', maxCount: 1 }, { name: 'soportes', maxCount: 4 }]), async (req: Request<UpdateGastoParams, unknown, CreateGastoBody>, res: Response) => {
        const user = asAuthUser(req.user);
        if (!user.cedula.startsWith('J')) return res.status(403).json({ status: 'error', message: 'Acceso denegado' });

        const gastoId = parseInt(String(req.params.id || ''), 10);
        if (!Number.isFinite(gastoId) || gastoId <= 0) {
            return res.status(400).json({ status: 'error', message: 'ID de gasto invalido.' });
        }

        const { proveedor_id, concepto, numero_documento, monto_bs, tasa_cambio, total_cuotas, nota, clasificacion, tipo, zona_id, propiedad_id, fecha_gasto, remove_factura_img } = req.body;

        let inTransaction = false;
        try {
            const condoRes = await pool.query<ICondominioMesRow>('SELECT id, mes_actual FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (condoRes.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado para el administrador.' });
            }
            const condominio_id = condoRes.rows[0].id;
            const mes_actual = asYyyyMmOrPrevious(condoRes.rows[0].mes_actual);

            const ownGastoRes = await pool.query<IGastoImagenesRow>(
                'SELECT id, condominio_id, factura_img, imagenes FROM gastos WHERE id = $1 LIMIT 1',
                [gastoId]
            );
            const ownGasto = ownGastoRes.rows[0];
            if (!ownGasto || Number(ownGasto.condominio_id) !== Number(condominio_id)) {
                return res.status(404).json({ status: 'error', message: 'Gasto no encontrado.' });
            }

            const cuotasProcesadasRes = await pool.query<IGastoCuotaCheckRow>(
                "SELECT id FROM gastos_cuotas WHERE gasto_id = $1 AND COALESCE(estado, 'Pendiente') <> 'Pendiente' LIMIT 1",
                [gastoId]
            );
            if (cuotasProcesadasRes.rows.length > 0) {
                return res.status(400).json({ status: 'error', message: 'No se puede editar un gasto que ya fue incluido en aviso(s) de cobro.' });
            }

            let facturaGuardada: string | null = ownGasto.factura_img || null;
            const oldSoportes = Array.isArray(ownGasto.imagenes) ? ownGasto.imagenes : [];
            let soportesGuardados: string[] = parseKeepImagenesFromBody(req.body?.keep_imagenes, oldSoportes);
            const oldFactura = ownGasto.factura_img || null;
            const wantsRemoveFactura = ['1', 'true', 'on', 'si'].includes(String(remove_factura_img || '').trim().toLowerCase());

            const files = req.files as UploadedFiles | undefined;
            if (files) {
                if (files.factura_img && files.factura_img.length > 0) {
                    const file = files.factura_img[0];
                    if (isPdfMime(file.mimetype)) {
                        const uniqueName = `factura_${Date.now()}_${Math.round(Math.random() * 1e9)}.pdf`;
                        fs.writeFileSync(path.join(uploadsDir, uniqueName), file.buffer);
                        facturaGuardada = `/uploads/gastos/${uniqueName}`;
                    } else if (!isImageMime(file.mimetype)) {
                        return res.status(400).json({ status: 'error', message: 'La factura o recibo debe ser imagen o PDF valido.' });
                    } else {
                        const uniqueName = `factura_${Date.now()}_${Math.round(Math.random() * 1e9)}.webp`;
                        await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                        facturaGuardada = `/uploads/gastos/${uniqueName}`;
                    }
                }

                if (files.soportes && files.soportes.length > 0) {
                    for (const file of files.soportes) {
                        if (isPdfMime(file.mimetype)) {
                            if ((file.size || 0) > MAX_PDF_SIZE_BYTES) {
                                return res.status(400).json({ status: 'error', message: 'Cada PDF en soportes debe pesar maximo 1 MB.' });
                            }
                            const uniqueName = `soporte_${Date.now()}_${Math.round(Math.random() * 1e9)}.pdf`;
                            fs.writeFileSync(path.join(uploadsDir, uniqueName), file.buffer);
                            soportesGuardados.push(`/uploads/gastos/${uniqueName}`);
                            continue;
                        }
                        if (!isImageMime(file.mimetype)) {
                            return res.status(400).json({ status: 'error', message: 'Los soportes solo permiten imagenes o PDF.' });
                        }
                        const uniqueName = `soporte_${Date.now()}_${Math.round(Math.random() * 1e9)}.webp`;
                        await sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadsDir, uniqueName));
                        soportesGuardados.push(`/uploads/gastos/${uniqueName}`);
                    }
                }
            }

            if (soportesGuardados.length > 4) {
                return res.status(400).json({ status: 'error', message: 'No puedes tener mas de 4 soportes por gasto.' });
            }

            if (wantsRemoveFactura && !(files?.factura_img && files.factura_img.length > 0)) {
                facturaGuardada = null;
            }

            const m_bs = parseLocaleNumber(monto_bs);
            const t_c = parseLocaleNumber(tasa_cambio);
            const fechaGastoSafe = toIsoDateOrNull(fecha_gasto);
            const monto_usd = (m_bs / t_c).toFixed(2);
            const totalCuotasSafe = Math.max(1, parseInt(String(total_cuotas), 10) || 1);
            const monto_cuota_usd = (parseFloat(monto_usd) / totalCuotasSafe).toFixed(2);

            const mes_factura = fechaGastoSafe ? fechaGastoSafe.substring(0, 7) : mes_actual;
            const mes_inicio_cobro = mes_factura > mes_actual ? mes_factura : mes_actual;

            const dbTipo = tipo || 'Comun';
            const dbClasificacion = String(clasificacion || '').trim().toLowerCase() === 'fijo' ? 'Fijo' : 'Variable';
            const zId = dbTipo === 'Zona' || dbTipo === 'No Comun' ? (zona_id || null) : null;
            const pId = dbTipo === 'Individual' ? (propiedad_id || null) : null;
            const numeroDocSafe = String(numero_documento || '').trim();
            const notaSafe = String(nota || '').trim();
            const notaFinal = numeroDocSafe
                ? (notaSafe ? `Nro. recibo/factura: ${numeroDocSafe} | ${notaSafe}` : `Nro. recibo/factura: ${numeroDocSafe}`)
                : (notaSafe || null);

            await pool.query('BEGIN');
            inTransaction = true;

            await pool.query(
                `
                UPDATE gastos
                SET proveedor_id = $1,
                    concepto = $2,
                    monto_bs = $3,
                    tasa_cambio = $4,
                    monto_usd = $5,
                    total_cuotas = $6,
                    nota = $7,
                    clasificacion = $8,
                    tipo = $9,
                    zona_id = $10,
                    propiedad_id = $11,
                    fecha_gasto = $12,
                    factura_img = $13,
                    imagenes = $14
                WHERE id = $15
                `,
                [proveedor_id, concepto, m_bs, t_c, monto_usd, totalCuotasSafe, notaFinal, dbClasificacion, dbTipo, zId, pId, fechaGastoSafe, facturaGuardada, soportesGuardados, gastoId]
            );

            await pool.query('DELETE FROM gastos_cuotas WHERE gasto_id = $1', [gastoId]);
            for (let i = 1; i <= totalCuotasSafe; i += 1) {
                const mes_cuota = addMonths(mes_inicio_cobro, i - 1);
                await pool.query(
                    'INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, mes_asignado) VALUES ($1, $2, $3, $4)',
                    [gastoId, i, monto_cuota_usd, mes_cuota]
                );
            }

            await pool.query('COMMIT');
            inTransaction = false;

            if ((wantsRemoveFactura || (files?.factura_img && files.factura_img.length > 0)) && oldFactura && oldFactura !== facturaGuardada) {
                removeUploadedFileSafe(oldFactura);
            }
            oldSoportes
                .filter((filePath) => !soportesGuardados.includes(filePath))
                .forEach((filePath) => removeUploadedFileSafe(filePath));

            return res.json({ status: 'success', message: 'Gasto actualizado con exito.' });
        } catch (err: unknown) {
            if (inTransaction) {
                await pool.query('ROLLBACK');
            }
            const error = asError(err);
            return res.status(500).json({ error: error.message });
        }
    });

    app.get('/gastos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        const user = asAuthUser(req.user);
        if (!user.cedula.startsWith('J')) return res.status(403).json({ status: 'error' });
        try {
            const result = await pool.query<IGastoListRow>(
                `
            SELECT g.id as gasto_id, gc.id as cuota_id, g.concepto, g.monto_bs, g.tasa_cambio,
                   g.monto_usd as monto_total_usd, g.monto_pagado_usd, g.nota, g.clasificacion, p.nombre as proveedor,
                   gc.numero_cuota, g.total_cuotas, gc.monto_cuota_usd, gc.mes_asignado, gc.estado,
                   TO_CHAR(g.created_at, 'DD/MM/YYYY') as fecha_registro,
                   TO_CHAR(g.fecha_gasto, 'DD/MM/YYYY') as fecha_factura,
                    g.tipo, z.nombre as zona_nombre, prop.identificador as propiedad_identificador,
                    g.proveedor_id, g.zona_id, g.propiedad_id,
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
            await ensureMetodoDivisionManualColumn(pool);
            const condoRes = await pool.query<ICondominioConfigRow>('SELECT id, mes_actual, metodo_division, metodo_division_manual FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const { id: condominio_id, metodo_division: metodoDivisionActual } = condoRes.rows[0];
            const mes_actual = asYyyyMmOrPrevious(condoRes.rows[0]?.mes_actual);
            if (!condoRes.rows[0]?.mes_actual) {
                await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [mes_actual, condominio_id]);
            }
            const metodoDivisionManual = Boolean(condoRes.rows[0]?.metodo_division_manual);
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
            const alicuotasRes = await pool.query<IAlicuotaRow>('SELECT alicuota FROM propiedades WHERE condominio_id = $1 ORDER BY alicuota ASC', [condominio_id]);
            const alicuotas = alicuotasRes.rows.map((r) => parseFloat(String(r.alicuota)));
            let metodoDivisionEfectivo: 'Alicuota' | 'Partes Iguales' = metodoDivisionActual === 'Partes Iguales' ? 'Partes Iguales' : 'Alicuota';

            if (!metodoDivisionManual && alicuotas.length > 0) {
                const alicuotasNormalizadas = alicuotas.map((a) => Number(a || 0).toFixed(6));
                const sonDistintas = new Set(alicuotasNormalizadas).size > 1;
                const metodoAuto: 'Alicuota' | 'Partes Iguales' = sonDistintas ? 'Alicuota' : 'Partes Iguales';
                metodoDivisionEfectivo = metodoAuto;
                if (metodoDivisionActual !== metodoAuto) {
                    await pool.query('UPDATE condominios SET metodo_division = $1 WHERE id = $2', [metodoAuto, condominio_id]);
                }
            }
            res.json({
                status: 'success',
                mes_actual,
                mes_texto: formatMonthText(mes_actual),
                metodo_division: metodoDivisionEfectivo,
                gastos: gastosRes.rows,
                total_usd: total_usd.toFixed(2),
                alicuotas_disponibles: alicuotas,
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
            await ensureMetodoDivisionManualColumn(pool);
            await pool.query(
                'UPDATE condominios SET metodo_division = $1, metodo_division_manual = true WHERE admin_user_id = $2',
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

            const condoRes = await pool.query<ICondominioConfigRow>(
                `SELECT
                    id, mes_actual, metodo_division, nombre, nombre_legal, rif,
                    admin_nombre, admin_rif, admin_correo, logo_url,
                    aviso_msg_1, aviso_msg_2, aviso_msg_3, aviso_msg_4
                 FROM condominios
                 WHERE admin_user_id = $1
                 LIMIT 1`,
                [user.id]
            );
            const { id: condo_id, metodo_division } = condoRes.rows[0];
            const mes_actual = asYyyyMmOrPrevious(condoRes.rows[0]?.mes_actual);
            if (!condoRes.rows[0]?.mes_actual) {
                await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [mes_actual, condo_id]);
            }

            // ðŸ’¡ 1. Agregamos "saldo_actual" a la bÃºsqueda de propiedades
            const propRes = await pool.query<IPropiedadCierreRow>(
                'SELECT id, identificador, alicuota, saldo_actual FROM propiedades WHERE condominio_id = $1',
                [condo_id]
            );

            const cuotasRes = await pool.query<ICuotaCierreRow>(
                `SELECT
                    g.id AS gasto_id,
                    g.concepto,
                    g.monto_bs AS monto_total_bs,
                    g.monto_usd AS monto_total_usd,
                    g.tasa_cambio,
                    gc.monto_cuota_usd,
                    g.nota,
                    g.clasificacion,
                    g.tipo,
                    g.zona_id,
                    g.propiedad_id,
                    z.nombre AS zona_nombre,
                    gp.identificador AS propiedad_identificador
                 FROM gastos_cuotas gc
                 JOIN gastos g ON gc.gasto_id = g.id
                 LEFT JOIN zonas z ON z.id = g.zona_id
                 LEFT JOIN propiedades gp ON gp.id = g.propiedad_id
                 WHERE g.condominio_id = $1
                   AND gc.mes_asignado = $2
                   AND gc.estado = 'Pendiente'`,
                [condo_id, mes_actual]
            );

            const fondosRes = await pool.query<IFondoSnapshotRow>(
                `SELECT
                    f.id,
                    f.cuenta_bancaria_id,
                    f.nombre,
                    f.moneda,
                    f.porcentaje_asignacion,
                    f.saldo_actual,
                    cb.nombre_banco AS banco,
                    cb.apodo,
                    COALESCE(f.visible_propietarios, true) AS visible_propietarios
                 FROM fondos f
                 LEFT JOIN cuentas_bancarias cb ON cb.id = f.cuenta_bancaria_id
                 WHERE f.condominio_id = $1
                   AND COALESCE(f.activo, true) = true
                 ORDER BY f.id ASC`,
                [condo_id]
            );

            const periodoRes = await pool.query<IPeriodRow>(
                `
                SELECT
                  CAST(SPLIT_PART($1, '-', 1) AS integer) AS anio,
                  CAST(SPLIT_PART($1, '-', 2) AS integer) AS mes
                `,
                [mes_actual]
            );
            const anioCorte = periodoRes.rows[0]?.anio;
            const mesCorte = periodoRes.rows[0]?.mes;
            const tasaCorte = await fetchBcvRateToday();

            if (anioCorte && mesCorte) {
                for (const fondo of fondosRes.rows) {
                    const saldo = toNumber(fondo.saldo_actual);
                    const esBs = String(fondo.moneda || '').toUpperCase() === 'BS';
                    const saldoBs = esBs ? saldo : saldo * tasaCorte;
                    const saldoUsd = esBs ? (tasaCorte > 0 ? saldo / tasaCorte : 0) : saldo;

                    await pool.query(
                        `
                        INSERT INTO cortes_estado_cuenta_fondos (
                          condominio_id,
                          recibo_generado_id,
                          anio,
                          mes,
                          fondo_id,
                          cuenta_bancaria_id,
                          nombre_fondo,
                          nombre_banco,
                          apodo_cuenta,
                          moneda,
                          saldo_actual,
                          saldo_bs,
                          saldo_usd,
                          tasa_referencia,
                          visible_propietarios
                        ) VALUES (
                          $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
                        )
                        ON CONFLICT (condominio_id, anio, mes, fondo_id)
                        DO UPDATE SET
                          cuenta_bancaria_id = EXCLUDED.cuenta_bancaria_id,
                          nombre_fondo = EXCLUDED.nombre_fondo,
                          nombre_banco = EXCLUDED.nombre_banco,
                          apodo_cuenta = EXCLUDED.apodo_cuenta,
                          moneda = EXCLUDED.moneda,
                          saldo_actual = EXCLUDED.saldo_actual,
                          saldo_bs = EXCLUDED.saldo_bs,
                          saldo_usd = EXCLUDED.saldo_usd,
                          tasa_referencia = EXCLUDED.tasa_referencia,
                          visible_propietarios = EXCLUDED.visible_propietarios,
                          created_at = now()
                        `,
                        [
                            condo_id,
                            anioCorte,
                            mesCorte,
                            fondo.id,
                            fondo.cuenta_bancaria_id,
                            fondo.nombre,
                            fondo.banco,
                            fondo.apodo,
                            String(fondo.moneda || 'BS'),
                            saldo,
                            Number(saldoBs.toFixed(2)),
                            Number(saldoUsd.toFixed(2)),
                            tasaCorte > 0 ? Number(tasaCorte.toFixed(4)) : null,
                            Boolean(fondo.visible_propietarios),
                        ]
                    );
                }
            }

            const perfilCondo = condoRes.rows[0];
            const mensajesSnapshot = [
                perfilCondo.aviso_msg_1,
                perfilCondo.aviso_msg_2,
                perfilCondo.aviso_msg_3,
                perfilCondo.aviso_msg_4,
            ].map((m) => String(m ?? '').trim()).filter((m) => m.length > 0);

            for (const p of propRes.rows) {
                let total_deuda = 0;
                const viejoSaldo = parseFloat(String(p.saldo_actual || 0)); // ðŸ’¡ Capturamos la plata que tenÃ­a a favor
                const gastosSnapshotRows: {
                    id: number;
                    concepto: string;
                    nota: string;
                    clasificacion: string;
                    tipo: string;
                    zona_nombre: string;
                    propiedad_identificador: string;
                    total_bs: number;
                    total_usd: number;
                    cuota_bs: number;
                    cuota_usd: number;
                }[] = [];

                const participantesRes = await pool.query<IPropiedadParticipanteRow>(
                    `SELECT up.rol, u.nombre
                     FROM usuarios_propiedades up
                     JOIN users u ON u.id = up.user_id
                     WHERE up.propiedad_id = $1
                       AND up.rol IN ('Propietario', 'Inquilino')
                     ORDER BY CASE WHEN up.rol = 'Propietario' THEN 0 ELSE 1 END, up.id ASC`,
                    [p.id]
                );
                const propietario = participantesRes.rows.find((r) => String(r.rol) === 'Propietario')?.nombre || 'Sin propietario';
                const inquilino = participantesRes.rows.find((r) => String(r.rol) === 'Inquilino')?.nombre || '';
                const titularMostrado = inquilino ? `${propietario} / Inquilino: ${inquilino}` : propietario;

                const zonasApto = await pool.query<IPropiedadZonaRow>('SELECT zona_id FROM propiedades_zonas WHERE propiedad_id = $1', [p.id]);
                const zonaIds = zonasApto.rows.map((z) => z.zona_id);

                for (const c of cuotasRes.rows) {
                    let cuotaPropiedadUsd = 0;

                    if (c.tipo === 'Comun' || c.tipo === 'Extra') {
                        if (metodo_division === 'Partes Iguales') cuotaPropiedadUsd = parseFloat(String(c.monto_cuota_usd)) / propRes.rows.length;
                        else cuotaPropiedadUsd = parseFloat(String(c.monto_cuota_usd)) * (parseFloat(String(p.alicuota)) / 100);
                    } else if ((c.tipo === 'No Comun' || c.tipo === 'Zona') && c.zona_id !== null && zonaIds.includes(c.zona_id)) {
                        const propsZona = await pool.query<ICountRow>('SELECT COUNT(*) FROM propiedades_zonas WHERE zona_id = $1', [c.zona_id]);
                        if (metodo_division === 'Partes Iguales') cuotaPropiedadUsd = parseFloat(String(c.monto_cuota_usd)) / parseInt(propsZona.rows[0].count, 10);
                        else {
                            const sumAl = await pool.query<ISumTotalRow>(
                                'SELECT SUM(p.alicuota) as total FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1',
                                [c.zona_id]
                            );
                            cuotaPropiedadUsd = parseFloat(String(c.monto_cuota_usd)) * (parseFloat(String(p.alicuota)) / parseFloat(String(sumAl.rows[0].total)));
                        }
                    } else if (c.tipo === 'Individual' && c.propiedad_id === p.id) {
                        cuotaPropiedadUsd = parseFloat(String(c.monto_cuota_usd));
                    }

                    if (cuotaPropiedadUsd > 0) {
                        total_deuda += cuotaPropiedadUsd;
                        const tasa = toNumber(c.tasa_cambio);
                        gastosSnapshotRows.push({
                            id: c.gasto_id,
                            concepto: c.concepto,
                            nota: String(c.nota || ''),
                            clasificacion: String(c.clasificacion || 'Variable'),
                            tipo: String(c.tipo || ''),
                            zona_nombre: String(c.zona_nombre || ''),
                            propiedad_identificador: String(c.propiedad_identificador || ''),
                            total_bs: toNumber(c.monto_total_bs),
                            total_usd: toNumber(c.monto_total_usd),
                            cuota_bs: cuotaPropiedadUsd * (tasa > 0 ? tasa : 1),
                            cuota_usd: cuotaPropiedadUsd,
                        });
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

                    const tasaRef = gastosSnapshotRows.length > 0
                        ? toNumber(gastosSnapshotRows[0].cuota_bs) / Math.max(toNumber(gastosSnapshotRows[0].cuota_usd), 0.0001)
                        : 1;
                    const totalCuotaUsd = toNumber(deudaFinal);
                    const saldoAntesUsd = viejoSaldo;
                    const saldoConAvisoUsd = viejoSaldo + totalCuotaUsd;
                    const saldoAntesBs = saldoAntesUsd * (tasaRef > 0 ? tasaRef : 1);
                    const saldoConAvisoBs = saldoConAvisoUsd * (tasaRef > 0 ? tasaRef : 1);

                    const fondosSnapshotRows = fondosRes.rows.map((f) => {
                        const pct = Math.max(0, toNumber(f.porcentaje_asignacion));
                        const incomingUsd = totalCuotaUsd * (pct / 100);
                        const incomingBs = incomingUsd * (tasaRef > 0 ? tasaRef : 1);
                        const saldo = toNumber(f.saldo_actual);
                        const isBs = String(f.moneda || '').toUpperCase() === 'BS';
                        const saldoActualBs = isBs ? saldo : saldo * (tasaRef > 0 ? tasaRef : 1);
                        const saldoActualUsd = isBs ? saldo / (tasaRef > 0 ? tasaRef : 1) : saldo;
                        const proyeccionBs = isBs ? saldo + incomingBs : (saldo + incomingUsd) * (tasaRef > 0 ? tasaRef : 1);
                        const proyeccionUsd = isBs ? (saldo + incomingBs) / (tasaRef > 0 ? tasaRef : 1) : saldo + incomingUsd;

                        return {
                            id: f.id,
                            banco_fondo: `${f.banco || 'Cuenta'} - ${f.apodo || f.nombre}`,
                            saldo_actual_bs: saldoActualBs,
                            saldo_actual_usd: saldoActualUsd,
                            proyeccion_bs: proyeccionBs,
                            proyeccion_usd: proyeccionUsd,
                        };
                    });

                    const snapshotAviso = {
                        mes_correspondiente: formatMonthText(mes_actual),
                        estado_recibo: 'Pendiente',
                        administradora: {
                            nombre: perfilCondo.admin_nombre || perfilCondo.nombre_legal || perfilCondo.nombre || '',
                            rif: perfilCondo.admin_rif || perfilCondo.rif || '',
                            correo: perfilCondo.admin_correo || '',
                            logo_url: perfilCondo.logo_url || null,
                        },
                        condominio: {
                            nombre: perfilCondo.nombre_legal || perfilCondo.nombre || '',
                            rif: perfilCondo.rif || '',
                            correo: perfilCondo.admin_correo || '',
                        },
                        inmueble: {
                            identificador: p.identificador,
                            alicuota: Number(parseFloat(String(p.alicuota || 0)).toFixed(3)),
                            propietario,
                            inquilino: inquilino || null,
                            titular_mostrado: titularMostrado,
                        },
                        saldo_cuenta: {
                            antes_aviso_bs: Number(saldoAntesBs.toFixed(2)),
                            antes_aviso_usd: Number(saldoAntesUsd.toFixed(2)),
                            con_aviso_bs: Number(saldoConAvisoBs.toFixed(2)),
                            con_aviso_usd: Number(saldoConAvisoUsd.toFixed(2)),
                        },
                        gastos: gastosSnapshotRows.map((g) => ({
                            ...g,
                            total_bs: Number(g.total_bs.toFixed(2)),
                            total_usd: Number(g.total_usd.toFixed(2)),
                            cuota_bs: Number(g.cuota_bs.toFixed(2)),
                            cuota_usd: Number(g.cuota_usd.toFixed(2)),
                        })),
                        fondos: fondosSnapshotRows.map((f) => ({
                            ...f,
                            saldo_actual_bs: Number(f.saldo_actual_bs.toFixed(2)),
                            saldo_actual_usd: Number(f.saldo_actual_usd.toFixed(2)),
                            proyeccion_bs: Number(f.proyeccion_bs.toFixed(2)),
                            proyeccion_usd: Number(f.proyeccion_usd.toFixed(2)),
                        })),
                        mensajes: mensajesSnapshot,
                    };

                    await pool.query(
                        'UPDATE recibos SET snapshot_jsonb = $1, snapshot_version = 1 WHERE id = $2',
                        [JSON.stringify(snapshotAviso), nuevoReciboId]
                    );

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
                            await pool.query(
                                `UPDATE recibos
                                 SET snapshot_jsonb = jsonb_set(
                                   COALESCE(snapshot_jsonb, '{}'::jsonb),
                                   '{estado_recibo}',
                                   to_jsonb('Pagado'::text),
                                   true
                                 )
                                 WHERE id = $1`,
                                [nuevoReciboId]
                            );
                        } else {
                            // Su saldo a favor no alcanzÃ³ para todo, se abona lo que tenÃ­a
                            await pool.query("UPDATE recibos SET monto_pagado_usd = $1, estado = 'Abonado' WHERE id = $2", [saldoAFavor, nuevoReciboId]);
                            await pool.query(
                                `UPDATE recibos
                                 SET snapshot_jsonb = jsonb_set(
                                   COALESCE(snapshot_jsonb, '{}'::jsonb),
                                   '{estado_recibo}',
                                   to_jsonb('Abonado'::text),
                                   true
                                 )
                                 WHERE id = $1`,
                                [nuevoReciboId]
                            );
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

    app.get('/gastos-extras-procesados', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condoRes = await pool.query<{id: number}>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            if (condoRes.rows.length === 0) return res.status(404).json({status:'error'});
            
            const condoId = condoRes.rows[0].id;

            const result = await pool.query(
                `
                SELECT DISTINCT g.id, g.concepto, g.monto_usd, COALESCE(g.monto_pagado_usd, 0) as monto_pagado_usd, (g.monto_usd - COALESCE(g.monto_pagado_usd, 0)) as deuda_restante
                FROM gastos g
                JOIN gastos_cuotas gc ON g.id = gc.gasto_id
                WHERE g.condominio_id = $1 AND g.tipo = 'Extra' AND gc.estado = 'Procesado'
                  AND (g.monto_usd - COALESCE(g.monto_pagado_usd, 0)) > 0
                ORDER BY g.id DESC
                `,
                [condoId]
            );

            res.json({ status: 'success', gastos: result.rows });
        } catch (err: unknown) {
            res.status(500).json({ error: asError(err).message });
        }
    });
};

module.exports = { registerGastosRoutes };

