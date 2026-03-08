const registerPropiedadesRoutes = (app, { pool, verifyToken }) => {
    
    // OBTENER PROPIEDADES (Ahora incluye saldo_actual)
    app.get('/propiedades-admin', verifyToken, async (req, res) => {
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const r = await pool.query(
                `
            SELECT p.id, p.identificador, p.alicuota, p.saldo_actual,
                u1.id as prop_id, u1.nombre as prop_nombre, u1.cedula as prop_cedula, u1.email as prop_email, u1.telefono as prop_telefono,
                u2.id as inq_id, u2.nombre as inq_nombre, u2.cedula as inq_cedula, u2.email as inq_email, u2.telefono as inq_telefono
            FROM propiedades p 
            LEFT JOIN usuarios_propiedades up1 ON p.id = up1.propiedad_id AND up1.rol = 'Propietario' LEFT JOIN users u1 ON up1.user_id = u1.id 
            LEFT JOIN usuarios_propiedades up2 ON p.id = up2.propiedad_id AND up2.rol = 'Inquilino' LEFT JOIN users u2 ON up2.user_id = u2.id
            WHERE p.condominio_id = $1 ORDER BY p.identificador ASC
        `, [c.rows[0].id]
            );
            res.json({ status: 'success', propiedades: r.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // CREAR PROPIEDAD (Ahora recibe saldo_inicial y tipo_saldo)
    app.post('/propiedades-admin', verifyToken, async (req, res) => {
        const {
            identificador, alicuota, zona_id,
            prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password,
            tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password,
            monto_saldo_inicial, tipo_saldo_inicial // <-- Nuevos campos
        } = req.body;

        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;
        
        // Cálculo del saldo: Si es Deuda es positivo, si es a Favor es negativo
        let saldoBase = parseFloat((monto_saldo_inicial || '0').toString().replace(',', '.')) || 0;
        if (tipo_saldo_inicial === 'FAVOR') saldoBase = -Math.abs(saldoBase);
        if (tipo_saldo_inicial === 'DEUDA') saldoBase = Math.abs(saldoBase);

        try {
            await pool.query('BEGIN');
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            // 1. Manejo del Propietario
            let userId = null;
            if (prop_cedula && prop_nombre) {
                let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [prop_cedula]);
                if (userRes.rows.length === 0) {
                    userRes = await pool.query(
                        'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [prop_cedula, prop_nombre, prop_email || null, prop_telefono || null, prop_password || '123456']
                    );
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [prop_nombre, prop_email || null, prop_telefono || null, prop_cedula]);
                    if (prop_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [prop_password, prop_cedula]);
                }
                userId = userRes.rows[0].id;
            }

            // 2. Guardar Inmueble con su Saldo
            const propRes = await pool.query('INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id, saldo_actual) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
                condoId, identificador, alicuotaNum, zona_id || null, saldoBase
            ]);

            const nuevaPropiedadId = propRes.rows[0].id;

            // 3. Registrar el historial si el saldo inicial no es cero
            if (saldoBase !== 0) {
                await pool.query(
                    'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', 
                    [nuevaPropiedadId, 'SALDO_INICIAL', Math.abs(saldoBase), `Saldo inicial cargado al crear el inmueble (${tipo_saldo_inicial})`]
                );
            }

            if (userId) await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, nuevaPropiedadId, 'Propietario']);

            // 4. Manejo del Inquilino
            const tieneInquilino = tiene_inquilino === true || tiene_inquilino === 'true';
            if (tieneInquilino && inq_cedula && inq_nombre) {
                let tenantRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [inq_cedula]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [inq_cedula, inq_nombre, inq_email || null, inq_telefono || null, inq_password || '123456']);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [inq_nombre, inq_email || null, inq_telefono || null, inq_cedula]);
                    if (inq_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [inq_password, inq_cedula]);
                }
                await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [tenantRes.rows[0].id, nuevaPropiedadId, 'Inquilino']);
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble y residente guardados correctamente' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });

    // EDITAR PROPIEDAD (Se deja igual, la edición del saldo se hace por la otra ruta)
    app.put('/propiedades-admin/:id', verifyToken, async (req, res) => {
        // ... [Todo el código de tu PUT actual se mantiene exactamente igual] ...
        const propiedadId = req.params.id;
        const { identificador, alicuota, zona_id, prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password, tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password } = req.body;
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;

        try {
            await pool.query('BEGIN');
            await pool.query('UPDATE propiedades SET identificador = $1, alicuota = $2, zona_id = $3 WHERE id = $4', [identificador, alicuotaNum, zona_id || null, propiedadId]);

            if (prop_cedula && prop_nombre) {
                let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [prop_cedula]);
                let userId = null;
                if (userRes.rows.length === 0) {
                    userRes = await pool.query('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [prop_cedula, prop_nombre, prop_email || null, prop_telefono || null, prop_password || '123456']);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [prop_nombre, prop_email || null, prop_telefono || null, prop_cedula]);
                    if (prop_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [prop_password, prop_cedula]);
                }
                userId = userRes.rows[0].id;

                const linkRes = await pool.query('SELECT id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Propietario']);
                if (linkRes.rows.length > 0) {
                    await pool.query('UPDATE usuarios_propiedades SET user_id = $1 WHERE id = $2', [userId, linkRes.rows[0].id]);
                } else {
                    await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, propiedadId, 'Propietario']);
                }
            }

            const tieneInquilino = tiene_inquilino === true || tiene_inquilino === 'true';
            if (tieneInquilino && inq_cedula && inq_nombre) {
                let tenantRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [inq_cedula]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query('INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id', [inq_cedula, inq_nombre, inq_email || null, inq_telefono || null, inq_password || '123456']);
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [inq_nombre, inq_email || null, inq_telefono || null, inq_cedula]);
                    if (inq_password) await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [inq_password, inq_cedula]);
                }
                const tenantId = tenantRes.rows[0].id;
                const tenantLink = await pool.query('SELECT id FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
                if (tenantLink.rows.length > 0) {
                    await pool.query('UPDATE usuarios_propiedades SET user_id = $1 WHERE id = $2', [tenantId, tenantLink.rows[0].id]);
                } else {
                    await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [tenantId, propiedadId, 'Inquilino']);
                }
            } else {
                await pool.query('DELETE FROM usuarios_propiedades WHERE propiedad_id = $1 AND rol = $2', [propiedadId, 'Inquilino']);
            }
            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble actualizado correctamente' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });

    // 💡 NUEVO: RUTA PARA AJUSTAR SALDO MANUALMENTE
    app.post('/propiedades-admin/:id/ajustar-saldo', verifyToken, async (req, res) => {
        const propiedadId = req.params.id;
        const { monto, tipo_ajuste, nota } = req.body; 

        // tipo_ajuste puede ser: 'CARGAR_DEUDA' o 'AGREGAR_FAVOR'
        const montoNum = parseFloat((monto || '0').toString().replace(',', '.')) || 0;
        
        if (montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

        try {
            await pool.query('BEGIN');
            
            // Si es cargar deuda, sumamos al saldo (+). Si es a favor, restamos al saldo (-)
            const operador = tipo_ajuste === 'CARGAR_DEUDA' ? '+' : '-';
            
            await pool.query(`UPDATE propiedades SET saldo_actual = saldo_actual ${operador} $1 WHERE id = $2`, [montoNum, propiedadId]);
            
            await pool.query(
                'INSERT INTO historial_saldos_inmuebles (propiedad_id, tipo, monto, nota) VALUES ($1, $2, $3, $4)', 
                [propiedadId, tipo_ajuste, montoNum, nota || 'Ajuste manual del administrador']
            );

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Saldo ajustado exitosamente' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerPropiedadesRoutes };