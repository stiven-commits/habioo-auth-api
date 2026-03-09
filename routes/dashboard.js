const registerDashboardRoutes = (app, { pool, verifyToken }) => {
    app.get('/mis-propiedades', verifyToken, async (req, res) => {
        try {
            const query = `
            SELECT p.*, c.nombre as condominio_nombre 
            FROM propiedades p
            JOIN usuarios_propiedades up ON p.id = up.propiedad_id
            JOIN condominios c ON p.condominio_id = c.id
            WHERE up.user_id = $1 AND COALESCE(up.acceso_portal, true) = true
        `;
            const result = await pool.query(query, [req.user.id]);
            res.json({ status: 'success', propiedades: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/mis-finanzas', verifyToken, async (req, res) => {
        try {
            const queryDeuda = `
            SELECT SUM(r.monto_usd) as total_deuda
            FROM recibos r
            JOIN propiedades p ON r.propiedad_id = p.id
            JOIN usuarios_propiedades up ON p.id = up.propiedad_id
            WHERE up.user_id = $1 AND COALESCE(up.acceso_portal, true) = true AND r.estado NOT IN ('Pagado', 'Solvente')
        `;
            const resultDeuda = await pool.query(queryDeuda, [req.user.id]);

            res.json({
                status: 'success',
                finanzas: {
                    total_deuda: parseFloat(resultDeuda.rows[0].total_deuda || 0).toFixed(2),
                },
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/cuentas-por-cobrar', verifyToken, async (req, res) => {
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            if (c.rows.length === 0) return res.status(403).json({ error: 'No autorizado' });
            const condoId = c.rows[0].id;

            const query = `
            SELECT r.*, p.identificador as apto
            FROM recibos r
            JOIN propiedades p ON r.propiedad_id = p.id
            WHERE p.condominio_id = $1 AND r.estado NOT IN ('Pagado', 'Solvente')
            ORDER BY r.fecha_emision DESC
        `;
            const result = await pool.query(query, [condoId]);
            res.json({ status: 'success', recibos: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerDashboardRoutes };
