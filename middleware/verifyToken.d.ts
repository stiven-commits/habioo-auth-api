interface AuthUserPayload {
    id: number;
    cedula: string;
    nombre: string;
    condominio_id?: number;
    is_admin?: boolean;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthUserPayload;
        }
    }
}
export {};
//# sourceMappingURL=verifyToken.d.ts.map