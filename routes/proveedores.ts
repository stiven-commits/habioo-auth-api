import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

interface AuthUser {
    id: number;
}

interface AuthDependencies {
    pool: Pool;
    verifyToken: (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

interface ICondominioIdRow {
    id: number;
}

interface IProveedorExistRow {
    id: number;
    activo: boolean;
}

interface IProveedorRow extends Record<string, unknown> {
    id: number;
    condominio_id: number;
    identificador: string;
    nombre: string;
    email: string;
    telefono1: string | null;
    telefono2: string | null;
    direccion: string | null;
    estado_venezuela: string | null;
    rubro: string | null;
    activo: boolean;
}

interface PGError {
    code?: string;
    message: string;
}

interface ProveedorBaseBody {
    identificador: string;
    nombre: string;
    email: string;
    telefono1?: string | null;
    telefono2?: string | null;
    direccion?: string | null;
    estado_venezuela?: string | null;
    rubro?: string | null;
}

interface ProveedorLoteItem {
    identificador: string;
    nombre: string;
    email: string;
    telefono1?: string | null;
    telefono2?: string | null;
    direccion?: string | null;
    estado_venezuela?: string | null;
    rubro?: string | null;
}

interface ProveedorLoteBody {
    proveedores: ProveedorLoteItem[];
}

interface ProveedorEditBody {
    nombre: string;
    email: string;
    telefono1?: string | null;
    telefono2?: string | null;
    direccion?: string | null;
    estado_venezuela?: string | null;
    rubro?: string | null;
}

interface ProveedorParams {
    id?: string;
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

const asPgError = (value: unknown): PGError => {
    if (typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string') {
        return value as PGError;
    }
    return { message: String(value) };
};

const registerProveedoresRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {
    const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

    // 1. CREAR O REACTIVAR PROVEEDOR INDIVIDUAL
    app.post('/proveedores', verifyToken, async (req: Request<{}, unknown, ProveedorBaseBody>, res: Response, _next: NextFunction) => {
        const user = asAuthUser(req.user);
        const { identificador, nombre, email, telefono1, telefono2, direccion, estado_venezuela, rubro } = req.body;
        const emailFmt = String(email || '').trim().toLowerCase();
        if (!isValidEmail(emailFmt)) return res.status(400).json({ error: 'Correo electrÃ³nico invÃ¡lido.' });
        try {
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = c.rows[0].id;

            const exist = await pool.query<IProveedorExistRow>('SELECT id, activo FROM proveedores WHERE identificador = $1 AND condominio_id = $2', [identificador, condoId]);

            if (exist.rows.length > 0) {
                if (exist.rows[0].activo) return res.status(400).json({ error: 'Ya existe un proveedor activo registrado con este RIF.' });
                else {
                    await pool.query(
                        'UPDATE proveedores SET nombre=$1, email=$2, telefono1=$3, telefono2=$4, direccion=$5, estado_venezuela=$6, rubro=$7, activo=true WHERE id=$8',
                        [nombre, emailFmt, telefono1, telefono2, direccion, estado_venezuela, rubro || null, exist.rows[0].id]
                    );
                    return res.json({ status: 'success', message: 'El proveedor estaba oculto, ha sido reactivado y actualizado.' });
                }
            }

            await pool.query(
                'INSERT INTO proveedores (condominio_id, identificador, nombre, email, telefono1, telefono2, direccion, estado_venezuela, rubro) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [condoId, identificador, nombre, emailFmt, telefono1, telefono2, direccion, estado_venezuela, rubro || null]
            );
            res.json({ status: 'success', message: 'Proveedor registrado exitosamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    // ðŸ’¡ 2. NUEVA RUTA: CARGA MASIVA DE PROVEEDORES POR LOTE (EXCEL)
    app.post('/proveedores/lote', verifyToken, async (req: Request<{}, unknown, ProveedorLoteBody>, res: Response, _next: NextFunction) => {
        const user = asAuthUser(req.user);
        const { proveedores } = req.body;

        if (!proveedores || !Array.isArray(proveedores) || proveedores.length === 0) {
            return res.status(400).json({ error: 'No se enviaron datos vÃ¡lidos.' });
        }

        try {
            await pool.query('BEGIN');
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const condoId = c.rows[0].id;

            for (const item of proveedores) {
                const rifFmt = (item.identificador || '').toUpperCase().replace(/[^VEJPG0-9]/g, '');
                const emailFmt = String(item.email || '').trim().toLowerCase();
                if (!isValidEmail(emailFmt)) throw new Error(`Correo invÃ¡lido para el proveedor con RIF ${rifFmt || '(sin RIF)'}.`);

                const exist = await pool.query<IProveedorExistRow>('SELECT id, activo FROM proveedores WHERE identificador = $1 AND condominio_id = $2', [rifFmt, condoId]);

                if (exist.rows.length > 0) {
                    if (exist.rows[0].activo) {
                        // Si un RIF ya existe y estÃ¡ activo, rompemos la transacciÃ³n completa
                        throw new Error(`El proveedor con RIF ${rifFmt} ya estÃ¡ registrado y activo en el directorio.`);
                    } else {
                        // Si estaba eliminado, lo reactivamos
                        await pool.query(
                            'UPDATE proveedores SET nombre=$1, email=$2, telefono1=$3, telefono2=$4, direccion=$5, estado_venezuela=$6, rubro=$7, activo=true WHERE id=$8',
                            [item.nombre, emailFmt, item.telefono1, item.telefono2 || null, item.direccion, item.estado_venezuela, item.rubro || null, exist.rows[0].id]
                        );
                    }
                } else {
                    // Si no existe, lo insertamos
                    await pool.query(
                        'INSERT INTO proveedores (condominio_id, identificador, nombre, email, telefono1, telefono2, direccion, estado_venezuela, rubro) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                        [condoId, rifFmt, item.nombre, emailFmt, item.telefono1, item.telefono2 || null, item.direccion, item.estado_venezuela, item.rubro || null]
                    );
                }
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: `${proveedores.length} proveedores cargados correctamente.` });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            res.status(400).json({ error: error.message });
        }
    });

    // 3. EDITAR PROVEEDOR EXISTENTE
    app.put('/proveedores/:id', verifyToken, async (req: Request<ProveedorParams, unknown, ProveedorEditBody>, res: Response, _next: NextFunction) => {
        const proveedorId = asString(req.params.id);
        const { nombre, email, telefono1, telefono2, direccion, estado_venezuela, rubro } = req.body;
        const emailFmt = String(email || '').trim().toLowerCase();
        if (!isValidEmail(emailFmt)) return res.status(400).json({ error: 'Correo electrÃ³nico invÃ¡lido.' });
        try {
            await pool.query(
                'UPDATE proveedores SET nombre=$1, email=$2, telefono1=$3, telefono2=$4, direccion=$5, estado_venezuela=$6, rubro=$7 WHERE id=$8',
                [nombre, emailFmt, telefono1, telefono2, direccion, estado_venezuela, rubro || null, proveedorId]
            );
            res.json({ status: 'success', message: 'Proveedor actualizado correctamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    // 4. ELIMINAR PROVEEDOR (BORRADO LÃ“GICO)
    app.delete('/proveedores/:id', verifyToken, async (req: Request<ProveedorParams>, res: Response, _next: NextFunction) => {
        try {
            const proveedorId = asString(req.params.id);
            await pool.query('UPDATE proveedores SET activo = false WHERE id = $1', [proveedorId]);
            res.json({ status: 'success', message: 'Proveedor eliminado del directorio.' });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    // 5. LISTAR PROVEEDORES
    app.get('/proveedores', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [user.id]);
            const r = await pool.query<IProveedorRow>('SELECT * FROM proveedores WHERE condominio_id = $1 AND activo = true ORDER BY nombre ASC', [c.rows[0].id]);
            res.json({ status: 'success', proveedores: r.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerProveedoresRoutes };

