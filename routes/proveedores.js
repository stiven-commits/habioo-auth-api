const registerProveedoresRoutes = (app, { pool, verifyToken }) => {
    app.post('/proveedores', verifyToken, async (req, res) => {
        const { identificador, nombre, telefono1, telefono2, direccion, estado_venezuela } = req.body;
        try {
            const r = await pool.query(
                'INSERT INTO proveedores (identificador, nombre, telefono1, telefono2, direccion, estado_venezuela) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [identificador, nombre, telefono1, telefono2, direccion, estado_venezuela]
            );
            res.json({ status: 'success', message: 'Proveedor registrado', id: r.rows[0].id });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/proveedores', verifyToken, async (req, res) => {
        try {
            const r = await pool.query('SELECT * FROM proveedores ORDER BY nombre ASC');
            res.json({ status: 'success', proveedores: r.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerProveedoresRoutes };

