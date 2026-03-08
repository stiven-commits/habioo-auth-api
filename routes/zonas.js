const registerZonasRoutes = (app, { pool, verifyToken }) => {
    app.get('/zonas', verifyToken, async (req, res) => {
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const zRes = await pool.query(
                'SELECT z.id, z.nombre, z.activa, (SELECT COUNT(*) FROM gastos g WHERE g.zona_id = z.id) > 0 as tiene_gastos FROM zonas z WHERE z.condominio_id = $1 ORDER BY z.activa DESC, z.nombre ASC',
                [c.rows[0].id]
            );
            const zonas = zRes.rows;
            for (const z of zonas) {
                const pRes = await pool.query('SELECT p.id, p.identificador FROM propiedades p JOIN propiedades_zonas pz ON p.id = pz.propiedad_id WHERE pz.zona_id = $1', [z.id]);
                z.propiedades = pRes.rows;
                z.propiedades_ids = pRes.rows.map((p) => p.id);
            }
            const aRes = await pool.query('SELECT id, identificador FROM propiedades WHERE condominio_id = $1 ORDER BY identificador ASC', [c.rows[0].id]);
            res.json({ status: 'success', zonas, todas_propiedades: aRes.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/zonas', verifyToken, async (req, res) => {
        const { nombre, propiedades_ids } = req.body;
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const z = await pool.query('INSERT INTO zonas (condominio_id, nombre, activa) VALUES ($1, $2, true) RETURNING id', [c.rows[0].id, nombre]);
            if (propiedades_ids) {
                for (const p of propiedades_ids) {
                    await pool.query('INSERT INTO propiedades_zonas (zona_id, propiedad_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [z.rows[0].id, p]);
                }
            }
            res.json({ status: 'success', message: 'Zona agregada exitosamente' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/zonas/:id', verifyToken, async (req, res) => {
        const { nombre, activa, propiedades_ids } = req.body;
        try {
            await pool.query('BEGIN');
            await pool.query('UPDATE zonas SET nombre = $1, activa = $2 WHERE id = $3', [nombre, activa, req.params.id]);
            if (Array.isArray(propiedades_ids)) {
                await pool.query('DELETE FROM propiedades_zonas WHERE zona_id = $1', [req.params.id]);
                for (const pId of propiedades_ids) {
                    await pool.query('INSERT INTO propiedades_zonas (zona_id, propiedad_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, pId]);
                }
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Zona actualizada' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/zonas/:id', verifyToken, async (req, res) => {
        try {
            await pool.query('DELETE FROM zonas WHERE id = $1', [req.params.id]);
            res.json({ status: 'success' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerZonasRoutes };

