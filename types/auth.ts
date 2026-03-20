export interface AuthenticatedUser {
    id: number;
    cedula: string;
    nombre: string;
    condominio_id?: number;
    is_admin?: boolean;
    iat?: number;
    exp?: number;
}

