"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const asAuthUser = (value) => {
    if (typeof value !== 'object' ||
        value === null ||
        typeof value.id !== 'number') {
        throw new TypeError('Invalid authenticated user');
    }
    return value;
};
const asError = (value) => {
    return value instanceof Error ? value : new Error(String(value));
};
const registerRecibosRoutes = (app, { pool, verifyToken }) => {
    app.get('/recibos-historial', verifyToken, async (req, res, _next) => {
        try {
            const user = asAuthUser(req.user);
            const r = await pool.query(`SELECT
                    r.id,
                    r.mes_cobro,
                    r.monto_usd,
                    COALESCE(r.monto_pagado_usd, 0) AS monto_pagado_usd,
                    GREATEST(r.monto_usd - COALESCE(r.monto_pagado_usd, 0), 0) AS deuda_pendiente,
                    r.estado,
                    TO_CHAR(r.fecha_emision, 'DD/MM/YYYY') as fecha,
                    p.identificador as apto,
                    u.nombre as propietario
                 FROM recibos r
                 JOIN propiedades p ON r.propiedad_id = p.id
                 LEFT JOIN usuarios_propiedades up ON p.id = up.propiedad_id AND up.rol = 'Propietario'
                 LEFT JOIN users u ON up.user_id = u.id
                 JOIN condominios c ON p.condominio_id = c.id
                 WHERE c.admin_user_id = $1
                 ORDER BY r.id DESC`, [user.id]);
            res.json({ status: 'success', recibos: r.rows });
        }
        catch (err) {
            const error = asError(err);
            res.status(500).json({ error: error.message });
        }
    });
    app.get('/recibos/:id/aviso', verifyToken, async (req, res, _next) => {
        try {
            const user = asAuthUser(req.user);
            const reciboId = parseInt(String(req.params.id || ''), 10);
            if (!Number.isFinite(reciboId) || reciboId <= 0) {
                return res.status(400).json({ status: 'error', message: 'ID de recibo invalido.' });
            }
            const result = await pool.query(`SELECT
                    r.id,
                    r.estado,
                    p.identificador AS inmueble_identificador,
                    p.alicuota AS inmueble_alicuota,
                    upo.nombre AS propietario_nombre,
                    upi.nombre AS inquilino_nombre,
                    r.snapshot_jsonb
                 FROM recibos r
                 JOIN propiedades p ON p.id = r.propiedad_id
                 LEFT JOIN LATERAL (
                    SELECT u.nombre
                    FROM usuarios_propiedades up
                    JOIN users u ON u.id = up.user_id
                    WHERE up.propiedad_id = p.id
                      AND up.rol = 'Propietario'
                    ORDER BY up.id ASC
                    LIMIT 1
                 ) upo ON true
                 LEFT JOIN LATERAL (
                    SELECT u.nombre
                    FROM usuarios_propiedades up
                    JOIN users u ON u.id = up.user_id
                    WHERE up.propiedad_id = p.id
                      AND up.rol = 'Inquilino'
                    ORDER BY up.id ASC
                    LIMIT 1
                 ) upi ON true
                 JOIN condominios c ON c.id = p.condominio_id
                 WHERE r.id = $1
                   AND (
                     c.admin_user_id = $2
                     OR EXISTS (
                       SELECT 1
                       FROM usuarios_propiedades up_perm
                       WHERE up_perm.propiedad_id = p.id
                         AND up_perm.user_id = $2
                         AND COALESCE(up_perm.acceso_portal, true) = true
                     )
                   )
                 LIMIT 1`, [reciboId, user.id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Recibo no encontrado.' });
            }
            const recibo = result.rows[0];
            if (!recibo.snapshot_jsonb) {
                return res.status(404).json({ status: 'error', message: 'Este recibo no tiene snapshot guardado.' });
            }
            const estadoRaw = String(recibo.estado || '').trim();
            const estadoRecibo = ['Pagado', 'Solvente', 'Recibo', 'Validado'].includes(estadoRaw)
                ? 'Pagado'
                : ['Abonado', 'Abonado Parcial', 'Parcial'].includes(estadoRaw)
                    ? 'Abonado'
                    : 'Pendiente';
            const propietario = recibo.propietario_nombre || 'Sin propietario';
            const inquilino = recibo.inquilino_nombre || null;
            const titularMostrado = inquilino ? `${propietario} / Inquilino: ${inquilino}` : propietario;
            const snapshotInmueble = recibo.snapshot_jsonb.inmueble;
            const aviso = {
                ...recibo.snapshot_jsonb,
                estado_recibo: estadoRecibo,
                inmueble: {
                    ...(snapshotInmueble || {}),
                    identificador: String(snapshotInmueble?.identificador || recibo.inmueble_identificador || ''),
                    alicuota: Number(snapshotInmueble?.alicuota ?? recibo.inmueble_alicuota ?? 0),
                    propietario: String(snapshotInmueble?.propietario || propietario),
                    inquilino: snapshotInmueble?.inquilino ?? inquilino,
                    titular_mostrado: String(snapshotInmueble?.titular_mostrado || titularMostrado),
                },
            };
            res.json({ status: 'success', aviso });
        }
        catch (err) {
            const error = asError(err);
            res.status(500).json({ status: 'error', message: error.message });
        }
    });
};
module.exports = { registerRecibosRoutes };
//# sourceMappingURL=recibos.js.map