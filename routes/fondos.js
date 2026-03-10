const registerFondosRoutes = (app, { pool, verifyToken, parseLocaleNumber }) => {
    app.get('/fondos', verifyToken, async (req, res) => {
        try {
            const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const result = await pool.query(
                `
            SELECT f.*, cb.nombre_banco, cb.apodo 
            FROM fondos f 
            JOIN cuentas_bancarias cb ON f.cuenta_bancaria_id = cb.id 
            WHERE f.condominio_id = $1 AND f.activo = true
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
            res.status(500).json({ error: err.message });
        }
    });

    // 💡 NUEVO: Borrado inteligente (Hard Delete vs Soft Delete) y transferencia forzada
    app.delete('/fondos/:id', verifyToken, async (req, res) => {
        try {
            const fondoId = req.params.id;
            const { destino_id } = req.body || {};

            const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = condoRes.rows[0].id;

            await pool.query('BEGIN');

            const fondoRes = await pool.query('SELECT * FROM fondos WHERE id = $1 AND condominio_id = $2 AND activo = true', [fondoId, condoId]);
            if (fondoRes.rows.length === 0) throw new Error("Fondo no encontrado o ya está inactivo.");
            
            const fondo = fondoRes.rows[0];
            const saldo = parseFloat(fondo.saldo_actual || 0);

            // 🔍 EL JUEZ: Verificamos si el fondo tiene historial de uso real
            const usageRes = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM transferencias WHERE fondo_origen_id = $1 OR fondo_destino_id = $1) +
                    (SELECT COUNT(*) FROM pagos_proveedores WHERE fondo_id = $1) AS total_usos
            `, [fondoId]);
            const tieneHistorial = parseInt(usageRes.rows[0].total_usos, 10) > 0;

            // CASO 1: TIENE DINERO (Forzamos transferencia y Soft Delete)
            if (saldo > 0) {
                if (!destino_id) throw new Error("El fondo tiene saldo. Debe especificar un fondo de destino.");
                
                const destRes = await pool.query('SELECT * FROM fondos WHERE id = $1 AND condominio_id = $2 AND activo = true', [destino_id, condoId]);
                if (destRes.rows.length === 0) throw new Error("Fondo de destino no válido.");
                const destino = destRes.rows[0];

                if (fondo.moneda !== destino.moneda) {
                    throw new Error(`Debe transferir a un fondo con la misma moneda (${fondo.moneda}).`);
                }

                // 1. Inyectamos la transferencia al Libro Mayor
                await pool.query(
                    `INSERT INTO transferencias (condominio_id, fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota)
                     VALUES ($1, $2, $3, $4, null, $5, $6, CURRENT_DATE, $7)`,
                    [condoId, fondoId, destino_id, saldo, saldo, 'CIERRE', 'Transferencia de fondos por eliminación de fondo']
                );

                // 2. Sumamos el dinero al nuevo fondo destino
                await pool.query(`UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [saldo, destino_id]);

                // 3. Soft Delete: Desactivamos el fondo original dejándolo en cero
                await pool.query('UPDATE fondos SET activo = false, saldo_actual = 0 WHERE id = $1', [fondoId]);
                
                await pool.query('COMMIT');
                return res.json({ status: 'success', message: 'Fondo desactivado y saldo transferido con éxito.' });
            }

            // CASO 2: ESTÁ EN CERO, PERO NUNCA SE HA USADO (HARD DELETE)
            if (!tieneHistorial) {
                // Borramos cualquier ajuste inicial (si lo hubo) para no romper las llaves foráneas
                await pool.query('DELETE FROM movimientos_fondos WHERE fondo_id = $1', [fondoId]);
                // Borramos el fondo de raíz
                await pool.query('DELETE FROM fondos WHERE id = $1', [fondoId]);
                
                await pool.query('COMMIT');
                return res.json({ status: 'success', message: 'Fondo eliminado permanentemente (Sin uso previo).' });
            } 
            
            // CASO 3: ESTÁ EN CERO, PERO SÍ TIENE HISTORIA (SOFT DELETE)
            else {
                await pool.query('UPDATE fondos SET activo = false, saldo_actual = 0 WHERE id = $1', [fondoId]);
                await pool.query('COMMIT');
                return res.json({ status: 'success', message: 'Fondo desactivado correctamente (Se conservó su historial).' });
            }

        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerFondosRoutes };