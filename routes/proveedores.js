const registerProveedoresRoutes = (app, { pool, verifyToken }) => {
    
    // 1. CREAR O REACTIVAR PROVEEDOR INDIVIDUAL
    app.post('/proveedores', verifyToken, async (req, res) => {
        const { identificador, nombre, telefono1, telefono2, direccion, estado_venezuela, rubro } = req.body;
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            const exist = await pool.query('SELECT id, activo FROM proveedores WHERE identificador = $1 AND condominio_id = $2', [identificador, condoId]);

            if (exist.rows.length > 0) {
                if (exist.rows[0].activo) return res.status(400).json({ error: 'Ya existe un proveedor activo registrado con este RIF.' });
                else {
                    await pool.query(
                        'UPDATE proveedores SET nombre=$1, telefono1=$2, telefono2=$3, direccion=$4, estado_venezuela=$5, rubro=$6, activo=true WHERE id=$7',
                        [nombre, telefono1, telefono2, direccion, estado_venezuela, rubro || null, exist.rows[0].id]
                    );
                    return res.json({ status: 'success', message: 'El proveedor estaba oculto, ha sido reactivado y actualizado.' });
                }
            }

            await pool.query(
                'INSERT INTO proveedores (condominio_id, identificador, nombre, telefono1, telefono2, direccion, estado_venezuela, rubro) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [condoId, identificador, nombre, telefono1, telefono2, direccion, estado_venezuela, rubro || null]
            );
            res.json({ status: 'success', message: 'Proveedor registrado exitosamente.' });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // 💡 2. NUEVA RUTA: CARGA MASIVA DE PROVEEDORES POR LOTE (EXCEL)
    app.post('/proveedores/lote', verifyToken, async (req, res) => {
        const { proveedores } = req.body; 
        
        if (!proveedores || !Array.isArray(proveedores) || proveedores.length === 0) {
            return res.status(400).json({ error: 'No se enviaron datos válidos.' });
        }

        try {
            await pool.query('BEGIN');
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const condoId = c.rows[0].id;

            for (const item of proveedores) {
                let rifFmt = (item.identificador || '').toUpperCase().replace(/[^VEJPG0-9]/g, '');
                
                const exist = await pool.query('SELECT id, activo FROM proveedores WHERE identificador = $1 AND condominio_id = $2', [rifFmt, condoId]);

                if (exist.rows.length > 0) {
                    if (exist.rows[0].activo) {
                        // Si un RIF ya existe y está activo, rompemos la transacción completa
                        throw new Error(`El proveedor con RIF ${rifFmt} ya está registrado y activo en el directorio.`);
                    } else {
                        // Si estaba eliminado, lo reactivamos
                        await pool.query(
                            'UPDATE proveedores SET nombre=$1, telefono1=$2, telefono2=$3, direccion=$4, estado_venezuela=$5, rubro=$6, activo=true WHERE id=$7',
                            [item.nombre, item.telefono1, item.telefono2 || null, item.direccion, item.estado_venezuela, item.rubro || null, exist.rows[0].id]
                        );
                    }
                } else {
                    // Si no existe, lo insertamos
                    await pool.query(
                        'INSERT INTO proveedores (condominio_id, identificador, nombre, telefono1, telefono2, direccion, estado_venezuela, rubro) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                        [condoId, rifFmt, item.nombre, item.telefono1, item.telefono2 || null, item.direccion, item.estado_venezuela, item.rubro || null]
                    );
                }
            }

            await pool.query('COMMIT');
            res.json({ status: 'success', message: `${proveedores.length} proveedores cargados correctamente.` });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(400).json({ error: err.message });
        }
    });

    // 3. EDITAR PROVEEDOR EXISTENTE
    app.put('/proveedores/:id', verifyToken, async (req, res) => {
        const { nombre, telefono1, telefono2, direccion, estado_venezuela, rubro } = req.body;
        try {
            await pool.query(
                'UPDATE proveedores SET nombre=$1, telefono1=$2, telefono2=$3, direccion=$4, estado_venezuela=$5, rubro=$6 WHERE id=$7',
                [nombre, telefono1, telefono2, direccion, estado_venezuela, rubro || null, req.params.id]
            );
            res.json({ status: 'success', message: 'Proveedor actualizado correctamente.' });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // 4. ELIMINAR PROVEEDOR (BORRADO LÓGICO)
    app.delete('/proveedores/:id', verifyToken, async (req, res) => {
        try {
            await pool.query('UPDATE proveedores SET activo = false WHERE id = $1', [req.params.id]);
            res.json({ status: 'success', message: 'Proveedor eliminado del directorio.' });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // 5. LISTAR PROVEEDORES
    app.get('/proveedores', verifyToken, async (req, res) => {
        try {
            const c = await pool.query('SELECT id FROM condominios WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
            const r = await pool.query('SELECT * FROM proveedores WHERE condominio_id = $1 AND activo = true ORDER BY nombre ASC', [c.rows[0].id]);
            res.json({ status: 'success', proveedores: r.rows });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
};

module.exports = { registerProveedoresRoutes };