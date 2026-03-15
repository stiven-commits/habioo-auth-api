import type { Pool } from 'pg';

interface IColumnNameRow {
    column_name: string;
}

interface PagosOptionalColumns {
    nota: boolean;
    cedula_origen: boolean;
    banco_origen: boolean;
}

const createGetPagosOptionalColumns = (pool: Pool): (() => Promise<PagosOptionalColumns>) => async () => {
    try {
        const result = await pool.query<IColumnNameRow>(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'pagos'
              AND column_name IN ('nota', 'cedula_origen', 'banco_origen')
        `);
        const cols = new Set(result.rows.map((r: IColumnNameRow) => r.column_name));
        return {
            nota: cols.has('nota'),
            cedula_origen: cols.has('cedula_origen'),
            banco_origen: cols.has('banco_origen'),
        };
    } catch (_err: unknown) {
        return { nota: false, cedula_origen: false, banco_origen: false };
    }
};

module.exports = { createGetPagosOptionalColumns };
