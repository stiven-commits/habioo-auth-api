import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { AuthenticatedUser } from '../types/auth';

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface ChatAskBody {
    mensaje?: unknown;
}

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

            const n8nRes = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mensaje,
                    userId: user.id,
                    rol: rolDetectado,
                    nombre: nombreObtenido,
                    condominio: nombreCondominio,
                }),
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
};

module.exports = { registerChatRoutes };
