import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

const fs: typeof import('fs') = require('fs');
const path: typeof import('path') = require('path');
const multer: typeof import('multer') = require('multer');
const sharp: typeof import('sharp') = require('sharp');

interface AuthUser {
    id: number;
    cedula?: string;
    condominio_id?: number | string;
    is_support_session?: boolean;
    support_condominio_id?: number | string;
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
    tipo?: string | null;
    nombre?: string | null;
    nombre_legal?: string | null;
    rif?: string | null;
    estado_venezuela?: string | null;
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
    tipo?: string | null;
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
    monto_pagado_proveedor_usd?: string | number | null;
    monto_recaudado_usd?: string | number | null;
    has_real_pago_proveedor?: boolean;
    cuotas_historicas?: number | string | null;
    monto_historico_proveedor_usd?: number | string | null;
    monto_historico_recaudado_usd?: number | string | null;
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

interface IJuntaMiembroPreliminar {
    id: number;
    nombre: string;
    rif: string;
    cuota_participacion: number;
    vinculada: boolean;
    es_fantasma: boolean;
    activo: boolean;
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

interface IColumnNameRow {
    column_name: string;
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
    cuotas_historicas?: string | number | null;
    monto_historico_proveedor_usd?: string | number | null;
    monto_historico_recaudado_usd?: string | number | null;
    tasa_historica?: string | number | null;
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
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('Invalid authenticated user');
    }
    const raw = value as AuthUser & { id?: unknown };
    const parsedId = parseInt(String(raw.id ?? ''), 10);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
        throw new TypeError('Invalid authenticated user');
    }
    return {
        ...raw,
        id: parsedId,
    };
};

const resolveCondominioBySession = async (pool: Pool, user: AuthUser): Promise<ICondominioConfigRow | null> => {
    const supportCondoId = user.is_support_session
        ? (() => {
            const n = parseInt(String(user.support_condominio_id ?? ''), 10);
            return Number.isFinite(n) && n > 0 ? n : null;
        })()
        : null;
    if (supportCondoId) {
        const bySupportId = await pool.query<ICondominioConfigRow>(
            `SELECT id, mes_actual, metodo_division, metodo_division_manual, tipo,
                    nombre, nombre_legal, rif, estado_venezuela,
                    admin_nombre, admin_rif, admin_correo, logo_url,
                    aviso_msg_1, aviso_msg_2, aviso_msg_3, aviso_msg_4
             FROM condominios
             WHERE id = $1
             LIMIT 1`,
            [supportCondoId]
        );
        if (bySupportId.rows[0]) return bySupportId.rows[0];
    }

    const tokenCondoId = (() => {
        const n = parseInt(String(user.condominio_id ?? ''), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    })();

    if (tokenCondoId) {
        const byId = await pool.query<ICondominioConfigRow>(
            `SELECT id, mes_actual, metodo_division, metodo_division_manual, tipo,
                    nombre, nombre_legal, rif, estado_venezuela,
                    admin_nombre, admin_rif, admin_correo, logo_url,
                    aviso_msg_1, aviso_msg_2, aviso_msg_3, aviso_msg_4
             FROM condominios
             WHERE id = $1
             LIMIT 1`,
            [tokenCondoId]
        );
        if (byId.rows[0]) return byId.rows[0];
    }

    const byAdmin = await pool.query<ICondominioConfigRow>(
        `SELECT id, mes_actual, metodo_division, metodo_division_manual, tipo,
                nombre, nombre_legal, rif, estado_venezuela,
                admin_nombre, admin_rif, admin_correo, logo_url,
                aviso_msg_1, aviso_msg_2, aviso_msg_3, aviso_msg_4
         FROM condominios
         WHERE admin_user_id = $1
         LIMIT 1`,
        [user.id]
    );
    return byAdmin.rows[0] || null;
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
const toPositiveInt = (value: unknown): number | null => {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
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
        throw new Error('No se pudo obtener la tasa BCV del dÃ­a.');
    }
    const data = await response.json() as IBcvApiResponse;
    const rate = toNumber(data?.promedio);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('La tasa BCV del dÃ­a es invÃ¡lida.');
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

const {
    ensureJuntaGeneralSchema,
    isJuntaGeneralTipo,
    listJuntaGeneralMiembrosActivos,
    resolveMetodoDivisionAutomatico,
    ensureProveedorForJuntaGeneral,
    normalizeRif,
}: {
    ensureJuntaGeneralSchema: (pool: Pool) => Promise<void>;
    isJuntaGeneralTipo: (tipo: unknown) => boolean;
    listJuntaGeneralMiembrosActivos: (pool: Pool, juntaGeneralId: number) => Promise<Array<Record<string, unknown>>>;
    resolveMetodoDivisionAutomatico: (cuotas: Array<string | number | null | undefined>, metodoActual: string | null | undefined) => 'Alicuota' | 'Partes Iguales';
    ensureProveedorForJuntaGeneral: (pool: Pool, input: {
        condominioId: number;
        juntaGeneralNombre: string;
        juntaGeneralRif: string;
        estadoVenezuela: string;
    }) => Promise<number>;
    normalizeRif: (value: unknown) => string;
} = require('../services/juntaGeneral');

const registerGastosRoutes = (app: Application, { pool, verifyToken, parseLocaleNumber, addMonths, formatMonthText }: AuthDependencies): void => {
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'gastos');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
    });
    const logJuntaGeneralAuditoria = async (input: {
        juntaGeneralId: number;
        actorUserId?: number | null;
        actorCondominioId?: number | null;
        accion: string;
        detalle?: Record<string, unknown> | null;
        before?: Record<string, unknown> | null;
        after?: Record<string, unknown> | null;
    }): Promise<void> => {
        await pool.query(
            `
            INSERT INTO junta_general_auditoria_eventos (
                junta_general_id, miembro_id, actor_user_id, actor_condominio_id,
                accion, detalle_jsonb, before_jsonb, after_jsonb
            ) VALUES ($1, NULL, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
            `,
            [
                input.juntaGeneralId,
                input.actorUserId ?? null,
                input.actorCondominioId ?? null,
                input.accion,
                JSON.stringify(input.detalle ?? null),
                JSON.stringify(input.before ?? null),
                JSON.stringify(input.after ?? null),
            ],
        );
    };

    const validateJerarquiaGastoInput = (input: {
        esJuntaGeneral: boolean;
        tipo: string;
        zonaId: unknown;
        propiedadId: unknown;
    }): string | null => {
        if (!input.esJuntaGeneral) return null;
        const hasPropiedad = input.propiedadId !== null && input.propiedadId !== undefined && String(input.propiedadId).trim() !== '';
        const tipo = String(input.tipo || '').trim();
        if (tipo === 'Individual' || hasPropiedad) {
            return 'La Junta General no puede asociar gastos a inmuebles individuales.';
        }
        const hasZona = input.zonaId !== null && input.zonaId !== undefined && String(input.zonaId).trim() !== '';
        if ((tipo === 'Zona' || tipo === 'No Comun') && !hasZona) {
            return 'Para gastos por zona debes indicar una zona válida.';
        }
        return null;
    };

    app.post('/gastos', verifyToken, upload.fields([{ name: 'factura_img', maxCount: 1 }, { name: 'soportes', maxCount: 4 }]), async (req: Request<{}, unknown, CreateGastoBody>, res: Response, _next: NextFunction) => {
        const user = asAuthUser(req.user);

        const {
            proveedor_id,
            concepto,
            numero_documento,
            monto_bs,
            tasa_cambio,
            total_cuotas,
            nota,
            clasificacion,
            tipo,
            zona_id,
            propiedad_id,
            fecha_gasto,
            cuotas_historicas,
            monto_historico_proveedor_usd,
            monto_historico_recaudado_usd,
            tasa_historica,
            remove_factura_img,
        } = req.body;

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

            const condo = await resolveCondominioBySession(pool, user);
            if (!condo) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado para la sesión activa.' });
            }
            const condominio_id = condo.id;
            const mes_actual = asYyyyMmOrPrevious(condo.mes_actual);
            const esJuntaGeneral = isJuntaGeneralTipo(condo.tipo);

            const totalCuotasSafe = Math.max(1, parseInt(String(total_cuotas), 10) || 1);
            const cuotasHistoricasSafe = Math.max(0, Math.trunc(parseLocaleNumber(cuotas_historicas || 0)));
            if (cuotasHistoricasSafe >= totalCuotasSafe) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Las cuotas históricas deben ser menores al total de cuotas.',
                });
            }

            const monto_usd = (m_bs / t_c).toFixed(2);
            const montoUsdNum = parseFloat(monto_usd);
            const montoCuotaUsdNum = Number((montoUsdNum / totalCuotasSafe).toFixed(2));
            const monto_cuota_usd = montoCuotaUsdNum.toFixed(2);
            const montoHistoricoProveedorUsdSafe = Number(parseLocaleNumber(monto_historico_proveedor_usd || 0).toFixed(2));
            if (montoHistoricoProveedorUsdSafe < 0 || montoHistoricoProveedorUsdSafe > Number(montoUsdNum.toFixed(2))) {
                return res.status(400).json({
                    status: 'error',
                    message: 'El pago histórico del proveedor debe estar entre 0 y el monto total del gasto.',
                });
            }
            const montoHistoricoRecaudadoUsdSafe = Number(parseLocaleNumber(monto_historico_recaudado_usd || 0).toFixed(2));
            if (montoHistoricoRecaudadoUsdSafe < 0 || montoHistoricoRecaudadoUsdSafe > Number(montoUsdNum.toFixed(2))) {
                return res.status(400).json({
                    status: 'error',
                    message: 'La recaudación histórica debe estar entre 0 y el monto total del gasto.',
                });
            }
            const tasaHistoricaSafe = Number(parseLocaleNumber(tasa_historica || 0).toFixed(4));
            if (tasaHistoricaSafe > 0) {
                const montoHistoricoProveedorBsSafe = Number((montoHistoricoProveedorUsdSafe * tasaHistoricaSafe).toFixed(2));
                const montoHistoricoRecaudadoBsSafe = Number((montoHistoricoRecaudadoUsdSafe * tasaHistoricaSafe).toFixed(2));
                if (montoHistoricoProveedorBsSafe > Number(m_bs) + 0.01) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'El pago histórico en Bs no puede superar el monto en Bs del gasto.',
                    });
                }
                if (montoHistoricoRecaudadoBsSafe > Number(m_bs) + 0.01) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'La recaudación histórica en Bs no puede superar el monto en Bs del gasto.',
                    });
                }
            }

            const mes_factura = fechaGastoSafe ? fechaGastoSafe.substring(0, 7) : mes_actual;
            const mes_inicio_base = mes_factura > mes_actual ? mes_factura : mes_actual;
            const mes_inicio_cobro = cuotasHistoricasSafe > 0
                ? addMonths(mes_actual, -cuotasHistoricasSafe)
                : mes_inicio_base;

            const dbTipo = tipo || 'Comun';
            const dbClasificacion = String(clasificacion || '').trim().toLowerCase() === 'fijo' ? 'Fijo' : 'Variable';
            const invalidJerarquiaMsg = validateJerarquiaGastoInput({
                esJuntaGeneral,
                tipo: dbTipo,
                zonaId: zona_id,
                propiedadId: propiedad_id,
            });
            if (invalidJerarquiaMsg) {
                return res.status(403).json({ status: 'error', message: invalidJerarquiaMsg });
            }
            const zId = dbTipo === 'Zona' || dbTipo === 'No Comun' ? (zona_id || null) : null;
            const pId = dbTipo === 'Individual' ? (propiedad_id || null) : null;
            const numeroDocSafe = String(numero_documento || '').trim();
            const notaSafe = String(nota || '').trim();
            const notaBase = numeroDocSafe
                ? (notaSafe ? `Nro. recibo/factura: ${numeroDocSafe} | ${notaSafe}` : `Nro. recibo/factura: ${numeroDocSafe}`)
                : (notaSafe || null);
            const metaHistorico: string[] = [];
            if (cuotasHistoricasSafe > 0) metaHistorico.push(`[hist.cuotas:${cuotasHistoricasSafe}]`);
            if (montoHistoricoProveedorUsdSafe > 0) metaHistorico.push(`[hist.proveedor_usd:${montoHistoricoProveedorUsdSafe.toFixed(2)}]`);
            if (montoHistoricoRecaudadoUsdSafe > 0) metaHistorico.push(`[hist.recaudado_usd:${montoHistoricoRecaudadoUsdSafe.toFixed(2)}]`);
            if (tasaHistoricaSafe > 0) metaHistorico.push(`[hist.tasa:${tasaHistoricaSafe.toFixed(4)}]`);
            const notaFinal = [notaBase, ...metaHistorico].filter(Boolean).join(' | ') || null;

            const result = await pool.query<IInsertedIdRow>(
                `
            INSERT INTO gastos (condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, monto_pagado_usd, total_cuotas, nota, clasificacion, tipo, zona_id, propiedad_id, fecha_gasto, factura_img, imagenes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id
        `,
                [condominio_id, proveedor_id, concepto, m_bs, t_c, monto_usd, montoHistoricoRecaudadoUsdSafe, totalCuotasSafe, notaFinal, dbClasificacion, dbTipo, zId, pId, fechaGastoSafe, facturaGuardada, soportesGuardados]
            );

            for (let i = 1; i <= totalCuotasSafe; i += 1) {
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

        const gastoId = parseInt(String(req.params.id || ''), 10);
        if (!Number.isFinite(gastoId) || gastoId <= 0) {
            return res.status(400).json({ status: 'error', message: 'ID de gasto invalido.' });
        }

        const {
            proveedor_id,
            concepto,
            numero_documento,
            monto_bs,
            tasa_cambio,
            total_cuotas,
            nota,
            clasificacion,
            tipo,
            zona_id,
            propiedad_id,
            fecha_gasto,
            cuotas_historicas,
            monto_historico_proveedor_usd,
            monto_historico_recaudado_usd,
            tasa_historica,
            remove_factura_img,
        } = req.body;

        let inTransaction = false;
        try {
            const condo = await resolveCondominioBySession(pool, user);
            if (!condo) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado para la sesión activa.' });
            }
            const condominio_id = condo.id;
            const mes_actual = asYyyyMmOrPrevious(condo.mes_actual);
            const esJuntaGeneral = isJuntaGeneralTipo(condo.tipo);

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
            const montoUsdNum = parseFloat(monto_usd);
            const totalCuotasSafe = Math.max(1, parseInt(String(total_cuotas), 10) || 1);
            const cuotasHistoricasSafe = Math.max(0, Math.trunc(parseLocaleNumber(cuotas_historicas || 0)));
            if (cuotasHistoricasSafe >= totalCuotasSafe) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Las cuotas históricas deben ser menores al total de cuotas.',
                });
            }
            const montoHistoricoProveedorUsdSafe = Number(parseLocaleNumber(monto_historico_proveedor_usd || 0).toFixed(2));
            if (montoHistoricoProveedorUsdSafe < 0 || montoHistoricoProveedorUsdSafe > Number(montoUsdNum.toFixed(2))) {
                return res.status(400).json({
                    status: 'error',
                    message: 'El pago histórico del proveedor debe estar entre 0 y el monto total del gasto.',
                });
            }
            const montoHistoricoRecaudadoUsdSafe = Number(parseLocaleNumber(monto_historico_recaudado_usd || 0).toFixed(2));
            if (montoHistoricoRecaudadoUsdSafe < 0 || montoHistoricoRecaudadoUsdSafe > Number(montoUsdNum.toFixed(2))) {
                return res.status(400).json({
                    status: 'error',
                    message: 'La recaudación histórica debe estar entre 0 y el monto total del gasto.',
                });
            }
            const tasaHistoricaSafe = Number(parseLocaleNumber(tasa_historica || 0).toFixed(4));
            if (tasaHistoricaSafe > 0) {
                const montoHistoricoProveedorBsSafe = Number((montoHistoricoProveedorUsdSafe * tasaHistoricaSafe).toFixed(2));
                const montoHistoricoRecaudadoBsSafe = Number((montoHistoricoRecaudadoUsdSafe * tasaHistoricaSafe).toFixed(2));
                if (montoHistoricoProveedorBsSafe > Number(m_bs) + 0.01) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'El pago histórico en Bs no puede superar el monto en Bs del gasto.',
                    });
                }
                if (montoHistoricoRecaudadoBsSafe > Number(m_bs) + 0.01) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'La recaudación histórica en Bs no puede superar el monto en Bs del gasto.',
                    });
                }
            }
            const monto_cuota_usd = (parseFloat(monto_usd) / totalCuotasSafe).toFixed(2);

            const mes_factura = fechaGastoSafe ? fechaGastoSafe.substring(0, 7) : mes_actual;
            const mes_inicio_base = mes_factura > mes_actual ? mes_factura : mes_actual;
            const mes_inicio_cobro = cuotasHistoricasSafe > 0
                ? addMonths(mes_actual, -cuotasHistoricasSafe)
                : mes_inicio_base;

            const dbTipo = tipo || 'Comun';
            const dbClasificacion = String(clasificacion || '').trim().toLowerCase() === 'fijo' ? 'Fijo' : 'Variable';
            const invalidJerarquiaMsg = validateJerarquiaGastoInput({
                esJuntaGeneral,
                tipo: dbTipo,
                zonaId: zona_id,
                propiedadId: propiedad_id,
            });
            if (invalidJerarquiaMsg) {
                return res.status(403).json({ status: 'error', message: invalidJerarquiaMsg });
            }
            const zId = dbTipo === 'Zona' || dbTipo === 'No Comun' ? (zona_id || null) : null;
            const pId = dbTipo === 'Individual' ? (propiedad_id || null) : null;
            const numeroDocSafe = String(numero_documento || '').trim();
            const notaSafe = String(nota || '').trim();
            const notaBase = numeroDocSafe
                ? (notaSafe ? `Nro. recibo/factura: ${numeroDocSafe} | ${notaSafe}` : `Nro. recibo/factura: ${numeroDocSafe}`)
                : (notaSafe || null);
            const metaHistorico: string[] = [];
            if (cuotasHistoricasSafe > 0) metaHistorico.push(`[hist.cuotas:${cuotasHistoricasSafe}]`);
            if (montoHistoricoProveedorUsdSafe > 0) metaHistorico.push(`[hist.proveedor_usd:${montoHistoricoProveedorUsdSafe.toFixed(2)}]`);
            if (montoHistoricoRecaudadoUsdSafe > 0) metaHistorico.push(`[hist.recaudado_usd:${montoHistoricoRecaudadoUsdSafe.toFixed(2)}]`);
            if (tasaHistoricaSafe > 0) metaHistorico.push(`[hist.tasa:${tasaHistoricaSafe.toFixed(4)}]`);
            const notaFinal = [notaBase, ...metaHistorico].filter(Boolean).join(' | ') || null;

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
                    imagenes = $14,
                    monto_pagado_usd = $15
                    WHERE id = $16
                `,
                [proveedor_id, concepto, m_bs, t_c, monto_usd, totalCuotasSafe, notaFinal, dbClasificacion, dbTipo, zId, pId, fechaGastoSafe, facturaGuardada, soportesGuardados, montoHistoricoRecaudadoUsdSafe, gastoId]
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
        try {
            const condo = await resolveCondominioBySession(pool, user);
            if (!condo) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado para la sesión activa.' });
            }
            const ppColsRes = await pool.query<IColumnNameRow>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'pagos_proveedores'
                  AND column_name IN ('es_ajuste_historico')
                `
            );
            const hasPpHistoricoCol = ppColsRes.rows.some((r) => r.column_name === 'es_ajuste_historico');
            const realPagoProveedorExpr = hasPpHistoricoCol
                ? "EXISTS (SELECT 1 FROM pagos_proveedores pp WHERE pp.gasto_id = g.id AND COALESCE(pp.es_ajuste_historico, false) = false)"
                : "EXISTS (SELECT 1 FROM pagos_proveedores pp WHERE pp.gasto_id = g.id)";
            const result = await pool.query<IGastoListRow>(
                `
            SELECT g.id as gasto_id, gc.id as cuota_id, g.concepto, g.monto_bs, g.tasa_cambio,
                   g.monto_usd as monto_total_usd, g.monto_pagado_usd,
                   (
                     COALESCE((SELECT SUM(pp.monto_usd) FROM pagos_proveedores pp WHERE pp.gasto_id = g.id), 0)
                     + COALESCE(((regexp_match(COALESCE(g.nota, ''), '\\[hist\\.proveedor_usd:([0-9]+(?:\\.[0-9]+)?)\\]'))[1])::numeric, 0)
                   ) AS monto_pagado_proveedor_usd,
                   LEAST(COALESCE(g.monto_usd, 0), COALESCE(g.monto_pagado_usd, 0)) AS monto_recaudado_usd,
                   ${realPagoProveedorExpr} AS has_real_pago_proveedor,
                    COALESCE(((regexp_match(COALESCE(g.nota, ''), '\\[hist\\.cuotas:(\\d+)\\]'))[1])::int, 0) AS cuotas_historicas,
                    COALESCE(((regexp_match(COALESCE(g.nota, ''), '\\[hist\\.proveedor_usd:([0-9]+(?:\\.[0-9]+)?)\\]'))[1])::numeric, 0) AS monto_historico_proveedor_usd,
                    COALESCE(((regexp_match(COALESCE(g.nota, ''), '\\[hist\\.recaudado_usd:([0-9]+(?:\\.[0-9]+)?)\\]'))[1])::numeric, 0) AS monto_historico_recaudado_usd,
                    g.nota, g.clasificacion, p.nombre as proveedor,
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
            WHERE g.condominio_id = $1 ORDER BY g.id DESC, gc.numero_cuota ASC
        `,
                [condo.id]
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

            const ppColsRes = await pool.query<IColumnNameRow>(
                `
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'pagos_proveedores'
                  AND column_name IN ('es_ajuste_historico')
                `
            );
            const hasPpHistoricoCol = ppColsRes.rows.some((r) => r.column_name === 'es_ajuste_historico');
            const pagosRealesQuery = hasPpHistoricoCol
                ? 'SELECT id FROM pagos_proveedores WHERE gasto_id = $1 AND COALESCE(es_ajuste_historico, false) = false LIMIT 1'
                : 'SELECT id FROM pagos_proveedores WHERE gasto_id = $1 LIMIT 1';
            const pagosRealesCheck = await pool.query<IGastoCuotaCheckRow>(pagosRealesQuery, [gastoId]);
            if (pagosRealesCheck.rows.length > 0) {
                return res.status(400).json({ status: 'error', message: 'No puedes eliminar un gasto con pagos reales al proveedor.' });
            }

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
            await ensureJuntaGeneralSchema(pool);
            const condo = await resolveCondominioBySession(pool, user);
            if (!condo) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            }
            const { id: condominio_id, metodo_division: metodoDivisionActual } = condo;
            const mes_actual = asYyyyMmOrPrevious(condo?.mes_actual);
            if (!condo?.mes_actual) {
                await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [mes_actual, condominio_id]);
            }
            const metodoDivisionManual = Boolean(condo?.metodo_division_manual);
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
            const esJuntaGeneral = isJuntaGeneralTipo(condo?.tipo);
            const miembrosGeneral = esJuntaGeneral ? await listJuntaGeneralMiembrosActivos(pool, condominio_id) : [];
            const alicuotas = esJuntaGeneral
                ? miembrosGeneral.map((r) => parseFloat(String(r.cuota_participacion || 0)))
                : (await pool.query<IAlicuotaRow>('SELECT alicuota FROM propiedades WHERE condominio_id = $1 ORDER BY alicuota ASC', [condominio_id])).rows.map((r) => parseFloat(String(r.alicuota)));
            const miembrosDistribucion: IJuntaMiembroPreliminar[] = esJuntaGeneral
                ? miembrosGeneral.map((m) => ({
                    id: Number(m.id || 0),
                    nombre: String(m.condominio_nombre || m.nombre_referencia || `Junta ${m.id}`),
                    rif: String(m.condominio_rif || m.rif || ''),
                    cuota_participacion: Number(toNumber(m.cuota_participacion as string | number | null).toFixed(6)),
                    vinculada: Boolean(m.condominio_individual_id),
                    es_fantasma: Boolean(m.es_fantasma || !m.condominio_individual_id),
                    activo: Boolean(m.activo !== false),
                }))
                : [];
            let metodoDivisionEfectivo: 'Alicuota' | 'Partes Iguales' = metodoDivisionActual === 'Partes Iguales' ? 'Partes Iguales' : 'Alicuota';

            if (!metodoDivisionManual && alicuotas.length > 0) {
                const metodoAuto = resolveMetodoDivisionAutomatico(alicuotas, metodoDivisionActual);
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
                jerarquia_objetivo: esJuntaGeneral ? 'Juntas Individuales' : 'Inmuebles',
                miembros_distribucion: miembrosDistribucion,
            });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });
    // Ã°Å¸â€™Â¡ NUEVA RUTA: CAMBIAR REGLA DE DIVISIÃƒâ€œN DE GASTOS
    app.put('/metodo-division', verifyToken, async (req: Request<{}, unknown, MetodoDivisionBody>, res: Response, _next: NextFunction) => {
        const user = asAuthUser(req.user);
        const { metodo } = req.body;
        if (!['Alicuota', 'Partes Iguales'].includes(metodo)) {
            return res.status(400).json({ error: 'MÃƒÂ©todo invÃƒÂ¡lido.' });
        }
        try {
            await ensureMetodoDivisionManualColumn(pool);
            const condo = await resolveCondominioBySession(pool, user);
            if (!condo) {
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            }
            await pool.query(
                'UPDATE condominios SET metodo_division = $1, metodo_division_manual = true WHERE id = $2',
                [metodo, condo.id]
            );
            if (isJuntaGeneralTipo(condo.tipo)) {
                await ensureJuntaGeneralSchema(pool);
                await logJuntaGeneralAuditoria({
                    juntaGeneralId: condo.id,
                    actorUserId: user.id,
                    actorCondominioId: condo.id,
                    accion: 'METODO_DIVISION_ACTUALIZADO',
                    detalle: {
                        jerarquia_objetivo: 'Juntas Individuales',
                    },
                    before: {
                        metodo_division: String(condo.metodo_division || 'Alicuota'),
                        metodo_division_manual: Boolean(condo.metodo_division_manual),
                    },
                    after: {
                        metodo_division: metodo,
                        metodo_division_manual: true,
                    },
                });
            }
            res.json({ status: 'success', message: `MÃƒÂ©todo actualizado a ${metodo}` });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/cerrar-ciclo', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');

            const condo = await resolveCondominioBySession(pool, user);
            if (!condo) {
                await pool.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Condominio no encontrado.' });
            }
            const condoRes = { rows: [condo] as ICondominioConfigRow[] };
            const { id: condo_id, metodo_division } = condoRes.rows[0];
            const mes_actual = asYyyyMmOrPrevious(condoRes.rows[0]?.mes_actual);
            if (!condoRes.rows[0]?.mes_actual) {
                await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [mes_actual, condo_id]);
            }

            // Ã°Å¸â€™Â¡ 1. Agregamos "saldo_actual" a la bÃƒÂºsqueda de propiedades
            const esJuntaGeneral = isJuntaGeneralTipo(condoRes.rows[0]?.tipo);
            if (esJuntaGeneral) {
                await ensureJuntaGeneralSchema(pool);
                const cuotasResGeneral = await pool.query<ICuotaCierreRow>(
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
                       AND gc.estado = 'Pendiente'
                       AND g.tipo IN ('Comun', 'Extra', 'Zona', 'No Comun')`,
                     [condo_id, mes_actual]
                 );
                const totalAvisoUsd = cuotasResGeneral.rows.reduce((acc, c) => acc + toNumber(c.monto_cuota_usd), 0);
                const totalAvisoBs = cuotasResGeneral.rows.reduce((acc, c) => acc + (toNumber(c.monto_cuota_usd) * Math.max(toNumber(c.tasa_cambio), 0)), 0);
                const tasaReferencia = totalAvisoUsd > 0 ? totalAvisoBs / totalAvisoUsd : 0;
                const miembros = await listJuntaGeneralMiembrosActivos(pool, condo_id);
                const miembrosActivos = miembros.filter((m) => Boolean(m.activo !== false));
                const metodoGeneral = (metodo_division === 'Partes Iguales' ? 'Partes Iguales' : 'Alicuota') as 'Partes Iguales' | 'Alicuota';
                const warnings: string[] = [];
                if (totalAvisoUsd <= 0) {
                    warnings.push('No hay gastos pendientes (comunes, extraordinarios o por zona) para distribuir en este periodo.');
                }
                if (totalAvisoUsd > 0 && miembrosActivos.length === 0) {
                    await pool.query('ROLLBACK');
                    return res.status(422).json({
                        status: 'error',
                        message: 'No se puede cerrar el mes: no hay juntas individuales activas para distribuir el aviso general.',
                        warnings,
                    });
                }
                if (totalAvisoUsd > 0 && metodoGeneral === 'Alicuota') {
                    const totalAlicuotas = miembrosActivos.reduce(
                        (acc, m) => acc + Math.max(0, toNumber(m.cuota_participacion as string | number | null)),
                        0
                    );
                    if (totalAlicuotas <= 0) {
                        await pool.query('ROLLBACK');
                        return res.status(422).json({
                            status: 'error',
                            message: 'No se puede cerrar el mes con metodo por alicuota: la suma de alicuotas activas es 0.',
                            warnings,
                        });
                    }
                }
                const distribucionResumen = {
                    metodo_division: metodoGeneral,
                    total_miembros: miembrosActivos.length,
                    total_usd: Number(totalAvisoUsd.toFixed(2)),
                    generados: 0,
                    fantasma: 0,
                    error: 0,
                    detalles: [] as Array<{
                        miembro_id: number | null;
                        nombre_junta: string;
                        rif: string;
                        monto_usd: number;
                        monto_bs: number;
                        estado: 'GENERADO' | 'FANTASMA' | 'ERROR';
                        nota?: string;
                        condominio_individual_id?: number | null;
                        gasto_generado_id?: number | null;
                    }>,
                };

                let avisoId: number | null = null;
                if (totalAvisoUsd > 0 && miembrosActivos.length > 0) {
                    const asignacionPorMiembro = new Map<number, {
                        miembro: Record<string, unknown>;
                        monto_usd: number;
                        monto_bs: number;
                    }>();
                    const erroresDistribucion: string[] = [];

                    const acumularAsignacion = (miembro: Record<string, unknown>, montoUsd: number, montoBs: number): void => {
                        const miembroId = Number(miembro.id || 0);
                        if (!miembroId) return;
                        const prev = asignacionPorMiembro.get(miembroId);
                        if (prev) {
                            prev.monto_usd = Number((prev.monto_usd + montoUsd).toFixed(2));
                            prev.monto_bs = Number((prev.monto_bs + montoBs).toFixed(2));
                            return;
                        }
                        asignacionPorMiembro.set(miembroId, {
                            miembro,
                            monto_usd: Number(montoUsd.toFixed(2)),
                            monto_bs: Number(montoBs.toFixed(2)),
                        });
                    };

                    for (const cuota of cuotasResGeneral.rows) {
                        const cuotaUsd = Number(toNumber(cuota.monto_cuota_usd).toFixed(2));
                        if (cuotaUsd <= 0) continue;

                        const tipoCuota = String(cuota.tipo || 'Comun').trim();
                        const zonaCuotaId = toPositiveInt(cuota.zona_id);
                        const aplicaPorZona = (tipoCuota === 'Zona' || tipoCuota === 'No Comun');

                        let candidatos = miembrosActivos;
                        if (aplicaPorZona) {
                            if (!zonaCuotaId) {
                                erroresDistribucion.push(`El gasto "${String(cuota.concepto || 'Sin concepto')}" requiere una zona válida.`);
                                continue;
                            }
                            candidatos = miembrosActivos.filter((m) => toPositiveInt(m.zona_id) === zonaCuotaId);
                            if (candidatos.length === 0) {
                                const zonaNombre = String(cuota.zona_nombre || `#${zonaCuotaId}`);
                                erroresDistribucion.push(`No hay juntas individuales activas asignadas a la zona "${zonaNombre}" para distribuir "${String(cuota.concepto || 'Sin concepto')}".`);
                                continue;
                            }
                        }

                        const totalPesos = candidatos.reduce((acc, m) => {
                            if (metodoGeneral === 'Partes Iguales') return acc + 1;
                            return acc + Math.max(0, toNumber(m.cuota_participacion as string | number | null));
                        }, 0);

                        if (totalPesos <= 0) {
                            const contexto = aplicaPorZona ? ` en zona ${String(cuota.zona_nombre || cuota.zona_id || '')}` : '';
                            erroresDistribucion.push(`No se puede distribuir por alicuota el gasto "${String(cuota.concepto || 'Sin concepto')}"${contexto}: la suma de alicuotas es 0.`);
                            continue;
                        }

                        let acumuladoCuotaUsd = 0;
                        const cuotaTasa = Math.max(toNumber(cuota.tasa_cambio), 0);
                        for (let idx = 0; idx < candidatos.length; idx += 1) {
                            const m = candidatos[idx];
                            const basePeso = metodoGeneral === 'Partes Iguales'
                                ? 1
                                : Math.max(0, toNumber(m.cuota_participacion as string | number | null));
                            const peso = totalPesos > 0 ? (basePeso / totalPesos) : 0;
                            let montoUsdAsignado = Number((cuotaUsd * peso).toFixed(2));
                            if (idx === candidatos.length - 1) {
                                montoUsdAsignado = Number((cuotaUsd - acumuladoCuotaUsd).toFixed(2));
                            }
                            acumuladoCuotaUsd = Number((acumuladoCuotaUsd + montoUsdAsignado).toFixed(2));
                            const montoBsAsignado = Number((montoUsdAsignado * cuotaTasa).toFixed(2));
                            acumularAsignacion(m as Record<string, unknown>, montoUsdAsignado, montoBsAsignado);
                        }
                    }

                    if (erroresDistribucion.length > 0) {
                        await pool.query('ROLLBACK');
                        return res.status(422).json({
                            status: 'error',
                            message: erroresDistribucion[0],
                            warnings: [...warnings, ...erroresDistribucion.slice(1)],
                        });
                    }

                    const miembrosConMonto = Array.from(asignacionPorMiembro.values())
                        .filter((it) => it.monto_usd > 0)
                        .sort((a, b) => Number(a.miembro.id || 0) - Number(b.miembro.id || 0));
                    if (miembrosConMonto.length === 0) {
                        await pool.query('ROLLBACK');
                        return res.status(422).json({
                            status: 'error',
                            message: 'No se pudo distribuir el aviso: no hay juntas objetivo para los gastos del periodo.',
                            warnings,
                        });
                    }
                    const totalDistribuidoUsd = Number(miembrosConMonto.reduce((acc, it) => acc + it.monto_usd, 0).toFixed(2));
                    const totalDistribuidoBs = Number(miembrosConMonto.reduce((acc, it) => acc + it.monto_bs, 0).toFixed(2));
                    distribucionResumen.total_usd = totalDistribuidoUsd;

                    const avisoRes = await pool.query<IInsertedIdRow>(
                        `INSERT INTO junta_general_avisos (junta_general_id, mes_origen, metodo_division, total_usd, total_bs, tasa_referencia, created_by_user_id)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)
                         RETURNING id`,
                        [
                            condo_id,
                            mes_actual,
                            metodoGeneral,
                            totalDistribuidoUsd,
                            totalDistribuidoBs,
                            Number(tasaReferencia.toFixed(6)),
                            user.id,
                        ]
                    );
                    avisoId = avisoRes.rows[0].id;

                    const generalNombre = String(condoRes.rows[0]?.nombre_legal || condoRes.rows[0]?.nombre || 'Junta General').trim();
                    const generalRif = normalizeRif(condoRes.rows[0]?.rif || '');
                    const estadoGeneral = String(condoRes.rows[0]?.estado_venezuela || 'Distrito Capital');
                    const conceptoGeneral = `Aviso Junta General - ${formatMonthText(mes_actual)}`;

                    for (const item of miembrosConMonto) {
                        const m = item.miembro;
                        const montoUsd = Number(item.monto_usd.toFixed(2));
                        const montoBs = Number(item.monto_bs.toFixed(2));

                        const detalleRes = await pool.query<IInsertedIdRow>(
                            `INSERT INTO junta_general_aviso_detalles (aviso_id, miembro_id, condominio_individual_id, monto_usd, monto_bs, estado)
                             VALUES ($1, $2, $3, $4, $5, $6)
                             RETURNING id`,
                            [avisoId, m.id as number, (m.condominio_individual_id as number | null) ?? null, montoUsd, montoBs, 'PENDIENTE']
                        );
                        const detalleId = detalleRes.rows[0].id;
                        const nombreJunta = String((m.condominio_nombre as string | null) || (m.nombre_referencia as string | null) || 'Junta Individual').trim();
                        const rifJunta = String((m.condominio_rif as string | null) || (m.rif as string | null) || '').trim();

                        const condominioIndividualId = (m.condominio_individual_id as number | null) ?? null;
                        if (!condominioIndividualId) {
                            await pool.query(
                                `UPDATE junta_general_aviso_detalles
                                 SET estado = 'FANTASMA',
                                     nota = 'Junta individual no vinculada en Habioo.'
                                 WHERE id = $1`,
                                [detalleId]
                            );
                            distribucionResumen.fantasma += 1;
                            distribucionResumen.detalles.push({
                                miembro_id: Number(m.id || 0) || null,
                                nombre_junta: nombreJunta,
                                rif: rifJunta,
                                monto_usd: Number(montoUsd.toFixed(2)),
                                monto_bs: Number(montoBs.toFixed(2)),
                                estado: 'FANTASMA',
                                nota: 'Junta individual no vinculada en Habioo.',
                                condominio_individual_id: null,
                                gasto_generado_id: null,
                            });
                            continue;
                        }

                        const condominioIndividualRes = await pool.query<ICondominioConfigRow>(
                            `SELECT id, mes_actual, estado_venezuela
                             FROM condominios
                             WHERE id = $1
                             LIMIT 1`,
                            [condominioIndividualId]
                        );
                        const condominioIndividual = condominioIndividualRes.rows[0];
                        if (!condominioIndividual) {
                            await pool.query(
                                `UPDATE junta_general_aviso_detalles
                                 SET estado = 'ERROR',
                                     nota = 'Condominio individual no encontrado.'
                                 WHERE id = $1`,
                                [detalleId]
                            );
                            distribucionResumen.error += 1;
                            distribucionResumen.detalles.push({
                                miembro_id: Number(m.id || 0) || null,
                                nombre_junta: nombreJunta,
                                rif: rifJunta,
                                monto_usd: Number(montoUsd.toFixed(2)),
                                monto_bs: Number(montoBs.toFixed(2)),
                                estado: 'ERROR',
                                nota: 'Condominio individual no encontrado.',
                                condominio_individual_id: condominioIndividualId,
                                gasto_generado_id: null,
                            });
                            continue;
                        }

                        const mesIndividual = asYyyyMmOrPrevious(condominioIndividual.mes_actual);
                        if (!condominioIndividual.mes_actual) {
                            await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [mesIndividual, condominioIndividual.id]);
                        }

                        const proveedorId = await ensureProveedorForJuntaGeneral(pool, {
                            condominioId: condominioIndividual.id,
                            juntaGeneralNombre: generalNombre,
                            juntaGeneralRif: generalRif,
                            estadoVenezuela: String(condominioIndividual.estado_venezuela || estadoGeneral || 'Distrito Capital'),
                        });

                        const notaOrigen = `Cargo automatico por aviso #${avisoId} de la Junta General (${formatMonthText(mes_actual)}).`;
                        const gastoGenerado = await pool.query<IInsertedIdRow>(
                            `INSERT INTO gastos (
                                condominio_id, proveedor_id, concepto, monto_bs, tasa_cambio, monto_usd, total_cuotas,
                                nota, clasificacion, tipo, zona_id, propiedad_id, fecha_gasto,
                                origen_tipo, origen_junta_general_id, origen_aviso_general_id, origen_detalle_general_id
                             ) VALUES (
                                $1, $2, $3, $4, $5, $6, 1,
                                $7, 'Variable', 'Comun', NULL, NULL, NOW(),
                                'JUNTA_GENERAL', $8, $9, $10
                             )
                             RETURNING id`,
                            [
                                condominioIndividual.id,
                                proveedorId,
                                conceptoGeneral,
                                montoBs,
                                Number(tasaReferencia.toFixed(6)),
                                montoUsd,
                                notaOrigen,
                                condo_id,
                                avisoId,
                                detalleId,
                            ]
                        );
                        const gastoId = gastoGenerado.rows[0].id;

                        await pool.query(
                            `INSERT INTO gastos_cuotas (gasto_id, numero_cuota, monto_cuota_usd, mes_asignado, estado)
                             VALUES ($1, 1, $2, $3, 'Pendiente')`,
                            [gastoId, montoUsd, mesIndividual]
                        );

                        await pool.query(
                            `UPDATE junta_general_aviso_detalles
                             SET gasto_generado_id = $1,
                                 proveedor_id = $2,
                                 estado = 'GENERADO',
                                 nota = 'Gasto generado en junta individual.'
                             WHERE id = $3`,
                            [gastoId, proveedorId, detalleId]
                        );
                        distribucionResumen.generados += 1;
                        distribucionResumen.detalles.push({
                            miembro_id: Number(m.id || 0) || null,
                            nombre_junta: nombreJunta,
                            rif: rifJunta,
                            monto_usd: Number(montoUsd.toFixed(2)),
                            monto_bs: Number(montoBs.toFixed(2)),
                            estado: 'GENERADO',
                            nota: 'Gasto generado en junta individual.',
                            condominio_individual_id: condominioIndividual.id,
                            gasto_generado_id: gastoId,
                        });

                        await pool.query(
                            `INSERT INTO junta_general_notificaciones (condominio_id, tipo, titulo, mensaje, metadata_jsonb)
                             VALUES ($1, 'AVISO_GENERAL_RECIBIDO', $2, $3, $4::jsonb)`,
                            [
                                condominioIndividual.id,
                                'Nuevo aviso de Junta General',
                                `Se agrego un gasto automatico por ${formatMonthText(mes_actual)} por USD ${montoUsd.toFixed(2)}.`,
                                JSON.stringify({ aviso_id: avisoId, detalle_id: detalleId, gasto_id: gastoId, junta_general_id: condo_id }),
                            ]
                        );
                    }
                }
                if (avisoId && distribucionResumen.fantasma > 0) {
                    warnings.push(`Quedaron ${distribucionResumen.fantasma} juntas pendientes por vinculacion en Habioo.`);
                }
                if (avisoId && distribucionResumen.error > 0) {
                    warnings.push(`Se detectaron ${distribucionResumen.error} juntas con error de procesamiento. Revisa el detalle de distribucion.`);
                }

                await pool.query("UPDATE gastos_cuotas SET estado = 'Procesado' FROM gastos WHERE gastos_cuotas.gasto_id = gastos.id AND gastos.condominio_id = $1 AND gastos_cuotas.mes_asignado = $2", [condo_id, mes_actual]);
                const proximoMesGeneral = addMonths(mes_actual, 1);
                await pool.query('UPDATE condominios SET mes_actual = $1 WHERE id = $2', [proximoMesGeneral, condo_id]);
                await logJuntaGeneralAuditoria({
                    juntaGeneralId: condo_id,
                    actorUserId: user.id,
                    actorCondominioId: condo_id,
                    accion: avisoId ? 'AVISO_GENERAL_GENERADO_Y_DISTRIBUIDO' : 'CIERRE_GENERAL_SIN_DISTRIBUCION',
                    detalle: {
                        aviso_id: avisoId,
                        mes_origen: mes_actual,
                        mes_siguiente: proximoMesGeneral,
                        metodo_division: metodoGeneral,
                        total_miembros: distribucionResumen.total_miembros,
                        total_usd: Number(distribucionResumen.total_usd.toFixed(2)),
                        generados: distribucionResumen.generados,
                        fantasma: distribucionResumen.fantasma,
                        error: distribucionResumen.error,
                        warnings,
                    },
                    before: {
                        mes_actual,
                    },
                    after: {
                        mes_actual: proximoMesGeneral,
                    },
                });
                await pool.query('COMMIT');
                return res.json({
                    status: 'success',
                    message: avisoId
                        ? `Aviso general generado y distribuido a juntas individuales. Avanzando a ${formatMonthText(proximoMesGeneral)}.`
                        : `No se encontraron montos para distribuir. Avanzando a ${formatMonthText(proximoMesGeneral)}.`,
                    aviso_general_id: avisoId,
                    distribucion: avisoId ? distribucionResumen : null,
                    warnings,
                });
            }

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
                const viejoSaldo = parseFloat(String(p.saldo_actual || 0)); // Ã°Å¸â€™Â¡ Capturamos la plata que tenÃƒÂ­a a favor
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
                    const tipoCuota = String(c.tipo || '').trim().toLowerCase();
                    const cuotaMontoUsd = parseFloat(String(c.monto_cuota_usd || 0));
                    const cuotaPropiedadId = parseInt(String(c.propiedad_id || ''), 10);

                    // Regla clave: gastos Individuales se cargan al 100% al inmueble objetivo.
                    if (tipoCuota === 'individual') {
                        if (Number.isFinite(cuotaPropiedadId) && cuotaPropiedadId === p.id) {
                            cuotaPropiedadUsd = cuotaMontoUsd;
                        }
                    } else if (tipoCuota === 'comun' || tipoCuota === 'extra') {
                        if (metodo_division === 'Partes Iguales') cuotaPropiedadUsd = cuotaMontoUsd / propRes.rows.length;
                        else cuotaPropiedadUsd = cuotaMontoUsd * (parseFloat(String(p.alicuota)) / 100);
                    } else if ((tipoCuota === 'no comun' || tipoCuota === 'zona') && c.zona_id !== null && zonaIds.includes(c.zona_id)) {
                        const propsZona = await pool.query<ICountRow>('SELECT COUNT(*) FROM propiedades_zonas WHERE zona_id = $1', [c.zona_id]);
                        if (metodo_division === 'Partes Iguales') cuotaPropiedadUsd = cuotaMontoUsd / parseInt(propsZona.rows[0].count, 10);
                        else {
                            const sumAl = await pool.query<ISumTotalRow>(
                                'SELECT SUM(p.alicuota) as total FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1',
                                [c.zona_id]
                            );
                            cuotaPropiedadUsd = cuotaMontoUsd * (parseFloat(String(p.alicuota)) / parseFloat(String(sumAl.rows[0].total)));
                        }
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

                    // Ã°Å¸Å’Å¸ 3. RECONCILIACIÃƒâ€œN AUTOMÃƒÂTICA (El Autopago) Ã°Å¸Å’Å¸
                    if (viejoSaldo < 0) {
                        const saldoAFavor = Math.abs(viejoSaldo);

                        if (saldoAFavor >= total_deuda) {
                            // TenÃƒÂ­a suficiente dinero a favor para pagar el recibo entero
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
                            // Su saldo a favor no alcanzÃƒÂ³ para todo, se abona lo que tenÃƒÂ­a
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
            const condo = await resolveCondominioBySession(pool, user);
            if (!condo) return res.status(404).json({ status: 'error' });
            const condoId = condo.id;

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


