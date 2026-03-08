const registerFondosRoutes = (app, { pool, verifyToken, parseLocaleNumber }) => {
    app.get('/fondos', verifyToken, async (req, res) => {
        try {
            const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const result = await pool.query(
                `
            SELECT f.*, cb.nombre_banco, cb.apodo 
            FROM fondos f 
            JOIN cuentas_bancarias cb ON f.cuenta_bancaria_id = cb.id 
            WHERE f.condominio_id = $1 
            ORDER BY cb.nombre_banco ASC, f.es_operativo DESC, f.nombre ASC
        `,
                [condoRes.rows[0].id]
            );
            res.json({ status: 'success', fondos: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/fondos', verifyToken, async (req, res) => {
        const { cuenta_bancaria_id, nombre, moneda, porcentaje, saldo_inicial, es_operativo } = req.body;

        const porcNum = es_operativo ? 0 : parseLocaleNumber(porcentaje);
        const saldoNum = parseLocaleNumber(saldo_inicial);

        try {
            const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const fondo = await pool.query(
                'INSERT INTO fondos (condominio_id, cuenta_bancaria_id, nombre, moneda, porcentaje_asignacion, saldo_actual, es_operativo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                [condoRes.rows[0].id, cuenta_bancaria_id, nombre, moneda, porcNum, saldoNum, es_operativo || false]
            );

            if (saldoNum !== 0) {
                await pool.query('INSERT INTO movimientos_fondos (fondo_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', [fondo.rows[0].id, 'AJUSTE_INICIAL', saldoNum, 'Saldo de apertura del fondo']);
            }
            res.json({ status: 'success', message: 'Fondo creado y anclado a la cuenta.' });
        } catch (err) {
            console.error('Error al crear fondo:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/fondos/:id', verifyToken, async (req, res) => {
        try {
            const fondoId = req.params.id;
            const movs = await pool.query("SELECT COUNT(*) FROM movimientos_fondos WHERE fondo_id = $1 AND tipo != 'AJUSTE_INICIAL'", [fondoId]);

            if (parseInt(movs.rows[0].count, 10) > 0) {
                return res.status(400).json({ status: 'error', message: 'No se puede eliminar: El fondo ya tiene ingresos o gastos registrados.' });
            }

            await pool.query('DELETE FROM fondos WHERE id = $1', [fondoId]);
            res.json({ status: 'success', message: 'Fondo eliminado correctamente.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerFondosRoutes };

