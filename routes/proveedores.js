const registerProveedoresRoutes = (app, { pool, verifyToken }) => {
    
    // 💡 1. CREAR O REACTIVAR PROVEEDOR
    app.post('/proveedores', verifyToken, async (req, res) => {
        const { identificador, nombre, telefono1, telefono2, direccion, estado_venezuela, rubro } = req.body;
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            // Verificamos si este condominio ya tiene un proveedor con este RIF
            const exist = await pool.query('SELECT id, activo FROM proveedores WHERE identificador = $1 AND condominio_id = $2', [identificador, condoId]);

            if (exist.rows.length > 0) {
                if (exist.rows[0].activo) {
                    // Si ya existe y está activo, bloqueamos la creación
                    return res.status(400).json({ error: 'Ya existe un proveedor activo registrado con este RIF.' });
                } else {
                    // Si existía pero estaba "Eliminado", lo reactivamos y le actualizamos los datos nuevos
                    await pool.query(
                        'UPDATE proveedores SET nombre=$1, telefono1=$2, telefono2=$3, direccion=$4, estado_venezuela=$5, rubro=$6, activo=true WHERE id=$7',
                        [nombre, telefono1, telefono2, direccion, estado_venezuela, rubro || null, exist.rows[0].id]
                    );
                    return res.json({ status: 'success', message: 'El proveedor estaba oculto, ha sido reactivado y actualizado.' });
                }
            }

            // Si no existe, lo insertamos normalmente
            await pool.query(
                'INSERT INTO proveedores (condominio_id, identificador, nombre, telefono1, telefono2, direccion, estado_venezuela, rubro) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [condoId, identificador, nombre, telefono1, telefono2, direccion, estado_venezuela, rubro || null]
            );
            res.json({ status: 'success', message: 'Proveedor registrado exitosamente.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 💡 2. EDITAR PROVEEDOR EXISTENTE
    app.put('/proveedores/:id', verifyToken, async (req, res) => {
        // Nota: Por seguridad contable no actualizamos el RIF, solo los datos de contacto.
        const { nombre, telefono1, telefono2, direccion, estado_venezuela, rubro } = req.body;
        try {
            await pool.query(
                'UPDATE proveedores SET nombre=$1, telefono1=$2, telefono2=$3, direccion=$4, estado_venezuela=$5, rubro=$6 WHERE id=$7',
                [nombre, telefono1, telefono2, direccion, estado_venezuela, rubro || null, req.params.id]
            );
            res.json({ status: 'success', message: 'Proveedor actualizado correctamente.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 💡 3. ELIMINAR PROVEEDOR (BORRADO LÓGICO)
    app.delete('/proveedores/:id', verifyToken, async (req, res) => {
        try {
            await pool.query('UPDATE proveedores SET activo = false WHERE id = $1', [req.params.id]);
            res.json({ status: 'success', message: 'Proveedor eliminado del directorio.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 💡 4. LISTAR PROVEEDORES (Solo los activos)
    app.get('/proveedores', verifyToken, async (req, res) => {
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            // Filtramos por su condominio y que estén activos
            const r = await pool.query('SELECT * FROM proveedores WHERE condominio_id = $1 AND activo = true ORDER BY nombre ASC', [condoId]);
            res.json({ status: 'success', proveedores: r.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

module.exports = { registerProveedoresRoutes };