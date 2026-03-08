const registerRecibosRoutes = (app, { pool, verifyToken }) => {
    app.get('/recibos-historial', verifyToken, async (req, res) => {
        try {
            const r = await pool.query(
                "SELECT r.id, r.mes_cobro, r.monto_usd, r.estado, TO_CHAR(r.fecha_emision, 'DD/MM/YYYY') as fecha, p.identificador as apto, u.nombre as propietario FROM recibos r JOIN propiedades p ON r.propiedad_id = p.id LEFT JOIN usuarios_propiedades up ON p.id = up.propiedad_id AND up.rol = 'Propietario' LEFT JOIN users u ON up.user_id = u.id JOIN condominios c ON p.condominio_id = c.id WHERE c.admin_user_id = $1 ORDER BY r.id DESC",
                [req.user.id]
            );
            res.json({ status: 'success', recibos: r.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerRecibosRoutes };

