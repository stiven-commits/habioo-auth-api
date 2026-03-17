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

interface IPropiedadAdminRow extends Record<string, unknown> {
    id: number;
    identificador: string;
    alicuota: string | number;
    saldo_actual: string | number;
    prop_id: number | null;
    prop_nombre: string | null;
    prop_cedula: string | null;
    prop_email: string | null;
    prop_telefono: string | null;
    inq_id: number | null;
    inq_nombre: string | null;
    inq_cedula: string | null;
    inq_email: string | null;
    inq_telefono: string | null;
    inq_acceso_portal: boolean;
    can_delete: boolean;
}

interface IMovimientoEstadoCuentaRow {
    tipo: string;
    ref_id: number;
    concepto: string;
    cargo: string | number;
    abono: string | number;
    monto_bs: string | number | null;
    tasa_cambio: string | number | null;
    estado_recibo: string | null;
    fecha_operacion: string | Date;
    fecha_registro: string | Date;
}

interface IUserIdRow {
    id: number;
}

interface IPropiedadIdRow {
    id: number;
}

interface IPropiedadInsertedRow {
    id: number;
    identificador: string;
}

interface ILinkIdRow {
    id: number;
}

interface ICountRow {
    count: string;
}

interface IPropietarioExistenteRow {
    id: number;
    cedula: string;
    nombre: string | null;
    email: string | null;
    telefono: string | null;
}

interface PGError {
    code?: string;
    message: string;
}

interface PropiedadEstadoCuentaParams {
    id?: string;
}

interface InmuebleLote {
    identificador: string;
    alicuota?: string | number;
    saldo_inicial?: string | number;
    cedula?: string;
    nombre?: string;
    correo?: string;
    telefono?: string;
}

interface DeudaLote {
    identificador: string;
    concepto?: string;
    monto_total?: string | number;
    monto_abonado?: string | number;
    saldo?: string | number;
}

interface PropiedadesLoteBody {
    propiedades: InmuebleLote[];
    deudas?: DeudaLote[];
}

interface PropiedadAdminBody {
    identificador: string;
    alicuota?: string | number;
    zona_id?: string | number | null;
    prop_nombre?: string;
    prop_cedula?: string;
    prop_email?: string | null;
    prop_telefono?: string | null;
    prop_password?: string;
    tiene_inquilino?: boolean;
    inq_nombre?: string;
    inq_cedula?: string;
    inq_email?: string | null;
    inq_telefono?: string | null;
    inq_password?: string;
    inq_permitir_acceso?: boolean;
    monto_saldo_inicial?: string | number;
    tiene_deuda_inicial?: boolean;
    deudas_iniciales?: Array<{
        concepto?: string;
        monto_deuda?: string | number;
        monto_abono?: string | number;
    }>;
    propietario_modo?: 'NUEVO' | 'EXISTENTE';
    propietario_existente_id?: string | number | null;
}

interface PropiedadEditBody {
    identificador: string;
    alicuota?: string | number;
    zona_id?: string | number | null;
    prop_nombre?: string;
    prop_cedula?: string;
    prop_email?: string | null;
    prop_telefono?: string | null;
    prop_password?: string;
    tiene_inquilino?: boolean;
    inq_nombre?: string;
    inq_cedula?: string;
    inq_email?: string | null;
    inq_telefono?: string | null;
    inq_password?: string;
    inq_permitir_acceso?: boolean;
}

interface AjustarSaldoBody {
    monto?: string | number;
    tipo_ajuste: string;
    nota?: string;
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

const normalizeWhitespace = (value: unknown): string =>
    String(value ?? '').trim().replace(/\s+/g, ' ');

const toTitleCase = (value: unknown): string =>
    normalizeWhitespace(value)
        .toLowerCase()
        .split(' ')
        .map((word) =>
            word
                .split('-')
                .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
                .join('-')
        )
        .join(' ');

const normalizeIdentifier = (value: unknown): string => normalizeWhitespace(value).toUpperCase();
const normalizeDoc = (value: unknown): string => normalizeWhitespace(value).toUpperCase();

const registerPropiedadesRoutes = (app: Application, { pool, verifyToken }: AuthDependencies): void => {

    const getCondominioIdByAdmin = async (adminUserId: number): Promise<number | null> => {
        const c = await pool.query<ICondominioIdRow>('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [adminUserId]);
        return c.rows[0]?.id || null;
    };

    const isValidEmail = (value: string | null | undefined): boolean => {
        if (!value) return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
    };

    // 1. OBTENER PROPIEDADES
    app.get('/propiedades-admin', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getCondominioIdByAdmin(user.id);
            if (!condominioId) {
                return res.status(400).json({ error: 'No existe un condominio asociado a este usuario administrador.' });
            }
            const r = await pool.query<IPropiedadAdminRow>(`
                SELECT p.id, p.identificador, p.alicuota,
                    COALESCE(p.saldo_actual, 0) AS saldo_actual,
                    u1.id as prop_id, u1.nombre as prop_nombre, u1.cedula as prop_cedula, u1.email as prop_email, u1.telefono as prop_telefono,
                    u2.id as inq_id, u2.nombre as inq_nombre, u2.cedula as inq_cedula, u2.email as inq_email, u2.telefono as inq_telefono,
                    COALESCE(up2.acceso_portal, true) as inq_acceso_portal,
                    NOT EXISTS (SELECT 1 FROM recibos r WHERE r.propiedad_id = p.id) as can_delete
                FROM propiedades p
                LEFT JOIN usuarios_propiedades up1 ON p.id = up1.propiedad_id AND up1.rol = 'Propietario' LEFT JOIN users u1 ON up1.user_id = u1.id 
                LEFT JOIN usuarios_propiedades up2 ON p.id = up2.propiedad_id AND up2.rol = 'Inquilino' LEFT JOIN users u2 ON up2.user_id = u2.id
                WHERE p.condominio_id = $1 ORDER BY p.identificador ASC
            `, [condominioId]);
            const gastosRes = await pool.query<ICountRow>('SELECT COUNT(*)::text AS count FROM gastos WHERE condominio_id = $1', [condominioId]);
            const totalGastos = parseInt(gastosRes.rows[0]?.count || '0', 10) || 0;
            res.json({
                status: 'success',
                propiedades: r.rows,
                can_delete_all: totalGastos === 0
            });
        } catch (err: unknown) { const error = asError(err); res.status(500).json({ error: error.message }); }
    });

    // 1.1 OBTENER PROPIETARIOS YA REGISTRADOS EN EL CONDOMINIO
    app.get('/propiedades-admin/propietarios-existentes', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getCondominioIdByAdmin(user.id);
            if (!condominioId) {
                return res.status(400).json({ error: 'No existe un condominio asociado a este usuario administrador.' });
            }

            const result = await pool.query<IPropietarioExistenteRow>(`
                SELECT DISTINCT
                    u.id,
                    u.cedula,
                    u.nombre,
                    u.email,
                    u.telefono
                FROM usuarios_propiedades up
                INNER JOIN propiedades p ON p.id = up.propiedad_id
                INNER JOIN users u ON u.id = up.user_id
                WHERE up.rol = 'Propietario'
                  AND p.condominio_id = $1
                ORDER BY u.nombre ASC NULLS LAST, u.cedula ASC
            `, [condominioId]);

            res.json({ status: 'success', propietarios: result.rows });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    app.delete('/propiedades-admin/eliminar-todos', verifyToken, async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const user = asAuthUser(req.user);
            const condominioId = await getCondominioIdByAdmin(user.id);
            if (!condominioId) {
                return res.status(400).json({ error: 'No existe un condominio asociado a este usuario administrador.' });
            }

            const gastosRes = await pool.query<ICountRow>('SELECT COUNT(*)::text AS count FROM gastos WHERE condominio_id = $1', [condominioId]);
            const totalGastos = parseInt(gastosRes.rows[0]?.count || '0', 10) || 0;
            if (totalGastos > 0) {
                return res.status(400).json({ error: 'No se puede eliminar inmuebles porque ya existen gastos cargados en el sistema.' });
            }

            await pool.query('BEGIN');

            await pool.query(
                `DELETE FROM pagos p
                 USING recibos r, propiedades pr
                 WHERE p.recibo_id = r.id
                   AND r.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM pagos p
                 USING propiedades pr
                 WHERE p.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM recibos r
                 USING propiedades pr
                 WHERE r.propiedad_id = pr.id
                   AND pr.condominio_id = $1`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM historial_saldos_inmuebles
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM usuarios_propiedades
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condominioId]
            );

            await pool.query(
                `DELETE FROM propiedades_zonas
                 WHERE propiedad_id IN (SELECT id FROM propiedades WHERE condominio_id = $1)`,
                [condominioId]
            );

            const deletedRes = await pool.query<ICountRow>(
                `WITH deleted AS (
                    DELETE FROM propiedades
                    WHERE condominio_id = $1
                    RETURNING id
                 )
                 SELECT COUNT(*)::text AS count FROM deleted`,
                [condominioId]
            );

            await pool.query('COMMIT');

            const totalEliminados = parseInt(deletedRes.rows[0]?.count || '0', 10) || 0;
            res.json({ status: 'success', message: `Se eliminaron ${totalEliminados} inmuebles.` });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    // 2. ESTADO DE CUENTA
    app.get('/propiedades-admin/:id/estado-cuenta', verifyToken, async (req: Request<PropiedadEstadoCuentaParams>, res: Response, _next: NextFunction) => {
        const propiedadId = asString(req.params.id);
        try {
            // 1. Cargos (Recibos / Deudas)
            const recibos = await pool.query<IMovimientoEstadoCuentaRow>(
                `SELECT
                    'RECIBO' as tipo,
                    id as ref_id,
                    CASE
                      WHEN COALESCE(n8n_pdf_url, '') LIKE 'IMPORTACION_SILENCIOSA:%'
                        THEN regexp_replace(COALESCE(n8n_pdf_url, ''), '^IMPORTACION_SILENCIOSA:\\s*', '')
                      WHEN estado = 'Pagado' THEN 'Recibo: ' || mes_cobro
                      ELSE 'Aviso de Cobro: ' || mes_cobro
                    END as concepto,
                    monto_usd as cargo,
                    0 as abono,
                    NULL::numeric as monto_bs,
                    NULL::numeric as tasa_cambio,
                    estado as estado_recibo,
                    fecha_emision as fecha_operacion,
                    fecha_emision as fecha_registro
                 FROM recibos
                 WHERE propiedad_id = $1`,
                [propiedadId]
            );

            // ðŸ’¡ 2. Abonos (Pagos) - CORREGIDO: Ahora busca directamente por propiedad_id
            const pagos = await pool.query<IMovimientoEstadoCuentaRow>(
                `SELECT
                    'PAGO' as tipo,
                    id as ref_id,
                    'Pago Ref: ' || referencia as concepto,
                    0 as cargo,
                    monto_usd as abono,
                    COALESCE(monto_origen, 0) as monto_bs,
                    tasa_cambio,
                    NULL::text as estado_recibo,
                    fecha_pago as fecha_operacion,
                    COALESCE(created_at, fecha_pago) as fecha_registro
                 FROM pagos
                 WHERE propiedad_id = $1 AND estado = 'Validado'`,
                [propiedadId]
            );

            // 3. Ajustes Manuales (Saldos a favor / Deudas cargadas a mano)
            const ajustes = await pool.query<IMovimientoEstadoCuentaRow>(
                `SELECT
                    'AJUSTE' as tipo,
                    id as ref_id,
                    nota as concepto,
                    CASE WHEN tipo = 'CARGAR_DEUDA' OR (tipo = 'SALDO_INICIAL' AND nota LIKE '%(DEUDA)%') THEN monto ELSE 0 END as cargo,
                    CASE WHEN tipo = 'AGREGAR_FAVOR' OR (tipo = 'SALDO_INICIAL' AND nota LIKE '%(FAVOR)%') THEN monto ELSE 0 END as abono,
                    NULL::numeric as monto_bs,
                    NULL::numeric as tasa_cambio,
                    NULL::text as estado_recibo,
                    fecha as fecha_operacion,
                    fecha as fecha_registro
                 FROM historial_saldos_inmuebles
                 WHERE propiedad_id = $1`,
                [propiedadId]
            );

            const movimientos: IMovimientoEstadoCuentaRow[] = [...recibos.rows, ...pagos.rows, ...ajustes.rows];

            // Ordenamos cronolÃ³gicamente
            movimientos.sort((a, b) => new Date(a.fecha_registro).getTime() - new Date(b.fecha_registro).getTime());

            res.json({ status: 'success', movimientos });
        } catch (err: unknown) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });

    // 3. CARGA MASIVA BIMODAL (PROPIEDADES + DEUDAS) CON IMPORTACION SILENCIOSA
    app.post('/propiedades-admin/lote', verifyToken, async (req: Request<{}, unknown, PropiedadesLoteBody>, res: Response, _next: NextFunction) => {
        const propiedades = Array.isArray(req.body?.propiedades) ? req.body.propiedades : [];
        const deudas = Array.isArray(req.body?.deudas) ? req.body.deudas : [];

        if (propiedades.length === 0) {
            return res.status(400).json({ error: 'No se enviaron propiedades válidas.' });
        }

        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');

            const condoId = await getCondominioIdByAdmin(user.id);
            if (!condoId) {
                throw new Error('No existe un condominio asociado a este usuario administrador.');
            }
            // 1) Regla de alícuotas no-mixtas.
            const alicuotasLote: number[] = propiedades.map((item) => {
                const alicuotaRaw = String(item?.alicuota ?? '0').replace(',', '.').trim();
                const alicuotaNum = parseFloat(alicuotaRaw);
                return Number.isNaN(alicuotaNum) ? 0 : alicuotaNum;
            });
            const allAlicuotasCero = alicuotasLote.every((alicuota: number) => alicuota === 0);
            const allAlicuotasMayorCero = alicuotasLote.every((alicuota: number) => alicuota > 0);
            if (!allAlicuotasCero && !allAlicuotasMayorCero) {
                throw new Error('El archivo Excel contiene alícuotas mixtas. O todos los inmuebles tienen alícuota 0 (partes iguales), o todos deben tener una alícuota mayor a 0.');
            }

            if (allAlicuotasCero) {
                await pool.query("UPDATE condominios SET metodo_division = 'Partes Iguales' WHERE id = $1", [condoId]);
            }

            // 2) Bulk INSERT de propiedades + RETURNING id, identificador.
            const propValues: unknown[] = [];
            const propPlaceholders: string[] = [];
            propiedades.forEach((item: InmuebleLote, idx: number) => {
                const offset = idx * 4;
                const identificador = normalizeIdentifier(item.identificador);
                const alicuotaNum = parseFloat(String(item.alicuota ?? '0').replace(',', '.')) || 0;
                const saldoBase = parseFloat(String(item.saldo_inicial ?? '0').replace(',', '.')) || 0;
                propValues.push(condoId, identificador, alicuotaNum, saldoBase);
                propPlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
            });

            const insertPropsRes = await pool.query<IPropiedadInsertedRow>(
                `
                INSERT INTO propiedades (condominio_id, identificador, alicuota, saldo_actual)
                VALUES ${propPlaceholders.join(', ')}
                RETURNING id, identificador
                `,
                propValues
            );

            // 3) Mapa identificador -> propiedad_id.
            const propiedadIdByIdentificador = new Map<string, number>();
            insertPropsRes.rows.forEach((row) => {
                const key = normalizeIdentifier(row.identificador);
                propiedadIdByIdentificador.set(key, row.id);
            });

            // Mantener traza de saldo inicial del inmueble.
            for (const item of propiedades) {
                const saldoBase = parseFloat(String(item.saldo_inicial ?? '0').replace(',', '.')) || 0;
                if (saldoBase === 0) continue;
                const key = normalizeIdentifier(item.identificador);
                const propiedadId = propiedadIdByIdentificador.get(key);
                if (!propiedadId) continue;
                const tipoSaldo = saldoBase > 0 ? 'DEUDA' : 'FAVOR';
                await pool.query(
                    'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
                    [propiedadId, 'SALDO_INICIAL', Math.abs(saldoBase), `Carga masiva Excel (${tipoSaldo})`]
                );
            }

            // Vincular propietario (nombre + cedula) por cada inmueble cargado.
            for (const item of propiedades) {
                const key = normalizeIdentifier(item.identificador);
                const propiedadId = propiedadIdByIdentificador.get(key);
                if (!propiedadId) continue;

                const cedula = normalizeDoc(item.cedula);
                const nombre = toTitleCase(item.nombre);
                if (!cedula || !nombre) continue;

                const correoRaw = String(item.correo || '').trim().toLowerCase();
                const telefono = String(item.telefono || '').trim();
                const correo = isValidEmail(correoRaw) && correoRaw ? correoRaw : null;
                const telefonoFinal = telefono || null;

                let userId: number;
                const userRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1 LIMIT 1', [cedula]);
                if (userRes.rows.length === 0) {
                    const insertUser = await pool.query<IUserIdRow>(
                        'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [cedula, nombre, correo, telefonoFinal, cedula]
                    );
                    userId = insertUser.rows[0].id;
                } else {
                    userId = userRes.rows[0].id;
                    await pool.query(
                        'UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE id = $4',
                        [nombre, correo, telefonoFinal, userId]
                    );
                }

                const linkUpdate = await pool.query(
                    'UPDATE usuarios_propiedades SET user_id = $1 WHERE propiedad_id = $2 AND rol = $3',
                    [userId, propiedadId, 'Propietario']
                );
                if (linkUpdate.rowCount === 0) {
                    await pool.query(
                        'INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)',
                        [userId, propiedadId, 'Propietario']
                    );
                }
            }

            // 4) Aplicar saldo importado por inmueble (deuda/favor/al dia) desde la hoja saldos_bases.
            const saldoPorPropiedad = new Map<number, number>();
            for (const deuda of deudas) {
                const key = normalizeIdentifier(deuda.identificador);
                const propiedadId = propiedadIdByIdentificador.get(key);
                if (!propiedadId) continue;

                const saldoRaw = String(deuda.saldo ?? '').trim();
                if (saldoRaw !== '') {
                    const saldoNum = parseFloat(saldoRaw.replace(',', '.'));
                    if (!Number.isNaN(saldoNum) && saldoNum !== 0) {
                        saldoPorPropiedad.set(propiedadId, saldoNum);
                    }
                }
            }

            for (const [propiedadId, saldo] of saldoPorPropiedad.entries()) {
                await pool.query('UPDATE propiedades SET saldo_actual = $1 WHERE id = $2', [saldo, propiedadId]);
                if (saldo !== 0) {
                    const tipoSaldo = saldo > 0 ? 'DEUDA' : 'FAVOR';
                    await pool.query(
                        'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
                        [propiedadId, 'SALDO_INICIAL', Math.abs(saldo), `Importacion Estado_Cuenta (${tipoSaldo})`]
                    );
                }
            }

            // 5) Importacion silenciosa:
            // no se generan recibos historicos ni avisos de cobro, solo se ajusta saldo inicial/importado.

            await pool.query('COMMIT');
            res.json({
                status: 'success',
                message: `${propiedades.length} inmuebles cargados correctamente (sin generar avisos de cobro).`,
                propiedades_insertadas: propiedades.length,
                deudas_procesadas: 0
            });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            if (error.code === '23505' && error.message.includes('identificador')) {
                return res.status(400).json({ error: 'Uno de los inmuebles (Apto/Casa) del archivo ya existe en el sistema.' });
            }
            if (error.code === '23505' && error.message.includes('email')) {
                return res.status(400).json({ error: 'Uno de los correos en el archivo ya está en uso.' });
            }
            if (error.message.includes('alícuotas mixtas')) {
                return res.status(400).json({ error: error.message });
            }
            res.status(500).json({ error: error.message });
        }
    });

    // 4. CREAR PROPIEDAD INDIVIDUAL
    app.post('/propiedades-admin', verifyToken, async (req: Request<{}, unknown, PropiedadAdminBody>, res: Response, _next: NextFunction) => {
        const {
            identificador,
            alicuota,
            zona_id,
            prop_nombre,
            prop_cedula,
            prop_email,
            prop_telefono,
            prop_password,
            tiene_inquilino,
            inq_nombre,
            inq_cedula,
            inq_email,
            inq_telefono,
            inq_password,
            inq_permitir_acceso,
            monto_saldo_inicial,
            tiene_deuda_inicial,
            deudas_iniciales,
            propietario_modo,
            propietario_existente_id
        } = req.body;
        const ownerEmail = (prop_email || '').trim() || null;
        const tenantEmail = (inq_email || '').trim() || null;
        const identificadorNormalized = normalizeIdentifier(identificador);
        const propCedulaNormalized = normalizeDoc(prop_cedula);
        const propNombreNormalized = toTitleCase(prop_nombre);
        const inqCedulaNormalized = normalizeDoc(inq_cedula);
        const inqNombreNormalized = toTitleCase(inq_nombre);
        const propietarioModo = propietario_modo === 'EXISTENTE' ? 'EXISTENTE' : 'NUEVO';
        const propietarioExistenteId = Number(propietario_existente_id);
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;
        const parseMoney = (value: string | number | undefined | null): number => {
            const parsed = parseFloat(String(value ?? '0').replace(',', '.'));
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const deudaItems = Array.isArray(deudas_iniciales) ? deudas_iniciales : [];
        const deudaItemsNormalizados = deudaItems.map((item) => {
            const montoDeuda = Math.max(parseMoney(item?.monto_deuda), 0);
            const montoAbono = Math.max(parseMoney(item?.monto_abono), 0);
            const montoNeto = Math.max(montoDeuda - montoAbono, 0);
            return {
                concepto: String(item?.concepto || '').trim(),
                montoDeuda,
                montoAbono,
                montoNeto
            };
        }).filter((item) => item.montoDeuda > 0 || item.montoAbono > 0 || item.concepto);
        const usarDeudaInicial = Boolean(tiene_deuda_inicial) && deudaItemsNormalizados.length > 0;
        const saldoBase = usarDeudaInicial
            ? deudaItemsNormalizados.reduce((acc, item) => acc + item.montoNeto, 0)
            : parseMoney(monto_saldo_inicial);
        if (!isValidEmail(ownerEmail)) return res.status(400).json({ error: 'Email del propietario invÃ¡lido.' });
        if (!isValidEmail(tenantEmail)) return res.status(400).json({ error: 'Email del inquilino invÃ¡lido.' });

        try {
            const user = asAuthUser(req.user);
            await pool.query('BEGIN');
            const condominioId = await getCondominioIdByAdmin(user.id);
            if (!condominioId) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ error: 'No existe un condominio asociado a este usuario administrador.' });
            }

            let userId: number | null = null;
            if (propietarioModo === 'EXISTENTE') {
                if (!Number.isFinite(propietarioExistenteId) || propietarioExistenteId <= 0) {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({ error: 'Debe seleccionar un propietario existente válido.' });
                }

                const propietarioRes = await pool.query<IUserIdRow>(`
                    SELECT u.id
                    FROM users u
                    INNER JOIN usuarios_propiedades up ON up.user_id = u.id AND up.rol = 'Propietario'
                    INNER JOIN propiedades p ON p.id = up.propiedad_id
                    WHERE u.id = $1
                      AND p.condominio_id = $2
                    LIMIT 1
                `, [propietarioExistenteId, condominioId]);

                if (propietarioRes.rows.length === 0) {
                    await pool.query('ROLLBACK');
                    return res.status(400).json({ error: 'El propietario seleccionado no pertenece a este condominio.' });
                }

                userId = propietarioRes.rows[0].id;
            } else if (propCedulaNormalized && propNombreNormalized) {
                const userRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1', [propCedulaNormalized]);
                if (userRes.rows.length > 0) {
                    await pool.query('ROLLBACK');
                    return res.status(409).json({ error: 'La cédula ingresada ya existe. Use "Propietario Existente" para vincularlo.' });
                }

                // Si el correo ya existe en el sistema, reutilizamos ese usuario para evitar duplicados.
                if (ownerEmail) {
                    const userByEmailRes = await pool.query<{ id: number }>(
                        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
                        [ownerEmail]
                    );
                    if (userByEmailRes.rows.length > 0) {
                        userId = userByEmailRes.rows[0].id;
                        await pool.query(
                            'UPDATE users SET nombre = $1, telefono = $2 WHERE id = $3',
                            [propNombreNormalized, prop_telefono || null, userId]
                        );
                    }
                }

                if (!userId) {
                    const insertRes = await pool.query<IUserIdRow>(
                        'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [propCedulaNormalized, propNombreNormalized, ownerEmail, prop_telefono || null, prop_password || propCedulaNormalized]
                    );
                    userId = insertRes.rows[0].id;
                }
            }

            const propRes = await pool.query<IPropiedadIdRow>('INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id, saldo_actual) VALUES ($1, $2, $3, $4, $5) RETURNING id', [condominioId, identificadorNormalized, alicuotaNum, zona_id || null, saldoBase]);
            const nuevaPropId = propRes.rows[0].id;

            if (usarDeudaInicial) {
                for (const item of deudaItemsNormalizados) {
                    if (item.montoNeto <= 0) continue;
                    const concepto = item.concepto || 'Deuda anterior importada';
                    const nota = `Saldo inicial cargado al crear el inmueble (DEUDA) - ${concepto} | Monto deuda: ${item.montoDeuda.toFixed(2)} | Abono: ${item.montoAbono.toFixed(2)}`;
                    await pool.query(
                        'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
                        [nuevaPropId, 'SALDO_INICIAL', item.montoNeto, nota]
                    );
                }
            } else if (saldoBase !== 0) {
                const tipoSaldo = saldoBase > 0 ? 'DEUDA' : 'FAVOR';
                await pool.query('INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', [nuevaPropId, 'SALDO_INICIAL', Math.abs(saldoBase), `Saldo inicial cargado al crear el inmueble (${tipoSaldo})`]);
            }
            if (userId) await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, nuevaPropId, 'Propietario']);

            if (tiene_inquilino && inqCedulaNormalized && inqNombreNormalized) {
                const inqPermitirAcceso = inq_permitir_acceso !== false;
                let tenantRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1', [inqCedulaNormalized]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query<IUserIdRow>('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [inqCedulaNormalized, inqNombreNormalized, tenantEmail, inq_telefono || null, inq_password || inqCedulaNormalized]);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [inqNombreNormalized, tenantEmail, inq_telefono || null, inqCedulaNormalized]);
                    if (inq_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [inq_password, inqCedulaNormalized]);
                }
                await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol, acceso_portal) VALUES ($1, $2, $3, $4)', [tenantRes.rows[0].id, nuevaPropId, 'Inquilino', inqPermitirAcceso]);
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble guardado correctamente' });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            if (error.code === '23505' && error.message.includes('email')) return res.status(400).json({ error: 'El correo ingresado ya pertenece a otro usuario en el sistema. Debe usar un correo distinto.' });
            res.status(500).json({ error: error.message });
        }
    });

    // 5. EDITAR PROPIEDAD INDIVIDUAL
    app.put('/propiedades-admin/:id', verifyToken, async (req: Request<PropiedadEstadoCuentaParams, unknown, PropiedadEditBody>, res: Response, _next: NextFunction) => {
        const propiedadId = asString(req.params.id);
        const { identificador, alicuota, zona_id, prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password, tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password, inq_permitir_acceso } = req.body;

        const ownerEmail = (prop_email || '').trim() || null;
        const tenantEmail = (inq_email || '').trim() || null;
        const identificadorNormalized = normalizeIdentifier(identificador);
        const propCedulaNormalized = normalizeDoc(prop_cedula);
        const propNombreNormalized = toTitleCase(prop_nombre);
        const inqCedulaNormalized = normalizeDoc(inq_cedula);
        const inqNombreNormalized = toTitleCase(inq_nombre);
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;
        if (!isValidEmail(ownerEmail)) return res.status(400).json({ error: 'Email del propietario invÃ¡lido.' });
        if (!isValidEmail(tenantEmail)) return res.status(400).json({ error: 'Email del inquilino invÃ¡lido.' });

        try {
            await pool.query('BEGIN');
            await pool.query('UPDATE propiedades SET identificador = $1, alicuota = $2, zona_id = $3 WHERE id = $4', [identificadorNormalized, alicuotaNum, zona_id || null, propiedadId]);

            if (propCedulaNormalized && propNombreNormalized) {
                let userRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1', [propCedulaNormalized]);
                let userId: number | null = null;
                if (userRes.rows.length === 0) {
                    userRes = await pool.query<IUserIdRow>('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [propCedulaNormalized, propNombreNormalized, ownerEmail, prop_telefono || null, prop_password || propCedulaNormalized]);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [propNombreNormalized, ownerEmail, prop_telefono || null, propCedulaNormalized]);
                    if (prop_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [prop_password, propCedulaNormalized]);
                }
                userId = userRes.rows[0].id;
                const linkRes = await pool.query<ILinkIdRow>('SELECT id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Propietario']);
                if (linkRes.rows.length > 0) { await pool.query('UPDATE usuarios_propiedades SET user_id = $1 WHERE id = $2', [userId, linkRes.rows[0].id]); }
                else { await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, propiedadId, 'Propietario']); }
            }

            if (tiene_inquilino && inqCedulaNormalized && inqNombreNormalized) {
                const inqPermitirAcceso = inq_permitir_acceso !== false;
                let tenantRes = await pool.query<IUserIdRow>('SELECT id FROM users WHERE cedula = $1', [inqCedulaNormalized]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query<IUserIdRow>('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [inqCedulaNormalized, inqNombreNormalized, tenantEmail, inq_telefono || null, inq_password || inqCedulaNormalized]);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [inqNombreNormalized, tenantEmail, inq_telefono || null, inqCedulaNormalized]);
                    if (inq_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [inq_password, inqCedulaNormalized]);
                }
                const tenantId = tenantRes.rows[0].id;
                const tenantLink = await pool.query<ILinkIdRow>('SELECT id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
                if (tenantLink.rows.length > 0) { await pool.query('UPDATE usuarios_propiedades SET user_id = $1, acceso_portal = $2 WHERE id = $3', [tenantId, inqPermitirAcceso, tenantLink.rows[0].id]); }
                else { await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol, acceso_portal) VALUES ($1, $2, $3, $4)', [tenantId, propiedadId, 'Inquilino', inqPermitirAcceso]); }
            } else {
                await pool.query('DELETE FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble actualizado correctamente' });
        } catch (err: unknown) {
            const error = asPgError(err);
            await pool.query('ROLLBACK');
            if (error.code === '23505' && error.message.includes('email')) return res.status(400).json({ error: 'El correo ingresado ya pertenece a otro usuario en el sistema. Debe usar un correo distinto.' });
            res.status(500).json({ error: error.message });
        }
    });

    // 6. ELIMINAR PROPIEDAD INDIVIDUAL (solo si no tiene avisos/recibos)
    app.delete('/propiedades-admin/:id', verifyToken, async (req: Request<PropiedadEstadoCuentaParams>, res: Response, _next: NextFunction) => {
        const propiedadIdRaw = asString(req.params.id);
        const propiedadId = parseInt(propiedadIdRaw, 10);
        if (!Number.isFinite(propiedadId) || propiedadId <= 0) {
            return res.status(400).json({ error: 'ID de inmueble inválido.' });
        }

        try {
            const user = asAuthUser(req.user);
            const condominioId = await getCondominioIdByAdmin(user.id);
            if (!condominioId) {
                return res.status(400).json({ error: 'No existe un condominio asociado a este usuario administrador.' });
            }

            const propRes = await pool.query<IPropiedadIdRow>(
                'SELECT id FROM propiedades WHERE id = $1 AND condominio_id = $2 LIMIT 1',
                [propiedadId, condominioId]
            );
            if (propRes.rows.length === 0) {
                return res.status(404).json({ error: 'Inmueble no encontrado.' });
            }

            const recibosRes = await pool.query<ICountRow>(
                'SELECT COUNT(*)::text AS count FROM recibos WHERE propiedad_id = $1',
                [propiedadId]
            );
            const totalRecibos = parseInt(recibosRes.rows[0]?.count || '0', 10) || 0;
            if (totalRecibos > 0) {
                return res.status(400).json({ error: 'No se puede eliminar este inmueble porque ya tiene avisos/recibos generados.' });
            }

            await pool.query('BEGIN');
            await pool.query('DELETE FROM pagos WHERE propiedad_id = $1', [propiedadId]);
            await pool.query('DELETE FROM historial_saldos_inmuebles WHERE propiedad_id = $1', [propiedadId]);
            await pool.query('DELETE FROM usuarios_propiedades WHERE propiedad_id = $1', [propiedadId]);
            await pool.query('DELETE FROM propiedades_zonas WHERE propiedad_id = $1', [propiedadId]);
            await pool.query('DELETE FROM propiedades WHERE id = $1 AND condominio_id = $2', [propiedadId, condominioId]);
            await pool.query('COMMIT');

            res.json({ status: 'success', message: 'Inmueble eliminado correctamente.' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });

    // 7. AJUSTAR SALDO MANUALMENTE
    app.post('/propiedades-admin/:id/ajustar-saldo', verifyToken, async (req: Request<PropiedadEstadoCuentaParams, unknown, AjustarSaldoBody>, res: Response, _next: NextFunction) => {
        const propiedadId = asString(req.params.id);
        const { monto, tipo_ajuste, nota } = req.body;
        const montoNum = parseFloat((monto || '0').toString().replace(',', '.')) || 0;
        if (montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

        try {
            await pool.query('BEGIN');
            const operador = tipo_ajuste === 'CARGAR_DEUDA' ? '+' : '-';
            await pool.query(`UPDATE propiedades SET saldo_actual = saldo_actual ${operador} $1 WHERE id = $2`, [montoNum, propiedadId]);
            await pool.query('INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', [propiedadId, tipo_ajuste, montoNum, nota || 'Ajuste manual del administrador']);
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Saldo ajustado exitosamente' });
        } catch (err: unknown) {
            const error = asError(err);
            await pool.query('ROLLBACK');
            res.status(500).json({ error: error.message });
        }
    });
};

module.exports = { registerPropiedadesRoutes };
