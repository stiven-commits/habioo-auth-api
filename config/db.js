"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Pool } = require('pg');
process.env.TZ = 'America/Caracas';
process.env.PGTZ = 'America/Caracas';
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});
module.exports = { pool };
//# sourceMappingURL=db.js.map