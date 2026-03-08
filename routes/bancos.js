const registerBancosRoutes = (app, { pool, verifyToken }) => {
    app.get('/bancos', verifyToken, async (req, res) => {
        try {
            const r = await pool.query(
                'SELECT cb.* FROM cuentas_bancarias cb JOIN condominios c ON cb.condominio_id = c.id WHERE c.admin_user_id = $1 ORDER BY cb.nombre_banco ASC',
                [req.user.id]
            );
            res.json({ status: 'success', bancos: r.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/bancos', verifyToken, async (req, res) => {
        const { numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono } = req.body;
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            await pool.query(
                'INSERT INTO cuentas_bancarias (condominio_id, numero_cuenta, nombre_banco, apodo, tipo, nombre_titular, cedula_rif, telefono) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [condoId, numero_cuenta || '', nombre_banco || '', apodo, tipo, nombre_titular || '', cedula_rif || '', telefono || '']
            );
            res.json({ status: 'success', message: 'Cuenta agregada' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/bancos/:id/predeterminada', verifyToken, async (req, res) => {
        try {
            const cuentaId = req.params.id;
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            await pool.query('BEGIN');
            await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = false WHERE condominio_id = $1', [condoId]);
            await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = true WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
            await pool.query('COMMIT');

            res.json({ status: 'success', message: 'Cuenta principal actualizada con exito.' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/bancos/:id', verifyToken, async (req, res) => {
        try {
            const cuentaId = req.params.id;
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            const movs = await pool.query(
                `
            SELECT COUNT(*) 
            FROM movimientos_fondos mf
            JOIN fondos f ON mf.fondo_id = f.id
            WHERE f.cuenta_bancaria_id = $1 AND mf.tipo != 'AJUSTE_INICIAL'
        `,
                [cuentaId]
            );

            if (parseInt(movs.rows[0].count, 10) > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'No se puede eliminar: Esta cuenta tiene fondos con ingresos o gastos activos.',
                });
            }

            await pool.query('DELETE FROM cuentas_bancarias WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
            res.json({ status: 'success', message: 'Cuenta eliminada con exito.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerBancosRoutes };

