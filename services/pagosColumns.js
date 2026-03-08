let pagosOptionalColumnsCache = null;

const createGetPagosOptionalColumns = (pool) => async () => {
    if (pagosOptionalColumnsCache) return pagosOptionalColumnsCache;
    try {
        const result = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'pagos'
              AND column_name IN ('nota', 'cedula_origen', 'banco_origen')
        `);
        const cols = new Set(result.rows.map((r) => r.column_name));
        pagosOptionalColumnsCache = {
            nota: cols.has('nota'),
            cedula_origen: cols.has('cedula_origen'),
            banco_origen: cols.has('banco_origen'),
        };
    } catch (err) {
        pagosOptionalColumnsCache = { nota: false, cedula_origen: false, banco_origen: false };
    }
    return pagosOptionalColumnsCache;
};

module.exports = { createGetPagosOptionalColumns };

