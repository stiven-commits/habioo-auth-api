/**
 * carga-masiva.ts
 *
 * Rutas para carga masiva de pagos desde Excel vía IA / n8n.
 *
 * GET  /config/reglas-pago           → devuelve fondos + reglas del condominio (lo llama n8n antes de validar)
 * POST /pagos/carga-masiva           → recibe array de pagos validados desde n8n y los inserta (usa misma lógica de pagos-admin)
 * POST /chat/subir-excel-pagos       → recibe el Excel del usuario en el chat, lo envía al webhook de n8n
 */

import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

const multer: typeof import('multer') = require('multer');
const XLSX: typeof import('xlsx') = require('xlsx');
const https: typeof import('https') = require('https');
const http: typeof import('http') = require('http');
const { URL }: typeof import('url') = require('url');
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
    parseLocaleNumber: (value: unknown) => number;
    getPagosOptionalColumns: () => Promise<{
        nota?: boolean;
        banco_origen?: boolean;
        cedula_origen?: boolean;
        telefono_origen?: boolean;
    }>;
}

interface IFondoRow {
    id: number;
    nombre: string;
    moneda: string;
    porcentaje_asignacion: string | number;
    es_operativo: boolean;
    saldo_actual: string | number;
    activo: boolean;
    cuenta_bancaria_id: number;
}

interface ICuentaBancariaRow {
    id: number;
    apodo: string;
    nombre_banco: string;
    numero_cuenta: string;
    tipo: string;
}

interface IPropiedadRow {
    id: number;
    identificador: string;
    condominio_id: number;
}

interface IBancoOrigenRow {
    banco_origen: string;
}

// ── tipo de cada fila del Excel ya procesada por n8n ─────────────────────────
interface PagoFilaInput {
    fecha_pago: string;           // YYYY-MM-DD
    referencia: string;
    inmueble: string;             // identificador, ej "16-2"
    banco_origen: string;
    monto_bs: number;
    tasa_cambio: number;
    modo: 'distribuido' | 'fondo_unico';
    fondo_id?: number;            // solo si modo === 'fondo_unico'
    nota?: string;
}

interface FilaResultado {
    fila: number;
    referencia: string;
    inmueble: string;
    ok: boolean;
    pago_id?: number;
    error?: string;
}

interface CargaMasivaBody {
    pagos: PagoFilaInput[];
    condominio_id: number;
    cuenta_bancaria_id: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const asAuthUser = (u: unknown): AuthUser => {
    const user = u as { id?: unknown };
    if (!user || typeof user.id !== 'number') throw new Error('Usuario no autenticado.');
    return { id: user.id };
};

const verifyCargaServiceKey = (req: Request, res: Response): boolean => {
    const serviceKey = String(process.env.CHAT_SERVICE_KEY ?? '').trim();
    if (!serviceKey) {
        res.status(500).json({ error: 'CHAT_SERVICE_KEY no configurado.' });
        return false;
    }
    const provided = String(req.headers['x-chat-service-key'] ?? '').trim();
    if (provided !== serviceKey) {
        res.status(401).json({ error: 'Clave de servicio inválida.' });
        return false;
    }
    return true;
};

/** Llama a cualquier URL devolviendo el body JSON. */
const fetchJson = (url: string, options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
} = {}): Promise<{ status: number; body: unknown }> => {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        };
        const reqHttp = lib.request(reqOptions, (resp) => {
            let data = '';
            resp.on('data', (chunk) => { data += chunk; });
            resp.on('end', () => {
                try {
                    resolve({ status: resp.statusCode || 200, body: JSON.parse(data) });
                } catch {
                    resolve({ status: resp.statusCode || 200, body: data });
                }
            });
        });
        reqHttp.on('error', reject);
        if (options.body) reqHttp.write(options.body);
        reqHttp.end();
    });
};

// ── multer en memoria (solo para /chat/subir-excel-pagos) ─────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/octet-stream',
        ];
        const extOk = /\.(xlsx|xls)$/i.test(file.originalname);
        if (allowed.includes(file.mimetype) || extOk) return cb(null, true);
        cb(new Error('Solo se permiten archivos Excel (.xlsx / .xls)'));
    },
});

const registerCargaMasivaRoutes = (
    app: Application,
    { pool, verifyToken, parseLocaleNumber, getPagosOptionalColumns }: AuthDependencies,
): void => {

    // ══════════════════════════════════════════════════════════════════════════
    // GET /config/reglas-pago
    // n8n llama a este endpoint antes de procesar el Excel para conocer:
    //   - Fondos del condominio y sus porcentajes actuales
    //   - Columnas requeridas en el Excel
    //   - Bancos reconocidos en el sistema
    //   - Cuentas bancarias disponibles
    // Cuando el código de pagos.ts se actualice, este endpoint automáticamente
    // refleja la nueva lógica porque lee directamente de la DB + el propio .ts.
    // ══════════════════════════════════════════════════════════════════════════
    app.get('/config/reglas-pago', async (req: Request, res: Response) => {
        if (!verifyCargaServiceKey(req, res)) return;
        try {
            const condoId = parseInt(String(req.query.condominio_id || ''), 10);
            if (!condoId) return res.status(400).json({ error: 'condominio_id requerido.' });

            const condoRes = await pool.query<{ id: number; tipo: string | null }>(
                'SELECT id, tipo FROM condominios WHERE id = $1',
                [condoId],
            );
            if (!condoRes.rows.length) return res.status(404).json({ error: 'Condominio no encontrado.' });
            const condo = { id: condoRes.rows[0].id, tipo: condoRes.rows[0].tipo };

            if (isJuntaGeneralTipo(condo.tipo)) {
                return res.status(403).json({ error: 'La Junta General no puede gestionar pagos por inmueble.' });
            }

            const [fondosRes, cuentasRes, bancosRes] = await Promise.all([
                pool.query<IFondoRow>(
                    `SELECT f.id, f.nombre, f.moneda, f.porcentaje_asignacion, f.es_operativo, f.saldo_actual, f.activo, f.cuenta_bancaria_id
                     FROM fondos f
                     JOIN cuentas_bancarias cb ON cb.id = f.cuenta_bancaria_id
                     WHERE cb.condominio_id = $1 AND f.activo = true
                     ORDER BY f.es_operativo DESC, f.porcentaje_asignacion DESC`,
                    [condo.id],
                ),
                pool.query<ICuentaBancariaRow>(
                    `SELECT id, apodo, nombre_banco, numero_cuenta, tipo
                     FROM cuentas_bancarias
                     WHERE condominio_id = $1 AND activo = true
                     ORDER BY apodo`,
                    [condo.id],
                ),
                pool.query<IBancoOrigenRow>(
                    `SELECT DISTINCT banco_origen
                     FROM pagos p
                     JOIN propiedades pr ON pr.id = p.propiedad_id
                     WHERE pr.condominio_id = $1 AND banco_origen IS NOT NULL AND banco_origen != ''
                     ORDER BY banco_origen`,
                    [condo.id],
                ),
            ]);

            const fondos = fondosRes.rows.map((f) => ({
                id: f.id,
                nombre: f.nombre,
                porcentaje: parseFloat(String(f.porcentaje_asignacion || 0)),
                es_operativo: f.es_operativo,
                moneda: f.moneda,
                cuenta_bancaria_id: f.cuenta_bancaria_id,
            }));

            // Las columnas requeridas y validaciones se leen desde esta misma fuente de verdad.
            // Cuando este archivo cambie, n8n automáticamente usará las nuevas reglas.
            const reglasValidacion = {
                columnas_requeridas: [
                    { campo: 'Fecha operacion', tipo: 'fecha', formato: 'DD/MM/YYYY o YYYY-MM-DD', requerido: true },
                    { campo: 'Referencia', tipo: 'texto', requerido: true },
                    { campo: 'Inmueble', tipo: 'texto', descripcion: 'Identificador del inmueble (ej: 16-2)', requerido: true },
                    { campo: 'Banco origen', tipo: 'texto', requerido: true },
                    { campo: 'Pago', tipo: 'numero', descripcion: 'Monto en Bs', requerido: true },
                    { campo: 'Tasa', tipo: 'numero', descripcion: 'Tasa BCV del día', requerido: true },
                    { campo: 'Fondo', tipo: 'texto', descripcion: 'Nombre del fondo (vacío = distribuido entre todos)', requerido: false },
                ],
                validaciones: {
                    monto_minimo: 0.01,
                    tasa_minima: 1,
                    fecha_max_antiguedad_meses: 3,
                    fecha_no_futura: true,
                    modo_fondo_unico: 'Cuando la columna "Fondo" tiene un nombre de fondo válido, el 100% va a ese fondo',
                    modo_distribuido: 'Cuando "Fondo" está vacío, se distribuye según porcentaje_asignacion de cada fondo',
                },
                logica_distribucion: {
                    descripcion: 'Fondos no operativos reciben su porcentaje_asignacion. El fondo operativo recibe el remanente.',
                    fondos,
                },
            };

            res.json({
                condominio_id: condo.id,
                fondos,
                cuentas_bancarias: cuentasRes.rows,
                bancos_conocidos: bancosRes.rows.map((b) => b.banco_origen),
                reglas: reglasValidacion,
            });
        } catch (err) {
            console.error('[GET /config/reglas-pago]', err);
            res.status(500).json({ error: 'Error interno.' });
        }
    });

    // ══════════════════════════════════════════════════════════════════════════
    // POST /pagos/carga-masiva
    // Llamado por n8n con los pagos ya validados.
    // Replica exactamente la lógica de /pagos-admin (pagos.ts) para cada fila.
    // Soporta modo "distribuido" (% por fondo) y "fondo_unico" (100% a un fondo).
    // ══════════════════════════════════════════════════════════════════════════
    app.post('/pagos/carga-masiva', async (req: Request<{}, unknown, CargaMasivaBody>, res: Response) => {
        if (!verifyCargaServiceKey(req, res)) return;

        const { pagos, condominio_id, cuenta_bancaria_id } = req.body;

        if (!Array.isArray(pagos) || pagos.length === 0) {
            return res.status(400).json({ error: 'El array de pagos está vacío.' });
        }
        if (!condominio_id || !cuenta_bancaria_id) {
            return res.status(400).json({ error: 'condominio_id y cuenta_bancaria_id son requeridos.' });
        }

        const optionalCols = await getPagosOptionalColumns();
        const resultados: FilaResultado[] = [];

        // Verificar cuenta bancaria pertenece al condominio
        const cuentaCheck = await pool.query<{ id: number }>(
            'SELECT id FROM cuentas_bancarias WHERE id = $1 AND condominio_id = $2',
            [cuenta_bancaria_id, condominio_id],
        );
        if (!cuentaCheck.rows.length) {
            return res.status(403).json({ error: 'La cuenta bancaria no pertenece a este condominio.' });
        }

        for (let idx = 0; idx < pagos.length; idx++) {
            const fila = pagos[idx];
            const filaNum = idx + 1;

            const client = await (pool as unknown as {
                connect(): Promise<{
                    query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
                    release(): void;
                }>;
            }).connect();

            try {
                await client.query('BEGIN');

                // -- Validar e identificar propiedad --
                const propRes = await client.query<IPropiedadRow>(
                    'SELECT id, identificador, condominio_id FROM propiedades WHERE identificador = $1 AND condominio_id = $2',
                    [String(fila.inmueble || '').trim(), condominio_id],
                );
                if (!propRes.rows.length) {
                    await client.query('ROLLBACK');
                    resultados.push({ fila: filaNum, referencia: fila.referencia, inmueble: fila.inmueble, ok: false, error: `Inmueble "${fila.inmueble}" no encontrado en este condominio.` });
                    continue;
                }
                const propiedad = propRes.rows[0];

                // -- Calcular montos --
                const montoOrigen = round2(parseLocaleNumber(fila.monto_bs));
                const tasa = parseLocaleNumber(fila.tasa_cambio);
                const montoUsd = round2(montoOrigen / tasa);

                if (montoOrigen <= 0 || tasa <= 0) {
                    await client.query('ROLLBACK');
                    resultados.push({ fila: filaNum, referencia: fila.referencia, inmueble: fila.inmueble, ok: false, error: 'Monto o tasa inválidos.' });
                    continue;
                }

                // -- Insertar pago --
                const insertCols = [
                    'propiedad_id', 'cuenta_bancaria_id', 'monto_origen', 'tasa_cambio', 'monto_usd',
                    'moneda', 'referencia', 'fecha_pago', 'metodo', 'estado', 'es_ajuste_historico',
                ];
                const insertVals: unknown[] = [
                    propiedad.id, cuenta_bancaria_id, montoOrigen, tasa, montoUsd,
                    'BS', String(fila.referencia || '').trim(), fila.fecha_pago,
                    'Transferencia', 'Validado', false,
                ];

                if (optionalCols.nota) {
                    insertCols.push('nota');
                    insertVals.push(fila.nota
                        ? String(fila.nota).trim()
                        : `pago ref. ${fila.referencia} - ${fila.inmueble} | ${fila.banco_origen}`);
                }
                if (optionalCols.banco_origen) {
                    insertCols.push('banco_origen');
                    insertVals.push(String(fila.banco_origen || '').trim() || null);
                }

                const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
                const pagoRes = await client.query<{ id: number }>(
                    `INSERT INTO pagos (${insertCols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
                    insertVals,
                );
                const pagoId = pagoRes.rows[0].id;

                // -- Actualizar propiedad + historial_saldos_inmuebles --
                await client.query(
                    'UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) - $1 WHERE id = $2',
                    [montoUsd, propiedad.id],
                );
                await client.query(
                    'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, monto_bs, tasa_cambio, nota) VALUES ($1, $2, $3, $4, $5, $6)',
                    [propiedad.id, 'AGREGAR_FAVOR', montoUsd, montoOrigen, tasa,
                     `Pago validado (Ref: ${fila.referencia}) #${pagoId}`],
                );

                // -- Distribuir a fondos --
                if (fila.modo === 'fondo_unico' && fila.fondo_id) {
                    // 100% al fondo indicado
                    await client.query(
                        'UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2',
                        [montoOrigen, fila.fondo_id],
                    );
                    await client.query(
                        `INSERT INTO movimientos_fondos (fondo_id, tipo, monto, tasa_cambio, referencia_id, nota, fecha)
                         VALUES ($1, 'INGRESO_PAGO', $2, $3, $4, $5, $6)`,
                        [fila.fondo_id, montoOrigen, tasa, pagoId,
                         `Pago carga masiva | Ref: ${fila.referencia} | ${fila.inmueble} | 100% fondo único`,
                         fila.fecha_pago],
                    );
                } else {
                    // Distribución proporcional entre fondos
                    const fondosRes = await client.query<IFondoRow>(
                        `SELECT id, nombre, moneda, porcentaje_asignacion, es_operativo
                         FROM fondos WHERE cuenta_bancaria_id = $1 AND activo = true`,
                        [cuenta_bancaria_id],
                    );
                    const fondos = fondosRes.rows;
                    let distribuido = 0;
                    const operativo = fondos.find((f) => f.es_operativo);

                    for (const fondo of fondos) {
                        if (fondo.es_operativo) continue;
                        const pct = parseFloat(String(fondo.porcentaje_asignacion || 0)) / 100;
                        const monto = round2(montoOrigen * pct);
                        if (monto <= 0) continue;
                        distribuido = round2(distribuido + monto);

                        await client.query(
                            'UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2',
                            [monto, fondo.id],
                        );
                        await client.query(
                            `INSERT INTO movimientos_fondos (fondo_id, tipo, monto, tasa_cambio, referencia_id, nota, fecha)
                             VALUES ($1, 'INGRESO_PAGO', $2, $3, $4, $5, $6)`,
                            [fondo.id, monto, tasa, pagoId,
                             `Pago carga masiva | Ref: ${fila.referencia} | ${fila.inmueble}`,
                             fila.fecha_pago],
                        );
                    }

                    if (operativo) {
                        const remanente = round2(montoOrigen - distribuido);
                        if (remanente > 0) {
                            await client.query(
                                'UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2',
                                [remanente, operativo.id],
                            );
                            await client.query(
                                `INSERT INTO movimientos_fondos (fondo_id, tipo, monto, tasa_cambio, referencia_id, nota, fecha)
                                 VALUES ($1, 'INGRESO_PAGO', $2, $3, $4, $5, $6)`,
                                [operativo.id, remanente, tasa, pagoId,
                                 `Pago carga masiva | Ref: ${fila.referencia} | ${fila.inmueble} | remanente operativo`,
                                 fila.fecha_pago],
                            );
                        }
                    }
                }

                await client.query('COMMIT');
                resultados.push({ fila: filaNum, referencia: fila.referencia, inmueble: fila.inmueble, ok: true, pago_id: pagoId });
            } catch (err) {
                await client.query('ROLLBACK');
                const msg = err instanceof Error ? err.message : 'Error desconocido';
                resultados.push({ fila: filaNum, referencia: fila.referencia, inmueble: fila.inmueble, ok: false, error: msg });
            } finally {
                client.release();
            }
        }

        const exitosos = resultados.filter((r) => r.ok).length;
        const fallidos = resultados.filter((r) => !r.ok).length;

        res.json({
            total: pagos.length,
            exitosos,
            fallidos,
            resultados,
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // POST /chat/preview-carga-pagos
    // Valida el Excel y devuelve la preview directamente (sin pasar por n8n)
    // ══════════════════════════════════════════════════════════════════════════
    app.post(
        '/chat/preview-carga-pagos',
        verifyToken,
        async (req: Request, res: Response) => {
            try {
                const user = asAuthUser(req.user);
                const condo = await getCondominioByAdminUserId(pool, user.id);
                if (!condo) return res.status(404).json({ error: 'Condominio no encontrado.' });
                if (isJuntaGeneralTipo(condo.tipo)) {
                    return res.status(403).json({ error: 'La Junta General no puede cargar pagos.' });
                }

                const archivo = (req as unknown as { file?: Express.Multer.File }).file;
                if (!archivo) return res.status(400).json({ error: 'No se adjuntó ningún archivo.' });

                // Parsear Excel
                const workbook = XLSX.read(archivo.buffer, { type: 'buffer', cellDates: true });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) return res.status(400).json({ error: 'El archivo Excel está vacío.' });

                const sheet = workbook.Sheets[sheetName];
                const filasRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

                if (!filasRaw.length) {
                    return res.status(400).json({ error: 'La hoja Excel no contiene datos.' });
                }

                // Obtener fondos del condominio
                const fondosRes = await pool.query<{ id: number; nombre: string; moneda: string }>(
                    `SELECT f.id, f.nombre, f.moneda FROM fondos f
                     JOIN cuentas_bancarias cb ON cb.id = f.cuenta_bancaria_id
                     WHERE cb.condominio_id = $1 AND f.activo = true
                     ORDER BY f.es_operativo DESC, f.nombre ASC`,
                    [condo.id]
                );
                const fondos = fondosRes.rows.map(f => ({
                    id: f.id,
                    nombre: f.nombre,
                    moneda: f.moneda
                }));

                // Validar filas
                const pagosValidos: Array<{
                    fila: number;
                    fecha_pago: string;
                    referencia: string;
                    inmueble: string;
                    banco_origen: string;
                    monto_bs: number;
                    tasa_cambio: number;
                    monto_usd: number;
                    fondo_id: number | null;
                    modo: string;
                }> = [];
                const errores: Array<{
                    fila: number;
                    referencia: string;
                    inmueble: string;
                    errores: string[];
                    valid_funds: string[];
                }> = [];

                const norm = (s: string) => s.trim().toLowerCase()
                    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
                    .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o')
                    .replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');

                const findVal = (obj: Record<string, unknown>, names: string[]): unknown => {
                    const keys = Object.keys(obj);
                    for (const n of names) {
                        const nk = norm(n);
                        const k = keys.find(kk => norm(kk) === nk);
                        if (k !== undefined && obj[k] !== undefined && obj[k] !== '') return obj[k];
                    }
                    return undefined;
                };

                const parseDate = (val: unknown): string | null => {
                    if (val === null || val === undefined) return null;
                    if (val instanceof Date) {
                        const y = val.getFullYear();
                        const m = String(val.getMonth() + 1).padStart(2, '0');
                        const d = String(val.getDate()).padStart(2, '0');
                        return `${y}-${m}-${d}`;
                    }
                    const s = String(val).trim();
                    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
                    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
                    return null;
                };

                for (let i = 0; i < filasRaw.length; i++) {
                    const f = filasRaw[i];
                    const filaErrores: string[] = [];
                    const filaNum = i + 1;

                    const fechaRaw = findVal(f, ['Fecha operacion', 'Fecha operación', 'Fecha']);
                    const referencia = String(findVal(f, ['Referencia', 'Ref']) ?? '').trim();
                    const inmueble = String(findVal(f, ['Inmueble', 'Unidad']) ?? '').trim();
                    const bancoOrigen = String(findVal(f, ['Banco origen', 'Banco Origen', 'Banco']) ?? '').trim();
                    const montoRaw = findVal(f, ['Pago', 'Monto', 'Monto Bs', 'Monto BS']);
                    const tasaRaw = findVal(f, ['Tasa', 'Tasa BCV', 'Tasa Cambio']);
                    const fondoNombre = String(findVal(f, ['Fondo']) ?? '').trim();

                    const fecha_pago = parseDate(fechaRaw);
                    if (!fecha_pago) filaErrores.push('Fecha inválida o vacía');

                    if (!referencia) filaErrores.push('Referencia vacía');
                    if (!inmueble) filaErrores.push('Inmueble vacío');
                    if (!bancoOrigen) filaErrores.push('Banco origen vacío');

                    const montoStr = String(montoRaw ?? '').replace(/\./g, '').replace(',', '.');
                    const monto = parseFloat(montoStr);
                    if (isNaN(monto) || monto <= 0) filaErrores.push('Monto inválido o debe ser > 0');

                    const tasaStr = String(tasaRaw ?? '').replace(/\./g, '').replace(',', '.');
                    const tasa = parseFloat(tasaStr);
                    if (isNaN(tasa) || tasa < 1) filaErrores.push('Tasa inválida (debe ser >= 1)');

                    let modo = 'distribuido';
                    let fondoId: number | null = null;
                    const validFunds: string[] = [];

                    if (fondoNombre && fondos.length > 0) {
                        const fEnc = fondos.find(fd => norm(fd.nombre) === norm(fondoNombre));
                        if (!fEnc) {
                            validFunds.push(...fondos.map(fd => fd.nombre));
                            filaErrores.push(`Fondo "${fondoNombre}" no existe. Válidos: ${fondos.map(fd => fd.nombre).join(', ')}`);
                        } else {
                            modo = 'fondo_unico';
                            fondoId = fEnc.id;
                        }
                    }

                    if (filaErrores.length > 0) {
                        errores.push({
                            fila: filaNum,
                            referencia,
                            inmueble,
                            errores: filaErrores,
                            valid_funds: validFunds
                        });
                    } else if (fecha_pago) {
                        const montoUsd = tasa > 0 ? Math.round((monto / tasa) * 100) / 100 : 0;
                        pagosValidos.push({
                            fila: filaNum,
                            fecha_pago,
                            referencia,
                            inmueble,
                            banco_origen: bancoOrigen,
                            monto_bs: monto,
                            tasa_cambio: tasa,
                            monto_usd: montoUsd,
                            fondo_id: fondoId,
                            modo
                        });
                    }
                }

                let msg = '';
                if (pagosValidos.length > 0 && errores.length === 0) {
                    msg = `✅ ${pagosValidos.length} pago(s) válido(s) encontrado(s). Revisa los datos y confirma la carga.`;
                } else if (pagosValidos.length > 0) {
                    msg = `⚠️ ${pagosValidos.length} pago(s) válido(s), ${errores.length} con error(es). Revisa los datos y confirma.`;
                } else {
                    msg = `❌ No se encontraron pagos válidos (${errores.length} errores).`;
                }

                res.json({
                    tipo: 'preview',
                    mensaje: msg,
                    preview: {
                        pagos: pagosValidos,
                        errores,
                        totalFilas: filasRaw.length
                    },
                    exitosos: pagosValidos.length,
                    fallidos: errores.length,
                    total: filasRaw.length,
                    errores
                });
            } catch (err) {
                console.error('[POST /chat/preview-carga-pagos]', err);
                res.status(500).json({ error: 'Error interno al procesar el archivo.' });
            }
        },
    );

    // ══════════════════════════════════════════════════════════════════════════
    // POST /chat/subir-excel-pagos
    // Recibe el Excel del usuario autenticado desde el chat widget,
    // lo convierte a JSON y lo envía al webhook de n8n para validación y carga.
    // ══════════════════════════════════════════════════════════════════════════
    app.post(
        '/chat/subir-excel-pagos',
        verifyToken,
        (req: Request, res: Response, next: NextFunction) => {
            upload.single('archivo')(req, res, (err: unknown) => {
                if (err) {
                    const msg = err instanceof Error ? err.message : 'Tipo de archivo no permitido.';
                    return res.status(400).json({ error: msg, mensaje_usuario: msg });
                }
                next();
            });
        },
        async (req: Request, res: Response) => {
            try {
                const user = asAuthUser(req.user);
                const condo = await getCondominioByAdminUserId(pool, user.id);
                if (!condo) return res.status(404).json({ error: 'Condominio no encontrado.' });
                if (isJuntaGeneralTipo(condo.tipo)) {
                    return res.status(403).json({ error: 'La Junta General no puede cargar pagos.' });
                }

                const archivo = (req as unknown as { file?: Express.Multer.File }).file;
                if (!archivo) return res.status(400).json({ error: 'No se adjuntó ningún archivo.' });

                // Parsear Excel aquí para validación rápida de estructura antes de enviar a n8n
                const workbook = XLSX.read(archivo.buffer, { type: 'buffer', cellDates: true });
                const sheetName = workbook.SheetNames[0];
                if (!sheetName) return res.status(400).json({ error: 'El archivo Excel está vacío.' });

                const sheet = workbook.Sheets[sheetName];
                const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

                if (!filas.length) {
                    return res.status(400).json({ error: 'La hoja Excel no contiene datos.' });
                }

                // Validación básica de columnas (detección temprana antes de n8n)
                const columnasRequeridas = ['Fecha operacion', 'Referencia', 'Inmueble', 'Banco origen', 'Pago', 'Tasa'];
                const columnasPresentes = Object.keys(filas[0]);
                const faltantes = columnasRequeridas.filter(
                    (col) => !columnasPresentes.some((c) => c.trim().toLowerCase() === col.toLowerCase()),
                );
                if (faltantes.length) {
                    return res.status(400).json({
                        error: `El Excel no tiene las columnas requeridas.`,
                        columnas_faltantes: faltantes,
                        columnas_encontradas: columnasPresentes,
                        mensaje_usuario: `El archivo no tiene las columnas requeridas: ${faltantes.join(', ')}. Por favor revisa el formato del Excel.`,
                    });
                }

                // Enviar al webhook de n8n con datos + contexto
                const n8nWebhookUrl = String(process.env.N8N_CARGA_MASIVA_WEBHOOK_URL ?? '').trim();
                if (!n8nWebhookUrl) {
                    return res.status(500).json({ error: 'N8N_CARGA_MASIVA_WEBHOOK_URL no configurado.' });
                }

                const serviceKey = String(process.env.CHAT_SERVICE_KEY ?? '').trim();
                const payload = JSON.stringify({
                    condominio_id: condo.id,
                    user_id: user.id,
                    filas,
                    total_filas: filas.length,
                    nombre_archivo: archivo.originalname,
                });

                const n8nResp = await fetchJson(n8nWebhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-chat-service-key': serviceKey,
                        'x-backend-url': String(process.env.BACKEND_URL ?? 'http://localhost:3000').trim(),
                    },
                    body: payload,
                });

                console.log('[CARGA MASIVA] n8n response:', JSON.stringify(n8nResp));
                console.log('[CARGA MASIVA] n8nResp.body type:', typeof n8nResp.body, JSON.stringify(n8nResp.body));

                if (n8nResp.status >= 400) {
                    return res.status(502).json({ error: 'Error al procesar en n8n.', detalle: n8nResp.body });
                }

                // Validar que la respuesta sea un objeto válido
                const body = n8nResp.body;
                if (typeof body === 'string') {
                    try {
                        const parsed = JSON.parse(body);
                        console.log('[CARGA MASIVA] Respuesta era string, parseada:', JSON.stringify(parsed).substring(0, 200));
                        return res.json(parsed);
                    } catch {
                        console.error('[CARGA MASIVA] Respuesta de n8n no es JSON válido:', body.substring(0, 200));
                        return res.status(502).json({ error: 'Respuesta inválida de n8n.', raw: body.substring(0, 500) });
                    }
                }

                res.json(body);
            } catch (err) {
                console.error('[POST /chat/subir-excel-pagos]', err);
                res.status(500).json({ error: 'Error interno al procesar el archivo.' });
            }
        },
    );

    // ══════════════════════════════════════════════════════════════════════════
    // POST /chat/confirmar-carga-pagos
    // Recibe los pagos validados desde el frontend (después de la vista previa)
    // y los guarda en la base de datos.
    // ══════════════════════════════════════════════════════════════════════════
    app.post(
        '/chat/confirmar-carga-pagos',
        verifyToken,
        async (req: Request<{}, unknown, { pagos: Array<{ fecha_pago: string; referencia: string; inmueble: string; banco_origen: string; monto_bs: number; tasa_cambio: number; modo?: string; fondo_id?: number }> }>, res: Response) => {
            try {
                const user = asAuthUser(req.user);
                const condo = await getCondominioByAdminUserId(pool, user.id);
                if (!condo) return res.status(404).json({ error: 'Condominio no encontrado.' });
                if (isJuntaGeneralTipo(condo.tipo)) {
                    return res.status(403).json({ error: 'La Junta General no puede cargar pagos.' });
                }

                const pagos = req.body?.pagos;
                if (!Array.isArray(pagos) || pagos.length === 0) {
                    return res.status(400).json({ error: 'No hay pagos para registrar.' });
                }

                // Obtener cuentas bancarias del condominio para asignar la cuenta
                const cuentasRes = await pool.query<{ id: number }>(
                    'SELECT id FROM cuentas_bancarias WHERE condominio_id = $1 AND activo = true ORDER BY apodo LIMIT 1',
                    [condo.id]
                );
                if (!cuentasRes.rows.length) {
                    return res.status(400).json({ error: 'No hay cuentas bancarias configuradas para este condominio.' });
                }
                const cuentaBancariaId = cuentasRes.rows[0].id;

                // Usar el mismo endpoint de carga masiva que usa n8n
                const cargaMasivaUrl = String(process.env.BACKEND_URL ?? 'http://localhost:3000').trim() + '/pagos/carga-masiva';
                const serviceKey = String(process.env.CHAT_SERVICE_KEY ?? '').trim();

                const payload = JSON.stringify({
                    pagos: pagos.map(p => ({
                        fecha_pago: p.fecha_pago,
                        referencia: p.referencia,
                        inmueble: p.inmueble,
                        banco_origen: p.banco_origen,
                        monto_bs: p.monto_bs,
                        tasa_cambio: p.tasa_cambio,
                        modo: p.modo || 'distribuido',
                        fondo_id: p.fondo_id || undefined,
                    })),
                    condominio_id: condo.id,
                    cuenta_bancaria_id: cuentaBancariaId,
                });

                const cargaResp = await fetchJson(cargaMasivaUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-chat-service-key': serviceKey,
                    },
                    body: payload,
                });

                if (cargaResp.status >= 400) {
                    return res.status(502).json({ error: 'Error al registrar los pagos.', detalle: cargaResp.body });
                }

                res.json(cargaResp.body);
            } catch (err) {
                console.error('[POST /chat/confirmar-carga-pagos]', err);
                res.status(500).json({ error: 'Error interno al registrar los pagos.' });
            }
        },
    );
};

module.exports = { registerCargaMasivaRoutes };
