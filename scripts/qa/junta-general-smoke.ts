type HttpMethod = 'GET' | 'POST';

type StepDefinition = {
    name: string;
    method: HttpMethod;
    path: string;
    expectedStatus: number;
    buildBody?: () => unknown;
};

type StepResult = {
    name: string;
    method: HttpMethod;
    path: string;
    expectedStatus: number;
    status: number;
    ok: boolean;
    responsePreview: string;
};

const baseUrl = (process.env.QA_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const loginCedula = (process.env.QA_JG_USER || '').trim();
const loginPassword = process.env.QA_JG_PASSWORD || '';

const requiredEnvMissing = !loginCedula || !loginPassword;
if (requiredEnvMissing) {
    console.error('Faltan variables de entorno obligatorias: QA_JG_USER y QA_JG_PASSWORD.');
    console.error('Ejemplo PowerShell:');
    console.error("$env:QA_BASE_URL='http://localhost:3001'; $env:QA_JG_USER='J987564321'; $env:QA_JG_PASSWORD='tu-clave'; npm run qa:junta-general");
    process.exit(1);
}

const headersBase: Record<string, string> = {
    'Content-Type': 'application/json',
};

const preview = (payload: unknown): string => {
    try {
        const text = JSON.stringify(payload);
        if (!text) return '(sin cuerpo)';
        return text.length > 220 ? `${text.slice(0, 220)}...` : text;
    } catch (_error) {
        return '(cuerpo no serializable)';
    }
};

const requestJson = async (
    method: HttpMethod,
    path: string,
    token?: string,
    body?: unknown
): Promise<{ status: number; data: unknown }> => {
    const headers: Record<string, string> = { ...headersBase };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    let data: unknown = null;
    try {
        data = await res.json();
    } catch (_error) {
        data = null;
    }

    return { status: res.status, data };
};

const resolveCondominioId = (mePayload: unknown): number => {
    if (!mePayload || typeof mePayload !== 'object') return 0;
    const session = (mePayload as { session?: unknown }).session;
    if (!session || typeof session !== 'object') return 0;
    const condominioId = (session as { condominio_id?: unknown }).condominio_id;
    return Number.isFinite(Number(condominioId)) ? Number(condominioId) : 0;
};

const createSteps = (condominioId: number): StepDefinition[] => {
    const encuestasPath = condominioId > 0 ? `/encuestas/${condominioId}` : '/encuestas/0';
    return [
        { name: 'Me', method: 'GET', path: '/me', expectedStatus: 200 },
        { name: 'Resumen Junta General', method: 'GET', path: '/juntas-generales/resumen', expectedStatus: 200 },
        { name: 'Miembros Junta General', method: 'GET', path: '/juntas-generales/miembros?include_inactivos=true', expectedStatus: 200 },
        { name: 'Conciliacion Junta General', method: 'GET', path: '/juntas-generales/conciliacion', expectedStatus: 200 },
        { name: 'Recibos Historial (bloqueado)', method: 'GET', path: '/recibos-historial', expectedStatus: 403 },
        { name: 'Alquileres', method: 'GET', path: '/alquileres', expectedStatus: 200 },
        { name: 'Reservaciones (bloqueado)', method: 'GET', path: '/alquileres/reservaciones', expectedStatus: 403 },
        { name: 'Cartas Consulta', method: 'GET', path: encuestasPath, expectedStatus: 200 },
    ];
};

const printResults = (results: StepResult[]): void => {
    console.log('\n== Smoke QA Junta General ==');
    for (const result of results) {
        const flag = result.ok ? 'PASS' : 'FAIL';
        console.log(
            `[${flag}] ${result.name} | ${result.method} ${result.path} | esperado=${result.expectedStatus} recibido=${result.status}`
        );
        if (!result.ok) {
            console.log(`       respuesta: ${result.responsePreview}`);
        }
    }
};

const run = async (): Promise<void> => {
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Usuario Junta General: ${loginCedula}`);

    const login = await requestJson('POST', '/login', undefined, {
        cedula: loginCedula,
        password: loginPassword,
    });

    if (login.status !== 200) {
        console.error(`[FAIL] Login | esperado=200 recibido=${login.status}`);
        console.error(`       respuesta: ${preview(login.data)}`);
        process.exit(1);
    }

    const loginPayload = login.data as { token?: string };
    const token = typeof loginPayload?.token === 'string' ? loginPayload.token : '';
    if (!token) {
        console.error('[FAIL] Login exitoso sin token.');
        process.exit(1);
    }

    const me = await requestJson('GET', '/me', token);
    if (me.status !== 200) {
        console.error(`[FAIL] GET /me | esperado=200 recibido=${me.status}`);
        console.error(`       respuesta: ${preview(me.data)}`);
        process.exit(1);
    }

    const condominioId = resolveCondominioId(me.data);
    if (!condominioId) {
        console.error('[FAIL] No se pudo resolver condominio_id desde /me.');
        console.error(`       respuesta: ${preview(me.data)}`);
        process.exit(1);
    }

    const steps = createSteps(condominioId);
    const results: StepResult[] = [];
    let failures = 0;

    for (const step of steps) {
        const body = step.buildBody ? step.buildBody() : undefined;
        const response = await requestJson(step.method, step.path, token, body);
        const ok = response.status === step.expectedStatus;
        if (!ok) failures += 1;

        results.push({
            name: step.name,
            method: step.method,
            path: step.path,
            expectedStatus: step.expectedStatus,
            status: response.status,
            ok,
            responsePreview: preview(response.data),
        });
    }

    printResults(results);

    if (failures > 0) {
        console.error(`\nResultado: ${failures} verificacion(es) fallaron.`);
        process.exit(1);
    }

    console.log('\nResultado: OK, smoke QA de Junta General completado.');
};

run().catch((error: unknown) => {
    console.error('[FAIL] Error no controlado en QA smoke runner.');
    console.error(error);
    process.exit(1);
});
