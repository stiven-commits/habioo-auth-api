const registerPagosRoutes = (app, { pool, verifyToken, parseLocaleNumber, getPagosOptionalColumns }) => {
    const getPagosColumns = async () => {
        const optionalCols = await getPagosOptionalColumns();
        try {
            const result = await pool.query(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'pagos'
                  AND column_name IN ('propiedad_id')
            `);
            const cols = new Set(result.rows.map((r) => r.column_name));
            return { ...optionalCols, propiedad_id: cols.has('propiedad_id') };
        } catch (err) {
            return { ...optionalCols, propiedad_id: false };
        }
    };

    const aplicarCascadaPago = async (client, pagoId, { requirePending = false } = {}) => {
        const pagoQuery = requirePending
            ? 'SELECT * FROM pagos WHERE id = $1 AND estado = $2'
            : 'SELECT * FROM pagos WHERE id = $1';
        const pagoParams = requirePending ? [pagoId, 'Pendiente'] : [pagoId];

        const pagoRes = await client.query(pagoQuery, pagoParams);
        if (pagoRes.rows.length === 0) {
            throw new Error(requirePending ? 'Pago no encontrado o ya fue procesado.' : 'Pago no encontrado.');
        }

        const pago = pagoRes.rows[0];
        const montoAprobado = parseFloat(pago.monto_usd || 0);
        if (!montoAprobado || montoAprobado <= 0) {
            throw new Error('El pago no tiene monto_usd valido para aplicar la cascada.');
        }

        let propiedadId = pago.propiedad_id || null;
        if (!propiedadId && pago.recibo_id) {
            const rec = await client.query('SELECT propiedad_id FROM recibos WHERE id = $1', [pago.recibo_id]);
            propiedadId = rec.rows[0]?.propiedad_id || null;
        }
        if (!propiedadId) throw new Error('No se pudo determinar la propiedad asociada al pago.');

        if (pago.estado !== 'Validado') {
            await client.query("UPDATE pagos SET estado = 'Validado' WHERE id = $1", [pagoId]);
        }

        await client.query('UPDATE propiedades SET saldo_actual = COALESCE(saldo_actual, 0) - $1 WHERE id = $2', [montoAprobado, propiedadId]);

        let dineroRestante = montoAprobado;
        const recibosPendientes = await client.query(
            "SELECT * FROM recibos WHERE propiedad_id = $1 AND estado != 'Pagado' ORDER BY fecha_emision ASC, id ASC",
            [propiedadId]
        );

        for (const rec of recibosPendientes.rows) {
            if (dineroRestante <= 0) break;

            const montoRecibo = parseFloat(rec.monto_usd || 0);
            const montoPagadoActual = parseFloat(rec.monto_pagado_usd || 0);
            const deudaRecibo = montoRecibo - montoPagadoActual;

            if (deudaRecibo <= 0) {
                await client.query("UPDATE recibos SET estado = 'Pagado' WHERE id = $1", [rec.id]);
                continue;
            }

            if (dineroRestante >= deudaRecibo) {
                await client.query("UPDATE recibos SET monto_pagado_usd = monto_usd, estado = 'Pagado' WHERE id = $1", [rec.id]);
                dineroRestante -= deudaRecibo;
            } else {
                await client.query("UPDATE recibos SET monto_pagado_usd = COALESCE(monto_pagado_usd, 0) + $1, estado = 'Abonado' WHERE id = $2", [dineroRestante, rec.id]);
                dineroRestante = 0;
            }
        }
    };

    // 💡 RUTA DE ADMINISTRADORES PARA REGISTRAR Y APROBAR PAGOS EN CASCADA AL INSTANTE
    app.post('/pagos-admin', verifyToken, async (req, res) => {
        // Recibimos propiedad_id en lugar de recibo_id
        const { propiedad_id, cuenta_id, monto_origen, tasa_cambio, referencia, fecha_pago, nota, cedula_origen, banco_origen, moneda } = req.body;
        
        try {
            await pool.query('BEGIN');
            
            // 1. Calculamos montos normalizados
            const monedaFinal = moneda || 'BS';
            const montoOrigenNum = parseLocaleNumber(monto_origen);
            const tasaNum = monedaFinal === 'BS' ? (parseLocaleNumber(tasa_cambio) || 1) : 1;
            const montoUsd = monedaFinal === 'BS' ? parseFloat((montoOrigenNum / tasaNum).toFixed(2)) : montoOrigenNum;

            // 2. Insertamos el pago ya 'Validado' (porque lo hizo el admin)
            const optionalCols = await getPagosOptionalColumns();
            const insertColumns = [
                'propiedad_id',
                'recibo_id',
                'cuenta_bancaria_id',
                'monto_origen',
                'tasa_cambio',
                'monto_usd',
                'moneda',
                'referencia',
                'fecha_pago',
                'metodo',
                'estado',
            ];
            const insertValues = [
                propiedad_id,
                null,
                cuenta_id,
                montoOrigenNum,
                monedaFinal === 'BS' ? tasaNum : null,
                montoUsd,
                monedaFinal,
                referencia || null,
                fecha_pago || new Date(),
                'Transferencia',
                'Validado',
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

            const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ');
            await pool.query(
                `INSERT INTO pagos (${insertColumns.join(', ')}) VALUES (${placeholders})`,
                insertValues
            );

            // 3. Restamos el dinero del saldo consolidado de la propiedad
            await pool.query('UPDATE propiedades SET saldo_actual = saldo_actual - $1 WHERE id = $2', [montoUsd, propiedad_id]);

            // 🌟 4. EJECUTAMOS LA CASCADA (FIFO) PARA MATAR LOS RECIBOS
            let dineroRestante = montoUsd;
            
            const recibosPendientes = await pool.query(
                "SELECT * FROM recibos WHERE propiedad_id = $1 AND estado != 'Pagado' ORDER BY fecha_emision ASC", 
                [propiedad_id]
            );

            for (let rec of recibosPendientes.rows) {
                if (dineroRestante <= 0) break; // Si se acabó la plata, salimos del ciclo

                let deudaRecibo = parseFloat(rec.monto_usd) - parseFloat(rec.monto_pagado_usd || 0);
                
                if (dineroRestante >= deudaRecibo) {
                    // Si alcanza para liquidar el recibo completo
                    await pool.query("UPDATE recibos SET monto_pagado_usd = monto_usd, estado = 'Pagado' WHERE id = $1", [rec.id]);
                    dineroRestante -= deudaRecibo;
                } else {
                    // 💡 CORREGIDO: Usamos 'Abonado'
                    await pool.query("UPDATE recibos SET monto_pagado_usd = monto_pagado_usd + $1, estado = 'Abonado' WHERE id = $2", [dineroRestante, rec.id]);
                    dineroRestante = 0; // Se acabó el dinero
                }
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Pago registrado y saldos distribuidos exitosamente en la propiedad.' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });

    // Validacion manual de pagos pendientes (FIFO por recibos de la propiedad)
    // RUTA PARA VALIDAR/APROBAR UN PAGO
    app.post('/pagos/:id/validar', verifyToken, async (req, res) => {
        const pagoId = req.params.id;

        try {
            await pool.query('BEGIN');
            
            // 1. Buscamos el pago y a qué propiedad pertenece
            const pagoRes = await pool.query('SELECT * FROM pagos WHERE id = $1 AND estado = $2', [pagoId, 'Pendiente']);
            if (pagoRes.rows.length === 0) throw new Error('Pago no encontrado o ya fue procesado.');
            
            const pago = pagoRes.rows[0];
            const montoAprobado = parseFloat(pago.monto_usd);
            const propiedadId = pago.propiedad_id;

            // 2. Cambiamos el estado del pago a Validado
            await pool.query("UPDATE pagos SET estado = 'Validado' WHERE id = $1", [pagoId]);

            // 3. Restamos la deuda global de la propiedad (Saldo Consolidado)
            await pool.query('UPDATE propiedades SET saldo_actual = saldo_actual - $1 WHERE id = $2', [montoAprobado, propiedadId]);

            // 🌟 4. LA MAGIA DE LA CASCADA (FIFO) 🌟
            let dineroRestante = montoAprobado;
            
            // Traemos todos los recibos viejos que aún no están pagados al 100%
            const recibosPendientes = await pool.query(
                "SELECT * FROM recibos WHERE propiedad_id = $1 AND estado != 'Pagado' ORDER BY fecha_emision ASC", 
                [propiedadId]
            );

            for (let rec of recibosPendientes.rows) {
                if (dineroRestante <= 0) break; // Si ya se nos acabó el dinero del pago, paramos.

                // Calculamos cuánto le falta a este recibo específico para pagarse por completo
                let deudaRecibo = parseFloat(rec.monto_usd) - parseFloat(rec.monto_pagado_usd || 0);
                
                if (dineroRestante >= deudaRecibo) {
                    // El dinero alcanza para matar este recibo por completo
                    await pool.query(
                        "UPDATE recibos SET monto_pagado_usd = monto_usd, estado = 'Pagado' WHERE id = $1", 
                        [rec.id]
                    );
                    dineroRestante -= deudaRecibo; // Sobra dinero para el siguiente recibo
                } else {
                    // El dinero NO alcanza para matarlo, queda como un abono parcial
                    await pool.query(
                        "UPDATE recibos SET monto_pagado_usd = monto_pagado_usd + $1, estado = 'Abonado' WHERE id = $2", 
                        [dineroRestante, rec.id]
                    );
                    dineroRestante = 0; // Nos quedamos sin dinero
                }
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Pago aprobado y saldos distribuidos en cascada correctamente.' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerPagosRoutes };
