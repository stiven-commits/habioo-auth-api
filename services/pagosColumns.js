"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const createGetPagosOptionalColumns = (pool) => async () => {
    try {
        const result = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'pagos'
              AND column_name IN ('nota', 'cedula_origen', 'banco_origen', 'telefono_origen')
        `);
        const cols = new Set(result.rows.map((r) => r.column_name));
        return {
            nota: cols.has('nota'),
            cedula_origen: cols.has('cedula_origen'),
            banco_origen: cols.has('banco_origen'),
            telefono_origen: cols.has('telefono_origen'),
        };
    }
    catch (_err) {
        return { nota: false, cedula_origen: false, banco_origen: false, telefono_origen: false };
    }
};
module.exports = { createGetPagosOptionalColumns };
//# sourceMappingURL=pagosColumns.js.map