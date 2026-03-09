const registerPropiedadesRoutes = (app, { pool, verifyToken }) => {
    
    // 1. OBTENER PROPIEDADES
    app.get('/propiedades-admin', verifyToken, async (req, res) => {
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const r = await pool.query(`
                SELECT p.id, p.identificador, p.alicuota, p.saldo_actual,
                    u1.id as prop_id, u1.nombre as prop_nombre, u1.cedula as prop_cedula, u1.email as prop_email, u1.telefono as prop_telefono,
                    u2.id as inq_id, u2.nombre as inq_nombre, u2.cedula as inq_cedula, u2.email as inq_email, u2.telefono as inq_telefono
                FROM propiedades p 
                LEFT JOIN usuarios_propiedades up1 ON p.id = up1.propiedad_id AND up1.rol = 'Propietario' LEFT JOIN users u1 ON up1.user_id = u1.id 
                LEFT JOIN usuarios_propiedades up2 ON p.id = up2.propiedad_id AND up2.rol = 'Inquilino' LEFT JOIN users u2 ON up2.user_id = u2.id
                WHERE p.condominio_id = $1 ORDER BY p.identificador ASC
            `, [c.rows[0].id]);
            res.json({ status: 'success', propiedades: r.rows });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // 2. ESTADO DE CUENTA
    app.get('/propiedades-admin/:id/estado-cuenta', verifyToken, async (req, res) => {
        const propiedadId = req.params.id;
        try {
            // 1. Cargos (Recibos / Deudas)
            const recibos = await pool.query(
                `SELECT 'RECIBO' as tipo, id as ref_id, 'Aviso de Cobro: ' || mes_cobro as concepto, monto_usd as cargo, 0 as abono, fecha_emision as fecha_operacion, fecha_emision as fecha_registro FROM recibos WHERE propiedad_id = $1`, 
                [propiedadId]
            );
            
            // 💡 2. Abonos (Pagos) - CORREGIDO: Ahora busca directamente por propiedad_id
            const pagos = await pool.query(
                `SELECT 'PAGO' as tipo, id as ref_id, 'Pago Ref: ' || referencia as concepto, 0 as cargo, monto_usd as abono, fecha_pago as fecha_operacion, COALESCE(created_at, fecha_pago) as fecha_registro FROM pagos WHERE propiedad_id = $1 AND estado = 'Validado'`, 
                [propiedadId]
            );
            
            // 3. Ajustes Manuales (Saldos a favor / Deudas cargadas a mano)
            const ajustes = await pool.query(
                `SELECT 'AJUSTE' as tipo, id as ref_id, nota as concepto, CASE WHEN tipo = 'CARGAR_DEUDA' OR (tipo = 'SALDO_INICIAL' AND nota LIKE '%(DEUDA)%') THEN monto ELSE 0 END as cargo, CASE WHEN tipo = 'AGREGAR_FAVOR' OR (tipo = 'SALDO_INICIAL' AND nota LIKE '%(FAVOR)%') THEN monto ELSE 0 END as abono, fecha as fecha_operacion, fecha as fecha_registro FROM historial_saldos_inmuebles WHERE propiedad_id = $1`, 
                [propiedadId]
            );
            
            let movimientos = [...recibos.rows, ...pagos.rows, ...ajustes.rows];
            
            // Ordenamos cronológicamente
            movimientos.sort((a, b) => new Date(a.fecha_registro) - new Date(b.fecha_registro));
            
            res.json({ status: 'success', movimientos });
        } catch (err) { 
            res.status(500).json({ error: err.message }); 
        }
    });

    // 💡 3. NUEVA RUTA: CARGA MASIVA DE INMUEBLES POR LOTE (EXCEL)
    app.post('/propiedades-admin/lote', verifyToken, async (req, res) => {
        const { inmuebles } = req.body; 
        
        if (!inmuebles || !Array.isArray(inmuebles) || inmuebles.length === 0) {
            return res.status(400).json({ error: 'No se enviaron datos válidos.' });
        }

        try {
            await pool.query('BEGIN');
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            for (const item of inmuebles) {
                const alicuotaNum = parseFloat((item.alicuota || '0').toString().replace(',', '.')) || 0;
                let saldoBase = parseFloat((item.saldo_inicial || '0').toString().replace(',', '.')) || 0;
                let cedulaFmt = (item.cedula || '').toUpperCase().replace(/[^VEJPG0-9]/g, '');
                
                let userId = null;
                if (cedulaFmt && item.nombre) {
                    let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [cedulaFmt]);
                    if (userRes.rows.length === 0) {
                        userRes = await pool.query(
                            'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                            [cedulaFmt, item.nombre, item.correo || null, item.telefono || null, cedulaFmt]
                        );
                    } else {
                        await pool.query('UPDATE users SET nombre = $1 WHERE cedula = $2', [item.nombre, cedulaFmt]);
                    }
                    userId = userRes.rows[0].id;
                }

                const propRes = await pool.query(
                    'INSERT INTO propiedades (condominio_id, identificador, alicuota, saldo_actual) VALUES ($1, $2, $3, $4) RETURNING id', 
                    [condoId, item.identificador, alicuotaNum, saldoBase]
                );
                const nuevaPropId = propRes.rows[0].id;

                if (saldoBase !== 0) {
                    const tipoSaldo = saldoBase > 0 ? 'DEUDA' : 'FAVOR';
                    await pool.query(
                        'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', 
                        [nuevaPropId, 'SALDO_INICIAL', Math.abs(saldoBase), `Carga masiva Excel (${tipoSaldo})`]
                    );
                }

                if (userId) {
                    await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, nuevaPropId, 'Propietario']);
                }
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: `${inmuebles.length} inmuebles cargados correctamente.` });
        } catch (err) {
            await pool.query('ROLLBACK');
            if (err.code === '23505' && err.message.includes('identificador')) return res.status(400).json({ error: `Uno de los inmuebles (Apto/Casa) del archivo ya existe en el sistema.` });
            if (err.code === '23505' && err.message.includes('email')) return res.status(400).json({ error: `Uno de los correos en el archivo ya está en uso.` });
            res.status(500).json({ error: err.message });
        }
    });

    // 4. CREAR PROPIEDAD INDIVIDUAL
    app.post('/propiedades-admin', verifyToken, async (req, res) => {
        const { identificador, alicuota, zona_id, prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password, tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password, monto_saldo_inicial, tipo_saldo_inicial } = req.body;
        const ownerEmail = (prop_email || '').trim() || null;
        const tenantEmail = (inq_email || '').trim() || null;
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;
        
        let saldoBase = parseFloat((monto_saldo_inicial || '0').toString().replace(',', '.')) || 0;
        if (tipo_saldo_inicial === 'FAVOR') saldoBase = -Math.abs(saldoBase);
        if (tipo_saldo_inicial === 'DEUDA') saldoBase = Math.abs(saldoBase);

        try {
            await pool.query('BEGIN');
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            
            let userId = null;
            if (prop_cedula && prop_nombre) {
                let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [prop_cedula]);
                if (userRes.rows.length === 0) {
                    userRes = await pool.query('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [prop_cedula, prop_nombre, ownerEmail, prop_telefono || null, prop_password || '123456']);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [prop_nombre, ownerEmail, prop_telefono || null, prop_cedula]);
                    if (prop_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [prop_password, prop_cedula]);
                }
                userId = userRes.rows[0].id;
            }

            const propRes = await pool.query('INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id, saldo_actual) VALUES ($1, $2, $3, $4, $5) RETURNING id', [c.rows[0].id, identificador, alicuotaNum, zona_id || null, saldoBase]);
            const nuevaPropId = propRes.rows[0].id;

            if (saldoBase !== 0) await pool.query('INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', [nuevaPropId, 'SALDO_INICIAL', Math.abs(saldoBase), `Saldo inicial cargado al crear el inmueble (${tipo_saldo_inicial})`]);
            if (userId) await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, nuevaPropId, 'Propietario']);

            if (tiene_inquilino && inq_cedula && inq_nombre) {
                let tenantRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [inq_cedula]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [inq_cedula, inq_nombre, tenantEmail, inq_telefono || null, inq_password || '123456']);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [inq_nombre, tenantEmail, inq_telefono || null, inq_cedula]);
                    if (inq_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [inq_password, inq_cedula]);
                }
                await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [tenantRes.rows[0].id, nuevaPropId, 'Inquilino']);
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble guardado correctamente' });
        } catch (err) {
            await pool.query('ROLLBACK');
            if (err.code === '23505' && err.message.includes('email')) return res.status(400).json({ error: 'El correo ingresado ya pertenece a otro usuario en el sistema. Debe usar un correo distinto.' });
            res.status(500).json({ error: err.message });
        }
    });

    // 5. EDITAR PROPIEDAD INDIVIDUAL
    app.put('/propiedades-admin/:id', verifyToken, async (req, res) => {
        const propiedadId = req.params.id;
        const { identificador, alicuota, zona_id, prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password, tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password } = req.body;
        
        const ownerEmail = (prop_email || '').trim() || null;
        const tenantEmail = (inq_email || '').trim() || null;
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;

        try {
            await pool.query('BEGIN');
            await pool.query('UPDATE propiedades SET identificador = $1, alicuota = $2, zona_id = $3 WHERE id = $4', [identificador, alicuotaNum, zona_id || null, propiedadId]);

            if (prop_cedula && prop_nombre) {
                let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [prop_cedula]);
                let userId = null;
                if (userRes.rows.length === 0) {
                    userRes = await pool.query('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [prop_cedula, prop_nombre, ownerEmail, prop_telefono || null, prop_password || '123456']);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [prop_nombre, ownerEmail, prop_telefono || null, prop_cedula]);
                    if (prop_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [prop_password, prop_cedula]);
                }
                userId = userRes.rows[0].id;
                const linkRes = await pool.query('SELECT id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Propietario']);
                if (linkRes.rows.length > 0) { await pool.query('UPDATE usuarios_propiedades SET user_id = $1 WHERE id = $2', [userId, linkRes.rows[0].id]); } 
                else { await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, propiedadId, 'Propietario']); }
            }

            if (tiene_inquilino && inq_cedula && inq_nombre) {
                let tenantRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [inq_cedula]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [inq_cedula, inq_nombre, tenantEmail, inq_telefono || null, inq_password || '123456']);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [inq_nombre, tenantEmail, inq_telefono || null, inq_cedula]);
                    if (inq_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [inq_password, inq_cedula]);
                }
                const tenantId = tenantRes.rows[0].id;
                const tenantLink = await pool.query('SELECT id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
                if (tenantLink.rows.length > 0) { await pool.query('UPDATE usuarios_propiedades SET user_id = $1 WHERE id = $2', [tenantId, tenantLink.rows[0].id]); } 
                else { await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [tenantId, propiedadId, 'Inquilino']); }
            } else {
                await pool.query('DELETE FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble actualizado correctamente' });
        } catch (err) {
            await pool.query('ROLLBACK');
            if (err.code === '23505' && err.message.includes('email')) return res.status(400).json({ error: 'El correo ingresado ya pertenece a otro usuario en el sistema. Debe usar un correo distinto.' });
            res.status(500).json({ error: err.message });
        }
    });

    // 6. AJUSTAR SALDO MANUALMENTE
    app.post('/propiedades-admin/:id/ajustar-saldo', verifyToken, async (req, res) => {
        const propiedadId = req.params.id;
        const { monto, tipo_ajuste, nota } = req.body; 
        const montoNum = parseFloat((monto || '0').toString().replace(',', '.')) || 0;
        if (montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

        try {
            await pool.query('BEGIN');
            const operador = tipo_ajuste === 'CARGAR_DEUDA' ? '+' : '-';
            await pool.query(`UPDATE propiedades SET saldo_actual = saldo_actual ${operador} $1 WHERE id = $2`, [montoNum, propiedadId]);
            await pool.query('INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', [propiedadId, tipo_ajuste, montoNum, nota || 'Ajuste manual del administrador']);
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Saldo ajustado exitosamente' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerPropiedadesRoutes };