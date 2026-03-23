import type { Application, NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

const dotenv: typeof import('dotenv') = require('dotenv');
const express: typeof import('express') = require('express');
const cors: typeof import('cors') = require('cors');
const fs: typeof import('fs') = require('fs');
const path: typeof import('path') = require('path');

dotenv.config();

interface PagosOptionalColumns {
    nota: boolean;
    cedula_origen: boolean;
    banco_origen: boolean;
    telefono_origen: boolean;
}

type VerifyTokenMiddleware = (req: Request, res: Response, next: NextFunction) => unknown;
type ParseLocaleNumber = (value: unknown, fallback?: number) => number;
type AddMonths = (yyyyMm: string, monthsToAdd: number) => string;
type FormatMonthText = (yyyyMm: string) => string;
type GetPagosOptionalColumns = () => Promise<PagosOptionalColumns>;

interface RootRoutesRegistrar {
    (app: Application): void;
}

interface AuthRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

interface GastosRoutesRegistrar {
    (
        app: Application,
        deps: {
            pool: Pool;
            verifyToken: VerifyTokenMiddleware;
            parseLocaleNumber: ParseLocaleNumber;
            addMonths: AddMonths;
            formatMonthText: FormatMonthText;
        },
    ): void;
}

interface ProveedoresRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

interface PropiedadesRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

interface BancosRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

interface ZonasRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

interface EncuestasRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

interface RecibosRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

interface FondosRoutesRegistrar {
    (
        app: Application,
        deps: { pool: Pool; verifyToken: VerifyTokenMiddleware; parseLocaleNumber: ParseLocaleNumber },
    ): void;
}

interface PagosRoutesRegistrar {
    (
        app: Application,
        deps: {
            pool: Pool;
            verifyToken: VerifyTokenMiddleware;
            parseLocaleNumber: ParseLocaleNumber;
            getPagosOptionalColumns: GetPagosOptionalColumns;
        },
    ): void;
}

interface DashboardRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

interface ChatRoutesRegistrar {
    (app: Application, deps: { pool: Pool; verifyToken: VerifyTokenMiddleware }): void;
}

const { pool }: { pool: Pool } = require('./config/db');
const { verifyToken }: { verifyToken: VerifyTokenMiddleware } = require('./middleware/verifyToken');
const { parseLocaleNumber }: { parseLocaleNumber: ParseLocaleNumber } = require('./utils/number');
const { addMonths, formatMonthText }: { addMonths: AddMonths; formatMonthText: FormatMonthText } = require('./utils/calendar');
const { createGetPagosOptionalColumns }: { createGetPagosOptionalColumns: (pool: Pool) => GetPagosOptionalColumns } = require('./services/pagosColumns');

const { registerRootRoutes }: { registerRootRoutes: RootRoutesRegistrar } = require('./routes/root');
const { registerAuthRoutes }: { registerAuthRoutes: AuthRoutesRegistrar } = require('./routes/auth');
const { registerGastosRoutes }: { registerGastosRoutes: GastosRoutesRegistrar } = require('./routes/gastos');
const { registerProveedoresRoutes }: { registerProveedoresRoutes: ProveedoresRoutesRegistrar } = require('./routes/proveedores');
const { registerPropiedadesRoutes }: { registerPropiedadesRoutes: PropiedadesRoutesRegistrar } = require('./routes/propiedades');
const { registerBancosRoutes }: { registerBancosRoutes: BancosRoutesRegistrar } = require('./routes/bancos');
const { registerZonasRoutes }: { registerZonasRoutes: ZonasRoutesRegistrar } = require('./routes/zonas');
const { registerRecibosRoutes }: { registerRecibosRoutes: RecibosRoutesRegistrar } = require('./routes/recibos');
const { registerFondosRoutes }: { registerFondosRoutes: FondosRoutesRegistrar } = require('./routes/fondos');
const { registerPagosRoutes }: { registerPagosRoutes: PagosRoutesRegistrar } = require('./routes/pagos');
const { registerDashboardRoutes }: { registerDashboardRoutes: DashboardRoutesRegistrar } = require('./routes/dashboard');
const { registerEncuestasRoutes }: { registerEncuestasRoutes: EncuestasRoutesRegistrar } = require('./routes/encuestas');
const { registerChatRoutes }: { registerChatRoutes: ChatRoutesRegistrar } = require('./routes/chat');
const perfilRoutes: import('express').Router = require('./routes/perfil');
const propietarioRoutes: import('express').Router = require('./routes/propietario');

const app: Application = express();
const PORT: number = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

const uploadsDir: string = path.join(__dirname, 'uploads', 'gastos');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const getPagosOptionalColumns: GetPagosOptionalColumns = createGetPagosOptionalColumns(pool);

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
registerEncuestasRoutes(app, { pool, verifyToken });
registerChatRoutes(app, { pool, verifyToken });
app.use('/api/perfil', perfilRoutes);
app.use('/api/propietario', propietarioRoutes);

app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
