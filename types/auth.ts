export interface AuthenticatedUser {
    id: number;
    cedula: string;
    nombre: string;
    condominio_id?: number;
    is_admin?: boolean;
    role?: 'Administrador' | 'Propietario' | 'SuperUsuario';
    is_superuser?: boolean;
    is_support_session?: boolean;
    support_superuser_id?: number;
    support_superuser_nombre?: string;
    support_condominio_id?: number;
    session_jti?: string;
    iat?: number;
    exp?: number;
}
