const registerPropiedadesRoutes = (app, { pool, verifyToken }) => {
    app.get('/propiedades-admin', verifyToken, async (req, res) => {
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const r = await pool.query(
                `
            SELECT p.id, p.identificador, p.alicuota,
                u1.id as prop_id, u1.nombre as prop_nombre, u1.cedula as prop_cedula, u1.email as prop_email, u1.telefono as prop_telefono,
                u2.id as inq_id, u2.nombre as inq_nombre, u2.cedula as inq_cedula, u2.email as inq_email, u2.telefono as inq_telefono
            FROM propiedades p LEFT JOIN usuarios_propiedades up1 ON p.id = up1.propiedad_id AND up1.rol = 'Propietario' LEFT JOIN users u1 ON up1.user_id = u1.id LEFT JOIN usuarios_propiedades up2 ON p.id = up2.propiedad_id AND up2.rol = 'Inquilino' LEFT JOIN users u2 ON up2.user_id = u2.id
            WHERE p.condominio_id = $1 ORDER BY p.identificador ASC
        `,
                [c.rows[0].id]
            );
            res.json({ status: 'success', propiedades: r.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/propiedades-admin', verifyToken, async (req, res) => {
        const {
            identificador, alicuota, zona_id,
            prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password,
            tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password,
            nombre, cedula, correo, telefono, password,
        } = req.body;
        const ownerNombre = prop_nombre || nombre || '';
        const ownerCedula = prop_cedula || cedula || '';
        const ownerEmail = prop_email || correo || null;
        const ownerTelefono = prop_telefono || telefono || null;
        const ownerPassword = prop_password || password || '123456';
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;

        try {
            await pool.query('BEGIN');
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            let userId = null;
            if (ownerCedula && ownerNombre) {
                let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [ownerCedula]);

                if (userRes.rows.length === 0) {
                    userRes = await pool.query(
                        'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [ownerCedula, ownerNombre, ownerEmail, ownerTelefono, ownerPassword]
                    );
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [ownerNombre, ownerEmail, ownerTelefono, ownerCedula]);

                    if (prop_password || password) {
                        await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [ownerPassword, ownerCedula]);
                    }
                }
                userId = userRes.rows[0].id;
            }

            const propRes = await pool.query('INSERT INTO propiedades (condominio_id, identificador, alicuota, zona_id) VALUES ($1, $2, $3, $4) RETURNING id', [
                condoId, identificador, alicuotaNum, zona_id || null,
            ]);

            if (userId) {
                await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [userId, propRes.rows[0].id, 'Propietario']);
            }

            const tieneInquilino = tiene_inquilino === true || tiene_inquilino === 'true';
            if (tieneInquilino && inq_cedula && inq_nombre) {
                let tenantRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [inq_cedula]);
                if (tenantRes.rows.length === 0) {
                    tenantRes = await pool.query(
                        'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [inq_cedula, inq_nombre, inq_email || null, inq_telefono || null, inq_password || '123456']
                    );
                } else {
                    await pool.query(
                        'UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4',
                        [inq_nombre, inq_email || null, inq_telefono || null, inq_cedula]
                    );
                    if (inq_password) {
                        await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [inq_password, inq_cedula]);
                    }
                }
                const tenantId = tenantRes.rows[0].id;
                await pool.query('INSERT INTO usuarios_propiedades (user_id, propiedad_id, rol) VALUES ($1, $2, $3)', [tenantId, propRes.rows[0].id, 'Inquilino']);
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: 'Inmueble y residente guardados correctamente' });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/propiedades-admin/:id', verifyToken, async (req, res) => {
        const propiedadId = req.params.id;
        const {
            identificador, alicuota, zona_id,
            prop_nombre, prop_cedula, prop_email, prop_telefono, prop_password,
            tiene_inquilino, inq_nombre, inq_cedula, inq_email, inq_telefono, inq_password,
            nombre, cedula, correo, telefono, password,
        } = req.body;
        const ownerNombre = prop_nombre || nombre || '';
        const ownerCedula = prop_cedula || cedula || '';
        const ownerEmail = prop_email || correo || null;
        const ownerTelefono = prop_telefono || telefono || null;
        const ownerPassword = prop_password || password || null;
        const alicuotaNum = parseFloat((alicuota || '0').toString().replace(',', '.')) || 0;

        try {
            await pool.query('BEGIN');

            await pool.query('UPDATE propiedades SET identificador = $1, alicuota = $2, zona_id = $3 WHERE id = $4', [identificador, alicuotaNum, zona_id || null, propiedadId]);

            if (ownerCedula && ownerNombre) {
                let userRes = await pool.query('SELECT id FROM users WHERE cedula = $1', [ownerCedula]);
                let userId = null;

                if (userRes.rows.length === 0) {
                    userRes = await pool.query(
                        'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [ownerCedula, ownerNombre, ownerEmail, ownerTelefono, ownerPassword || '123456']
                    );
                } else {
                    await pool.query('UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4', [ownerNombre, ownerEmail, ownerTelefono, ownerCedula]);

                    if (ownerPassword) {
                        await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [ownerPassword, ownerCedula]);
                    }
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
                    tenantRes = await pool.query(
                        'INSERT INTO users (cedula, nombre, email, telefono, password) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [inq_cedula, inq_nombre, inq_email || null, inq_telefono || null, inq_password || '123456']
                    );
                } else {
                    await pool.query(
                        'UPDATE users SET nombre = $1, email = $2, telefono = $3 WHERE cedula = $4',
                        [inq_nombre, inq_email || null, inq_telefono || null, inq_cedula]
                    );
                    if (inq_password) {
                        await pool.query('UPDATE users SET password = $1 WHERE cedula = $2', [inq_password, inq_cedula]);
                    }
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
};

module.exports = { registerPropiedadesRoutes };

