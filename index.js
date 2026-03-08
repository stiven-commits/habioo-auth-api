require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const { pool } = require('./config/db');
const { verifyToken } = require('./middleware/verifyToken');
const { parseLocaleNumber } = require('./utils/number');
const { addMonths, formatMonthText } = require('./utils/calendar');
const { createGetPagosOptionalColumns } = require('./services/pagosColumns');

const { registerRootRoutes } = require('./routes/root');
const { registerAuthRoutes } = require('./routes/auth');
const { registerGastosRoutes } = require('./routes/gastos');
const { registerProveedoresRoutes } = require('./routes/proveedores');
const { registerPropiedadesRoutes } = require('./routes/propiedades');
const { registerBancosRoutes } = require('./routes/bancos');
const { registerZonasRoutes } = require('./routes/zonas');
const { registerRecibosRoutes } = require('./routes/recibos');
const { registerFondosRoutes } = require('./routes/fondos');
const { registerPagosRoutes } = require('./routes/pagos');
const { registerDashboardRoutes } = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads', 'gastos');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const getPagosOptionalColumns = createGetPagosOptionalColumns(pool);

registerRootRoutes(app);
registerAuthRoutes(app, { pool, verifyToken });
registerGastosRoutes(app, { pool, verifyToken, parseLocaleNumber, addMonths, formatMonthText });
registerProveedoresRoutes(app, { pool, verifyToken });
registerPropiedadesRoutes(app, { pool, verifyToken });
registerBancosRoutes(app, { pool, verifyToken });
registerZonasRoutes(app, { pool, verifyToken });
registerRecibosRoutes(app, { pool, verifyToken });
registerFondosRoutes(app, { pool, verifyToken, parseLocaleNumber });
registerPagosRoutes(app, { pool, verifyToken, parseLocaleNumber, getPagosOptionalColumns });
registerDashboardRoutes(app, { pool, verifyToken });

app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));

