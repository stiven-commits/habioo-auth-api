const registerPagosRoutes = (app, { pool, verifyToken, parseLocaleNumber, getPagosOptionalColumns }) => {
    app.post('/pagos-admin', verifyToken, async (req, res) => {
        const {
            recibo_id, cuenta_id, monto_origen, tasa_cambio, referencia, fecha_pago, moneda, metodo,
            nota, cedula_origen, banco_origen,
        } = req.body;

        const monto_pagado_num = parseLocaleNumber(monto_origen);
        const tasa_num = parseLocaleNumber(tasa_cambio) || 1;

        const moneda_final = moneda || 'BS';
        const monto_usd_num = (moneda_final === 'USD' || moneda_final === 'EUR')
            ? monto_pagado_num
            : parseFloat((monto_pagado_num / tasa_num).toFixed(2));

        try {
            await pool.query('BEGIN');

            const optionalCols = await getPagosOptionalColumns();
            const insertColumns = [
                'recibo_id', 'cuenta_bancaria_id', 'monto_origen', 'tasa_cambio',
                'monto_usd', 'moneda', 'referencia', 'fecha_pago', 'metodo', 'estado',
            ];
            const insertValues = [
                recibo_id, cuenta_id, monto_pagado_num, tasa_num,
                monto_usd_num, moneda_final, referencia, fecha_pago || new Date(),
                metodo || 'Transferencia', 'Validado',
            ];

            if (optionalCols.nota) {
                insertColumns.push('nota');
                insertValues.push(nota || null);
            }
            if (optionalCols.cedula_origen) {
                insertColumns.push('cedula_origen');
                insertValues.push(cedula_origen || null);
            }
            if (optionalCols.banco_origen) {
                insertColumns.push('banco_origen');
                insertValues.push(banco_origen || null);
            }

            const placeholders = insertValues.map((_, idx) => `$${idx + 1}`).join(', ');
            const resultPago = await pool.query(`INSERT INTO pagos (${insertColumns.join(', ')}) VALUES (${placeholders}) RETURNING id`, insertValues);

            const pagoId = resultPago.rows[0].id;

            const fondos = await pool.query('SELECT * FROM fondos WHERE cuenta_bancaria_id = $1', [cuenta_id]);
            if (fondos.rows.length > 0) {
                let acumuladoOtros = 0;
                let fondoOperativoId = null;

                for (const f of fondos.rows) {
                    if (f.es_operativo) {
                        fondoOperativoId = f.id;
                        continue;
                    }
                    const tajada = (monto_pagado_num * (parseFloat(f.porcentaje_asignacion) / 100)).toFixed(2);
                    acumuladoOtros += parseFloat(tajada);
                    await pool.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [tajada, f.id]);
                    await pool.query('INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, nota) VALUES ($1, $2, $3, $4, $5)', [
                        f.id, 'INGRESO_PAGO', tajada, pagoId, `Aporte automatico (Recibo #${recibo_id})`,
                    ]);
                }

                if (fondoOperativoId) {
                    const resto = (monto_pagado_num - acumuladoOtros).toFixed(2);
                    await pool.query('UPDATE fondos SET saldo_actual = saldo_actual + $1 WHERE id = $2', [resto, fondoOperativoId]);
                    await pool.query('INSERT INTO movimientos_fondos (fondo_id, tipo, monto, referencia_id, nota) VALUES ($1, $2, $3, $4, $5)', [
                        fondoOperativoId, 'INGRESO_PAGO', resto, pagoId, `Ingreso operativo (Recibo #${recibo_id})`,
                    ]);
                }
            }

            const recRes = await pool.query('SELECT monto_usd FROM recibos WHERE id = $1', [recibo_id]);
            const montoRecibo = parseFloat(recRes.rows[0].monto_usd);

            const sumRes = await pool.query("SELECT SUM(monto_usd) as total_pagado FROM pagos WHERE recibo_id = $1 AND estado = 'Validado'", [recibo_id]);
            const totalPagado = parseFloat(sumRes.rows[0].total_pagado || 0);

            const nuevoEstado = totalPagado >= (montoRecibo - 0.05) ? 'Pagado' : 'Abonado Parcial';
            await pool.query('UPDATE recibos SET estado = $1 WHERE id = $2', [nuevoEstado, recibo_id]);

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Pago registrado y fondos distribuidos correctamente.' });
        } catch (err) {
            await pool.query('ROLLBACK');
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerPagosRoutes };

