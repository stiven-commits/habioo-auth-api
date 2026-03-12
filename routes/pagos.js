const registerPagosRoutes = (app, { pool, verifyToken, parseLocaleNumber, getPagosOptionalColumns }) => {
    const resolveMovimientoFondoTipo = async () => {
        try {
            const r = await pool.query(`
                SELECT pg_get_constraintdef(oid) AS def
                FROM pg_constraint
                WHERE conname = 'movimientos_fondos_tipo_check'
                LIMIT 1
            `);
            const def = r.rows?.[0]?.def || '';
            const matches = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
            const allowed = new Set(matches);

            const preferred = ['ABONO', 'ENTRADA', 'INGRESO', 'AJUSTE_INICIAL'];
            const selected = preferred.find((t) => allowed.has(t));
            if (selected) return selected;
            if (matches.length > 0) return matches[0];
        } catch (_) {
            // fallback below
        }
        return 'AJUSTE_INICIAL';
    };

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
            const pagoInsertRes = await pool.query(
                `INSERT INTO pagos (${insertColumns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
                insertValues
            );
            const pagoId = pagoInsertRes.rows?.[0]?.id || null;

            // 2.1. Distribucion del ingreso en fondos de la cuenta (porcentaje + remanente al principal)
            const fondosRes = await pool.query(
                `SELECT id, moneda, porcentaje_asignacion, es_operativo
                 FROM fondos
                 WHERE cuenta_bancaria_id = $1 AND activo = true
                 ORDER BY es_operativo DESC, id ASC`,
                [cuenta_id]
            );
            const fondosActivos = fondosRes.rows || [];
            if (fondosActivos.length === 0) {
                throw new Error('La cuenta seleccionada no tiene fondos activos para distribuir el abono.');
            }

            const noOperativos = fondosActivos.filter((f) => !f.es_operativo);
            const fondoPrincipal = fondosActivos.find((f) => !!f.es_operativo) || null;
            const totalPctNoOper = noOperativos.reduce((acc, f) => acc + parseFloat(f.porcentaje_asignacion || 0), 0);
            if (totalPctNoOper > 100) {
                throw new Error('La suma de porcentajes de fondos excede 100%. Ajuste la configuracion de fondos.');
            }

            const distUsd = [];
            let acumuladoUsd = 0;
            noOperativos.forEach((f) => {
                const pct = parseFloat(f.porcentaje_asignacion || 0);
                const parte = parseFloat(((montoUsd * pct) / 100).toFixed(2));
                acumuladoUsd += parte;
                distUsd.push({ ...f, montoUsdParte: parte });
            });

            const remanenteUsd = parseFloat((montoUsd - acumuladoUsd).toFixed(2));
            if (fondoPrincipal) {
                distUsd.push({ ...fondoPrincipal, montoUsdParte: remanenteUsd });
            } else if (distUsd.length > 0) {
                // Si no existe fondo principal, mandamos el remanente al ultimo fondo porcentual.
                distUsd[distUsd.length - 1].montoUsdParte = parseFloat(
                    (distUsd[distUsd.length - 1].montoUsdParte + remanenteUsd).toFixed(2)
                );
            } else {
                // Cuenta con un solo fondo sin porcentaje.
                distUsd.push({ ...fondosActivos[0], montoUsdParte: montoUsd });
            }

            for (const d of distUsd) {
                const usdParte = parseFloat(d.montoUsdParte || 0);
                if (usdParte <= 0) continue;

                let montoFondo = usdParte;
                if (d.moneda === 'BS') {
                    if (!tasaNum || tasaNum <= 0) {
                        throw new Error('No hay tasa de cambio valida para abonar un fondo en Bs.');
                    }
                    montoFondo = parseFloat((usdParte * tasaNum).toFixed(2));
                }

                const tipoMovimiento = await resolveMovimientoFondoTipo();
                await pool.query('UPDATE fondos SET saldo_actual = COALESCE(saldo_actual, 0) + $1 WHERE id = $2', [montoFondo, d.id]);
                await pool.query(
                    'INSERT INTO movimientos_fondos (fondo_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)',
                    [d.id, tipoMovimiento, montoFondo, `Abono de pago${pagoId ? ` #${pagoId}` : ''} (${referencia || 'sin referencia'})`]
                );
            }

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
