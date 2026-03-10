const registerBancosRoutes = (app, { pool, verifyToken }) => {
    app.get('/bancos', verifyToken, async (req, res) => {
        try {
            const r = await pool.query(
                //'SELECT cb.* FROM cuentas_bancarias cb JOIN condominios c ON cb.condominio_id = c.id WHERE c.admin_user_id = $1 ORDER BY cb.nombre_banco ASC',
                'SELECT cb.* FROM cuentas_bancarias cb JOIN condominios c ON cb.condominio_id = c.id WHERE c.admin_user_id = $1 AND cb.activo = true ORDER BY cb.nombre_banco ASC',
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

            // 💡 NUEVO REQUISITO: Verificar que la cuenta tenga al menos un fondo activo
            const fondos = await pool.query('SELECT COUNT(*) FROM fondos WHERE cuenta_bancaria_id = $1 AND activo = true', [cuentaId]);
            if (parseInt(fondos.rows[0].count, 10) === 0) {
                return res.status(400).json({ 
                    status: 'error', 
                    message: '⚠️ No se puede establecer como principal una cuenta que no tiene fondos asignados.' 
                });
            }

            await pool.query('BEGIN');
            await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = false WHERE condominio_id = $1', [condoId]);
            await pool.query('UPDATE cuentas_bancarias SET es_predeterminada = true WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
            await pool.query('COMMIT');

            res.json({ status: 'success', message: 'Cuenta principal actualizada con éxito.' });
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

            // Verificamos si aún tiene FONDOS ACTIVOS por dentro
            const movs = await pool.query(
                `SELECT COUNT(*) FROM fondos WHERE cuenta_bancaria_id = $1 AND activo = true`,
                [cuentaId]
            );

            if (parseInt(movs.rows[0].count, 10) > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'No se puede eliminar: Esta cuenta bancaria tiene fondos activos en su interior. Primero debe vaciar/eliminar dichos fondos.',
                });
            }

            // Soft delete de la cuenta
            await pool.query('UPDATE cuentas_bancarias SET activo = false WHERE id = $1 AND condominio_id = $2', [cuentaId, condoId]);
            res.json({ status: 'success', message: 'Cuenta bancaria eliminada con éxito.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    /// 🏦 ESTADO DE CUENTA BANCARIO (Libro Mayor)
    app.get('/bancos-admin/:id/estado-cuenta', verifyToken, async (req, res) => {
        const cuentaId = parseInt(req.params.id, 10); // 💡 TRUCO: Forzamos a que sea un Número para que Postgres no falle
        
        try {
            // 1. ENTRADAS
            const entradas = await pool.query(`
                SELECT 'ENTRADA' as tipo, p.fecha_pago as fecha, 
                       'Abono de Inmueble: ' || pr.identificador as concepto, 
                       p.referencia, null as monto_bs, null as tasa_cambio, p.monto_usd as monto_usd,
                       null::int as fondo_id, null::int as fondo_origen_id, null::int as fondo_destino_id
                FROM pagos p 
                JOIN propiedades pr ON p.propiedad_id = pr.id 
                WHERE p.cuenta_bancaria_id = $1 AND p.estado = 'Validado'
            `, [cuentaId]);

            // 2. SALIDAS (Proveedores)
            const salidas = await pool.query(`
                SELECT 'SALIDA' as tipo, pp.fecha_pago as fecha, 
                       'Pago a Proveedor: ' || prov.nombre as concepto, 
                       pp.referencia, pp.monto_bs, pp.tasa_cambio, pp.monto_usd,
                       pp.fondo_id as fondo_id, pp.fondo_id as fondo_origen_id, null::int as fondo_destino_id
                FROM pagos_proveedores pp 
                JOIN gastos g ON pp.gasto_id = g.id 
                JOIN proveedores prov ON g.proveedor_id = prov.id 
                JOIN fondos f ON pp.fondo_id = f.id 
                WHERE f.cuenta_bancaria_id = $1
            `, [cuentaId]);

            // 3. TRANSFERENCIAS ENTRANTES
            const transferenciasIn = await pool.query(`
                SELECT 'TRANSFERENCIA_IN' as tipo, t.fecha, 
                       'Transferencia recibida desde: ' || f_orig.nombre as concepto, 
                       t.referencia,
                       CASE
                           WHEN f_dest.moneda = 'BS' THEN t.monto_destino
                           WHEN f_orig.moneda = 'BS' THEN t.monto_origen
                           ELSE null
                       END as monto_bs,
                       t.tasa_cambio,
                       CASE
                           WHEN f_dest.moneda = 'USD' THEN t.monto_destino
                           WHEN f_orig.moneda = 'USD' THEN t.monto_origen
                           WHEN t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_destino / t.tasa_cambio)
                           ELSE 0
                        END as monto_usd,
                        t.fondo_destino_id as fondo_id, t.fondo_origen_id, t.fondo_destino_id
                FROM transferencias t 
                JOIN fondos f_dest ON t.fondo_destino_id = f_dest.id 
                JOIN fondos f_orig ON t.fondo_origen_id = f_orig.id 
                WHERE f_dest.cuenta_bancaria_id = $1 AND f_orig.cuenta_bancaria_id != $1
            `, [cuentaId]);

            // 4. TRANSFERENCIAS SALIENTES
            const transferenciasOut = await pool.query(`
                SELECT 'TRANSFERENCIA_OUT' as tipo, t.fecha, 
                       'Transferencia enviada a: ' || f_dest.nombre as concepto, 
                       t.referencia,
                       CASE
                           WHEN f_orig.moneda = 'BS' THEN t.monto_origen
                           WHEN f_dest.moneda = 'BS' THEN t.monto_destino
                           ELSE null
                       END as monto_bs,
                       t.tasa_cambio,
                       CASE
                           WHEN f_orig.moneda = 'USD' THEN t.monto_origen
                           WHEN f_dest.moneda = 'USD' THEN t.monto_destino
                           WHEN t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_origen / t.tasa_cambio)
                           ELSE 0
                        END as monto_usd,
                        t.fondo_origen_id as fondo_id, t.fondo_origen_id, t.fondo_destino_id
                FROM transferencias t 
                JOIN fondos f_orig ON t.fondo_origen_id = f_orig.id 
                JOIN fondos f_dest ON t.fondo_destino_id = f_dest.id 
                WHERE f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id != $1
            `, [cuentaId]);

            // 5. 💡 TRANSFERENCIAS INTERNAS (El dinero cambia de fondo, pero NO sale de esta cuenta bancaria)
            const transferenciasInternas = await pool.query(`
                SELECT 'INTERNA' as tipo, t.fecha, 
                       'Traspaso interno: ' || f_orig.nombre || ' ➔ ' || f_dest.nombre as concepto, 
                       t.referencia,
                       CASE
                           WHEN f_orig.moneda = 'BS' THEN t.monto_origen
                           WHEN f_dest.moneda = 'BS' THEN t.monto_destino
                           ELSE null
                       END as monto_bs,
                       t.tasa_cambio,
                       CASE
                           WHEN f_orig.moneda = 'USD' THEN t.monto_origen
                           WHEN f_dest.moneda = 'USD' THEN t.monto_destino
                           WHEN t.tasa_cambio IS NOT NULL AND t.tasa_cambio > 0 THEN (t.monto_origen / t.tasa_cambio)
                           ELSE 0
                        END as monto_usd,
                        null::int as fondo_id, t.fondo_origen_id, t.fondo_destino_id
                FROM transferencias t 
                JOIN fondos f_orig ON t.fondo_origen_id = f_orig.id 
                JOIN fondos f_dest ON t.fondo_destino_id = f_dest.id 
                WHERE f_orig.cuenta_bancaria_id = $1 AND f_dest.cuenta_bancaria_id = $1
            `, [cuentaId]);

            let movimientos = [
                ...entradas.rows, 
                ...salidas.rows, 
                ...transferenciasIn.rows, 
                ...transferenciasOut.rows,
                ...transferenciasInternas.rows
            ];
            
            movimientos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

            res.json({ status: 'success', movimientos });
        } catch (error) {
            console.error("Error en estado de cuenta:", error);
            res.status(500).json({ error: error.message });
        }
    });
    // 💸 REGISTRAR PAGO A PROVEEDOR
    app.post('/pagos-proveedores', verifyToken, async (req, res) => {
        const { gasto_id, fondo_id, monto_bs, tasa_cambio, monto_usd, referencia, fecha_pago, nota } = req.body;
        
        try {
            await pool.query('BEGIN'); // Iniciamos transacción segura
            
            // 1. Guardamos el registro del pago
            await pool.query(
                `INSERT INTO pagos_proveedores (gasto_id, fondo_id, monto_bs, tasa_cambio, monto_usd, referencia, fecha_pago, nota)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [gasto_id, fondo_id, monto_bs || null, tasa_cambio || null, monto_usd, referencia, fecha_pago, nota]
            );
            
            // 2. Restamos el dinero del Fondo (y por ende, de la cuenta bancaria)
            await pool.query(`UPDATE fondos SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [monto_usd, fondo_id]);
            
            // 3. Le sumamos el dinero pagado a la deuda del Gasto (Para permitir pagos parciales)
            await pool.query(`UPDATE gastos SET monto_pagado_usd = COALESCE(monto_pagado_usd, 0) + $1 WHERE id = $2`, [monto_usd, gasto_id]);

            await pool.query('COMMIT'); // Guardamos todo
            res.json({ status: 'success', message: 'Pago a proveedor registrado exitosamente.' });
        } catch (err) {
            await pool.query('ROLLBACK'); // Si algo falla, revertimos
            res.status(500).json({ error: err.message });
        }
    });

    // 🔄 REGISTRAR TRANSFERENCIA ENTRE FONDOS/CUENTAS
    app.post('/transferencias', verifyToken, async (req, res) => {
        const { fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota } = req.body;
        
        try {
            const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = condoRes.rows[0].id;

            await pool.query('BEGIN');
            
            // 1. Guardamos el registro de la transferencia
            await pool.query(
                `INSERT INTO transferencias (condominio_id, fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio, monto_destino, referencia, fecha, nota)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [condoId, fondo_origen_id, fondo_destino_id, monto_origen, tasa_cambio || null, monto_destino, referencia, fecha, nota]
            );
            
            // 2. Restamos el dinero del fondo de Origen
            await pool.query(`UPDATE fondos SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [monto_origen, fondo_origen_id]);
            
            // 3. Sumamos el dinero al fondo de Destino
            // (Nota: monto_origen y monto_destino pueden ser distintos si estás pasando de Bs a USD)
            await pool.query(`UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [monto_destino, fondo_destino_id]);

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Transferencia procesada exitosamente.' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });
    // 🔍 OBTENER GASTOS PENDIENTES POR PAGAR AL PROVEEDOR
    app.get('/gastos-pendientes-pago', verifyToken, async (req, res) => {
        try {
            const condoRes = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = condoRes.rows[0].id;

            const result = await pool.query(`
                SELECT g.id, g.concepto, g.monto_usd, COALESCE(g.monto_pagado_usd, 0) as pagado, 
                       (g.monto_usd - COALESCE(g.monto_pagado_usd, 0)) as deuda_restante,
                       p.nombre as proveedor, g.fecha_gasto
                FROM gastos g
                JOIN proveedores p ON g.proveedor_id = p.id
                WHERE g.condominio_id = $1 AND (g.monto_usd - COALESCE(g.monto_pagado_usd, 0)) > 0
                ORDER BY g.fecha_gasto ASC
            `, [condoId]);
            
            res.json({ status: 'success', gastos: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerBancosRoutes };
