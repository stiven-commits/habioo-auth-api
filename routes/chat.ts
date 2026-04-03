import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { AuthenticatedUser } from '../types/auth';
const { createHmac }: { createHmac: typeof import('node:crypto').createHmac } = require('node:crypto');

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface ChatAskBody {
    mensaje?: unknown;
}

interface ChatRegistrarPagoBody {
    userId?: unknown;
    propiedad_id?: unknown;
    cuenta_id?: unknown;
    monto_origen?: unknown;
    tasa_cambio?: unknown;
    referencia?: unknown;
    fecha_pago?: unknown;
    moneda?: unknown;
    metodo?: unknown;
    nota?: unknown;
}

interface PropiedadRow {
    id: number;
    numero_inmueble: string | null;
    nombre: string | null;
}

interface CuentaBancariaRow {
    id: number;
    banco: string | null;
    numero_cuenta: string | null;
}

const verifyChatServiceKey = (req: Request, res: Response): boolean => {
    const serviceKey = String(process.env.CHAT_SERVICE_KEY ?? '').trim();
    if (!serviceKey) {
        res.status(500).json({ status: 'error', message: 'CHAT_SERVICE_KEY no configurado.' });
        return false;
    }
    const provided = String(req.headers['x-chat-service-key'] ?? '').trim();
    if (provided !== serviceKey) {
        res.status(401).json({ status: 'error', message: 'Clave de servicio invalida.' });
        return false;
    }
    return true;
};

interface CondominioAdminRow {
    id: number;
    nombre: string | null;
}

interface UsuarioNombreRow {
    nombre: string | null;
}

interface N8nResponseBody {
    respuesta?: string;
}

const extractRespuesta = (payload: unknown): string => {
    if (typeof payload === 'string') return payload;
    if (typeof payload !== 'object' || payload === null) return '';

    const record = payload as Record<string, unknown>;
    if (typeof record.respuesta === 'string') return record.respuesta;
    if (typeof record.response === 'string') return record.response;
    if (typeof record.message === 'string') return record.message;

    return '';
};

const asAuthenticatedUser = (value: unknown): AuthenticatedUser => {
    if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as { id?: unknown }).id !== 'number'
    ) {
        throw new TypeError('Usuario autenticado invalido.');
    }

    return value as AuthenticatedUser;
};

const registerChatRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    app.post('/chat/ask', verifyToken, async (req: Request<{}, unknown, ChatAskBody>, res: Response) => {
        try {
            const user = asAuthenticatedUser(req.user);
            const mensaje = String(req.body?.mensaje ?? '').trim();

            if (!mensaje) {
                res.status(400).json({ status: 'error', message: 'El campo "mensaje" es requerido.' });
                return;
            }

            const webhookUrl = String(process.env.N8N_WEBHOOK_URL ?? '').trim();
            if (!webhookUrl) {
                res.status(500).json({ status: 'error', message: 'N8N_WEBHOOK_URL no esta configurado.' });
                return;
            }

            const adminCheck = await pool.query<CondominioAdminRow>(
                `
                SELECT c.id, c.nombre
                FROM condominios c
                WHERE c.admin_user_id = $1
                LIMIT 1
                `,
                [user.id],
            );

            const rolDetectado: 'Administrador' | 'Propietario' =
                adminCheck.rowCount && adminCheck.rowCount > 0 ? 'Administrador' : 'Propietario';
            let nombreObtenido = String(user.nombre || '').trim();
            if (!nombreObtenido) {
                const userRow = await pool.query<UsuarioNombreRow>(
                    `
                    SELECT u.nombre
                    FROM usuarios u
                    WHERE u.id = $1
                    LIMIT 1
                    `,
                    [user.id],
                );
                nombreObtenido = String(userRow.rows[0]?.nombre || '').trim();
            }
            if (!nombreObtenido) {
                nombreObtenido = rolDetectado === 'Administrador' ? 'Administradora' : 'Propietario';
            }
            let nombreCondominio = 'tu condominio';
            if (rolDetectado === 'Administrador') {
                const nombreAdminCondominio = String(adminCheck.rows[0]?.nombre || '').trim();
                if (nombreAdminCondominio) nombreCondominio = nombreAdminCondominio;
            } else {
                const condominioPropietario = await pool.query<UsuarioNombreRow>(
                    `
                    SELECT c.nombre
                    FROM usuarios_propiedades up
                    JOIN propiedades p ON p.id = up.propiedad_id
                    JOIN condominios c ON c.id = p.condominio_id
                    WHERE up.user_id = $1
                    ORDER BY up.id ASC
                    LIMIT 1
                    `,
                    [user.id],
                );
                const nombrePropCondominio = String(condominioPropietario.rows[0]?.nombre || '').trim();
                if (nombrePropCondominio) nombreCondominio = nombrePropCondominio;
            }

            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), 25000);

            const webhookToken = String(process.env.HABIOO_AI_WEBHOOK_TOKEN ?? '').trim();
            if (!webhookToken) {
                res.status(500).json({ status: 'error', message: 'HABIOO_AI_WEBHOOK_TOKEN no esta configurado.' });
                return;
            }

            const webhookSecret = String(process.env.HABIOO_AI_WEBHOOK_SECRET ?? '').trim();
            const webhookPayload = JSON.stringify({
                mensaje,
                userId: user.id,
                rol: rolDetectado,
                nombre: nombreObtenido,
                condominio: nombreCondominio,
            });
            const webhookHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${webhookToken}`,
            };

            if (webhookSecret) {
                const timestamp = Date.now().toString();
                const signature = createHmac('sha256', webhookSecret)
                    .update(`${timestamp}.${webhookPayload}`)
                    .digest('hex');
                webhookHeaders['x-habioo-timestamp'] = timestamp;
                webhookHeaders['x-habioo-signature'] = signature;
            }

            const n8nRes = await fetch(webhookUrl, {
                method: 'POST',
                headers: webhookHeaders,
                body: webhookPayload,
                signal: abortController.signal,
            }).finally(() => {
                clearTimeout(timeoutId);
            });

            if (!n8nRes.ok) {
                const details = await n8nRes.text();
                res.status(502).json({
                    status: 'error',
                    message: 'No se pudo obtener respuesta del webhook.',
                    webhook_status: n8nRes.status,
                    webhook_status_text: n8nRes.statusText,
                    webhook_url: n8nRes.url,
                    details: details || undefined,
                });
                return;
            }

            const rawText = await n8nRes.text();
            let parsed: unknown = rawText;
            try {
                parsed = JSON.parse(rawText) as N8nResponseBody;
            } catch {
                // Si n8n responde texto plano, se usa tal cual.
            }

            const respuesta = extractRespuesta(parsed) || rawText || '';
            res.json({ status: 'success', respuesta });
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : 'Error interno al procesar la solicitud de chat.';
            res.status(500).json({ status: 'error', message });
        }
    });

    // Devuelve propiedades y cuentas bancarias disponibles para que el agente IA las presente al usuario.
    app.get('/chat/opciones-pago', async (req: Request, res: Response) => {
        if (!verifyChatServiceKey(req, res)) return;

        const userId = parseInt(String(req.query.userId ?? ''), 10);
        if (!Number.isFinite(userId) || userId <= 0) {
            res.status(400).json({ status: 'error', message: 'userId invalido.' });
            return;
        }

        try {
            const [propiedadesResult, cuentasResult] = await Promise.all([
                pool.query<PropiedadRow>(
                    `SELECT p.id, p.identificador AS numero_inmueble, NULL::text AS nombre
                     FROM usuarios_propiedades up
                     JOIN propiedades p ON p.id = up.propiedad_id
                     WHERE up.user_id = $1
                     ORDER BY p.id ASC`,
                    [userId],
                ),
                pool.query<CuentaBancariaRow>(
                    `SELECT DISTINCT cb.id, cb.nombre_banco AS banco, cb.numero_cuenta
                     FROM cuentas_bancarias cb
                     JOIN condominios c ON c.id = cb.condominio_id
                     JOIN propiedades p ON p.condominio_id = c.id
                     JOIN usuarios_propiedades up ON up.propiedad_id = p.id
                     WHERE up.user_id = $1
                     ORDER BY cb.nombre_banco ASC`,
                    [userId],
                ),
            ]);

            res.json({
                status: 'success',
                propiedades: propiedadesResult.rows.map(r => ({
                    id: r.id,
                    label: [r.numero_inmueble, r.nombre].filter(Boolean).join(' - ') || `Inmueble #${r.id}`,
                })),
                cuentas: cuentasResult.rows.map(r => ({
                    id: r.id,
                    label: [r.banco, r.numero_cuenta].filter(Boolean).join(' - ') || `Cuenta #${r.id}`,
                })),
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al obtener opciones de pago.';
            res.status(500).json({ status: 'error', message });
        }
    });

    // Registra un pago de propietario desde el agente IA (estado PendienteAprobacion).
    app.post('/chat/registrar-pago', async (req: Request<{}, unknown, ChatRegistrarPagoBody>, res: Response) => {
        if (!verifyChatServiceKey(req, res)) return;

        const {
            userId,
            propiedad_id,
            cuenta_id,
            monto_origen,
            tasa_cambio,
            referencia,
            fecha_pago,
            moneda,
            metodo,
            nota,
        } = req.body;

        const userIdNum = parseInt(String(userId ?? ''), 10);
        const propiedadIdNum = parseInt(String(propiedad_id ?? ''), 10);
        const cuentaIdNum = parseInt(String(cuenta_id ?? ''), 10);
        const montoNum = parseFloat(String(monto_origen ?? '').replace(',', '.'));
        const tasaNum = parseFloat(String(tasa_cambio ?? '1').replace(',', '.'));
        const monedaFinal = String(moneda || 'BS').toUpperCase() === 'USD' ? 'USD' : 'BS';
        const metodoFinal = String(metodo || 'Transferencia').trim() || 'Transferencia';
        const referenciaFinal = String(referencia ?? '').trim() || null;
        const notaFinal = String(nota ?? '').trim() || 'Registrado via chat';
        const fechaFinal = String(fecha_pago ?? '').trim() || new Date().toISOString().split('T')[0];

        if (!Number.isFinite(userIdNum) || userIdNum <= 0)
            return void res.status(400).json({ status: 'error', message: 'userId invalido.' });
        if (!Number.isFinite(propiedadIdNum) || propiedadIdNum <= 0)
            return void res.status(400).json({ status: 'error', message: 'propiedad_id invalido.' });
        if (!Number.isFinite(cuentaIdNum) || cuentaIdNum <= 0)
            return void res.status(400).json({ status: 'error', message: 'cuenta_id invalido.' });
        if (!Number.isFinite(montoNum) || montoNum <= 0)
            return void res.status(400).json({ status: 'error', message: 'monto_origen invalido.' });

        try {
            // Verificar que el usuario tiene acceso a la propiedad
            const acceso = await pool.query(
                `SELECT 1 FROM usuarios_propiedades WHERE user_id = $1 AND propiedad_id = $2 LIMIT 1`,
                [userIdNum, propiedadIdNum],
            );
            if ((acceso.rowCount ?? 0) === 0) {
                return void res.status(403).json({ status: 'error', message: 'No autorizado para registrar pagos en este inmueble.' });
            }

            const tasaFinal = monedaFinal === 'BS' ? (Number.isFinite(tasaNum) && tasaNum > 0 ? tasaNum : 1) : 1;
            const montoUsd = monedaFinal === 'BS' ? Math.round((montoNum / tasaFinal) * 100) / 100 : Math.round(montoNum * 100) / 100;

            await pool.query(
                `INSERT INTO pagos
                 (propiedad_id, cuenta_bancaria_id, monto_origen, tasa_cambio, monto_usd, moneda, referencia, fecha_pago, metodo, nota, estado)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PendienteAprobacion')`,
                [propiedadIdNum, cuentaIdNum, montoNum, tasaFinal, montoUsd, monedaFinal, referenciaFinal, fechaFinal, metodoFinal, notaFinal],
            );

            res.json({
                status: 'success',
                message: 'Pago registrado correctamente. Queda pendiente de aprobacion por la junta de condominio.',
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al registrar el pago.';
            res.status(500).json({ status: 'error', message });
        }
    });
};

module.exports = { registerChatRoutes };
