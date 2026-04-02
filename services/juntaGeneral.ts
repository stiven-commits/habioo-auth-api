import type { Pool, QueryResultRow } from 'pg';

export interface CondominioAdminRow extends QueryResultRow {
    id: number;
    nombre: string | null;
    nombre_legal: string | null;
    rif: string | null;
    tipo: string | null;
    metodo_division: string | null;
    estado_venezuela: string | null;
    mes_actual: string | null;
}

export interface JuntaGeneralMiembroRow extends QueryResultRow {
    id: number;
    junta_general_id: number;
    condominio_individual_id: number | null;
    nombre_referencia: string;
    rif: string;
    cuota_participacion: string | number | null;
    activo: boolean;
    es_fantasma: boolean;
    codigo_invitacion: string | null;
    codigo_expira_at: string | Date | null;
    vinculado_at: string | Date | null;
    condominio_nombre: string | null;
    condominio_rif: string | null;
    condominio_tipo: string | null;
    condominio_admin_user_id: number | null;
    saldo_usd_generado: string | number | null;
    saldo_usd_pagado: string | number | null;
}

let ensureJuntaGeneralSchemaPromise: Promise<void> | null = null;

const normalizeRif = (value: unknown): string => String(value || '').toUpperCase().replace(/[^VEJPG0-9]/g, '');

const isJuntaGeneralTipo = (tipo: unknown): boolean => String(tipo || '').trim().toLowerCase() === 'junta general';

const isJuntaIndividualTipo = (tipo: unknown): boolean => String(tipo || '').trim().toLowerCase() === 'junta individual';

const toNumber = (value: string | number | null | undefined): number => {
    const n = parseFloat(String(value ?? 0));
    return Number.isFinite(n) ? n : 0;
};

const ensureJuntaGeneralSchema = async (pool: Pool): Promise<void> => {
    if (!ensureJuntaGeneralSchemaPromise) {
        ensureJuntaGeneralSchemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS junta_general_miembros (
                    id SERIAL PRIMARY KEY,
                    junta_general_id integer NOT NULL REFERENCES condominios(id) ON DELETE CASCADE,
                    condominio_individual_id integer NULL REFERENCES condominios(id) ON DELETE SET NULL,
                    nombre_referencia varchar(255) NOT NULL,
                    rif varchar(32) NOT NULL,
                    cuota_participacion numeric(10,6) NULL,
                    activo boolean NOT NULL DEFAULT true,
                    es_fantasma boolean NOT NULL DEFAULT true,
                    codigo_invitacion varchar(64) NULL,
                    codigo_expira_at timestamp NULL,
                    vinculado_at timestamp NULL,
                    created_at timestamp NOT NULL DEFAULT now(),
                    updated_at timestamp NOT NULL DEFAULT now(),
                    UNIQUE (junta_general_id, rif)
                )
            `);

            await pool.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS ux_junta_general_miembros_codigo_invitacion
                ON junta_general_miembros (codigo_invitacion)
                WHERE codigo_invitacion IS NOT NULL
            `);

            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_junta_general_miembros_general
                ON junta_general_miembros (junta_general_id)
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS junta_general_avisos (
                    id SERIAL PRIMARY KEY,
                    junta_general_id integer NOT NULL REFERENCES condominios(id) ON DELETE CASCADE,
                    mes_origen varchar(7) NOT NULL,
                    metodo_division varchar(20) NOT NULL,
                    total_usd numeric(14,2) NOT NULL,
                    total_bs numeric(14,2) NOT NULL,
                    tasa_referencia numeric(14,6) NOT NULL,
                    created_by_user_id integer NULL REFERENCES users(id),
                    created_at timestamp NOT NULL DEFAULT now()
                )
            `);

            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_junta_general_avisos_general_mes
                ON junta_general_avisos (junta_general_id, mes_origen)
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS junta_general_aviso_detalles (
                    id SERIAL PRIMARY KEY,
                    aviso_id integer NOT NULL REFERENCES junta_general_avisos(id) ON DELETE CASCADE,
                    miembro_id integer NOT NULL REFERENCES junta_general_miembros(id) ON DELETE RESTRICT,
                    condominio_individual_id integer NULL REFERENCES condominios(id) ON DELETE SET NULL,
                    monto_usd numeric(14,2) NOT NULL,
                    monto_bs numeric(14,2) NOT NULL,
                    gasto_generado_id integer NULL REFERENCES gastos(id) ON DELETE SET NULL,
                    proveedor_id integer NULL REFERENCES proveedores(id) ON DELETE SET NULL,
                    estado varchar(30) NOT NULL DEFAULT 'PENDIENTE',
                    nota text NULL,
                    created_at timestamp NOT NULL DEFAULT now(),
                    UNIQUE (aviso_id, miembro_id)
                )
            `);

            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_junta_general_aviso_detalles_condominio
                ON junta_general_aviso_detalles (condominio_individual_id)
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS junta_general_notificaciones (
                    id SERIAL PRIMARY KEY,
                    condominio_id integer NOT NULL REFERENCES condominios(id) ON DELETE CASCADE,
                    tipo varchar(40) NOT NULL,
                    titulo varchar(180) NOT NULL,
                    mensaje text NOT NULL,
                    metadata_jsonb jsonb NULL,
                    leida boolean NOT NULL DEFAULT false,
                    created_at timestamp NOT NULL DEFAULT now()
                )
            `);

            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_junta_general_notificaciones_condominio
                ON junta_general_notificaciones (condominio_id, leida, created_at DESC)
            `);

            await pool.query("ALTER TABLE gastos ADD COLUMN IF NOT EXISTS origen_tipo varchar(40)");
            await pool.query("ALTER TABLE gastos ADD COLUMN IF NOT EXISTS origen_junta_general_id integer NULL REFERENCES condominios(id) ON DELETE SET NULL");
            await pool.query("ALTER TABLE gastos ADD COLUMN IF NOT EXISTS origen_aviso_general_id integer NULL REFERENCES junta_general_avisos(id) ON DELETE SET NULL");
            await pool.query("ALTER TABLE gastos ADD COLUMN IF NOT EXISTS origen_detalle_general_id integer NULL REFERENCES junta_general_aviso_detalles(id) ON DELETE SET NULL");

            await pool.query("ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_identificador_key");
            await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_proveedores_condominio_identificador ON proveedores (condominio_id, identificador)");
            await pool.query("CREATE INDEX IF NOT EXISTS idx_proveedores_identificador ON proveedores (identificador)");
        })();
    }

    await ensureJuntaGeneralSchemaPromise;
};

const getCondominioByAdminUserId = async (pool: Pool, adminUserId: number): Promise<CondominioAdminRow | null> => {
    const res = await pool.query<CondominioAdminRow>(
        `SELECT id, nombre, nombre_legal, rif, tipo, metodo_division, estado_venezuela, mes_actual
         FROM condominios
         WHERE admin_user_id = $1
         LIMIT 1`,
        [adminUserId]
    );
    return res.rows[0] || null;
};

interface ListMiembrosOptions {
    includeInactive?: boolean;
}

const listJuntaGeneralMiembrosActivos = async (
    pool: Pool,
    juntaGeneralId: number,
    options?: ListMiembrosOptions
): Promise<JuntaGeneralMiembroRow[]> => {
    const includeInactive = options?.includeInactive === true;
    const res = await pool.query<JuntaGeneralMiembroRow>(
        `
        SELECT
            m.id,
            m.junta_general_id,
            m.condominio_individual_id,
            m.nombre_referencia,
            m.rif,
            m.cuota_participacion,
            m.activo,
            m.es_fantasma,
            m.codigo_invitacion,
            m.codigo_expira_at,
            m.vinculado_at,
            c.nombre_legal AS condominio_nombre,
            c.rif AS condominio_rif,
            c.tipo AS condominio_tipo,
            c.admin_user_id AS condominio_admin_user_id,
            COALESCE(SUM(d.monto_usd), 0) AS saldo_usd_generado,
            COALESCE(SUM(CASE WHEN g.id IS NULL THEN 0 ELSE LEAST(COALESCE(g.monto_pagado_usd, 0), d.monto_usd) END), 0) AS saldo_usd_pagado
        FROM junta_general_miembros m
        LEFT JOIN condominios c ON c.id = m.condominio_individual_id
        LEFT JOIN junta_general_aviso_detalles d ON d.miembro_id = m.id
        LEFT JOIN gastos g ON g.id = d.gasto_generado_id
        WHERE m.junta_general_id = $1
          AND ($2::boolean = true OR m.activo = true)
        GROUP BY
            m.id, m.junta_general_id, m.condominio_individual_id, m.nombre_referencia, m.rif,
            m.cuota_participacion, m.activo, m.es_fantasma, m.codigo_invitacion, m.codigo_expira_at,
            m.vinculado_at,
            c.nombre_legal, c.rif, c.tipo, c.admin_user_id
        ORDER BY m.id ASC
        `,
        [juntaGeneralId, includeInactive]
    );

    return res.rows;
};

const resolveMetodoDivisionAutomatico = (cuotas: Array<string | number | null | undefined>, metodoActual: string | null | undefined): 'Alicuota' | 'Partes Iguales' => {
    const values = cuotas
        .map((v) => Number(toNumber(v).toFixed(6)))
        .filter((v) => Number.isFinite(v));

    if (values.length === 0) {
        return metodoActual === 'Partes Iguales' ? 'Partes Iguales' : 'Alicuota';
    }

    const unique = new Set(values.map((v) => v.toFixed(6))).size;
    return unique > 1 ? 'Alicuota' : 'Partes Iguales';
};

interface EnsureProveedorInput {
    condominioId: number;
    juntaGeneralNombre: string;
    juntaGeneralRif: string;
    estadoVenezuela: string;
}

const ensureProveedorForJuntaGeneral = async (pool: Pool, input: EnsureProveedorInput): Promise<number> => {
    const rif = normalizeRif(input.juntaGeneralRif);
    if (!rif) {
        throw new Error('No se puede crear proveedor de Junta General sin RIF.');
    }

    const existing = await pool.query<{ id: number }>(
        `SELECT id
         FROM proveedores
         WHERE condominio_id = $1
           AND UPPER(REPLACE(identificador, '-', '')) = UPPER(REPLACE($2, '-', ''))
         LIMIT 1`,
        [input.condominioId, rif]
    );

    if (existing.rows[0]?.id) return existing.rows[0].id;

    const created = await pool.query<{ id: number }>(
        `
        INSERT INTO proveedores (
            condominio_id,
            identificador,
            nombre,
            email,
            telefono1,
            telefono2,
            direccion,
            estado_venezuela,
            rubro,
            activo
        ) VALUES (
            $1, $2, $3, NULL, NULL, NULL, NULL, $4, 'Junta General', true
        )
        RETURNING id
        `,
        [input.condominioId, rif, input.juntaGeneralNombre, input.estadoVenezuela]
    );

    return created.rows[0].id;
};

module.exports = {
    normalizeRif,
    isJuntaGeneralTipo,
    isJuntaIndividualTipo,
    ensureJuntaGeneralSchema,
    getCondominioByAdminUserId,
    listJuntaGeneralMiembrosActivos,
    resolveMetodoDivisionAutomatico,
    ensureProveedorForJuntaGeneral,
};
