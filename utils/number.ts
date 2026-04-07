const parseLocaleNumber = (value: unknown, fallback = 0): number => {
    if (value === null || value === undefined || value === '') return fallback;
    
    // Si es un número nativo (de XLSX/Excel), usarlo directamente
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    
    const raw = value.toString().trim().replace(/\s+/g, '');
    if (!raw) return fallback;

    const hasComma = raw.includes(',');
    const hasDot = raw.includes('.');
    let normalized = raw;

    // Caso: solo punto (sin coma)
    // Ej: "471.700" -> ¿es 471.70 (punto decimal) o 471700 (punto de miles)?
    // Heurística: los grupos de miles siempre tienen exactamente 3 dígitos.
    // Si la parte decimal tiene 1 o 2 dígitos, SIEMPRE es separador decimal (ej: 66488.80).
    // Si la parte decimal tiene 3 dígitos y la entera > 3 dígitos, asumir punto de miles.
    if (hasDot && !hasComma) {
        const parts = raw.split('.');
        if (parts.length === 2) {
            const integerPart = parts[0].replace(/^-/, ''); // remover signo negativo si existe
            const decimalPart = parts[1];

            // 1 o 2 dígitos decimales → siempre separador decimal (miles nunca tienen < 3 dígitos)
            // 3 dígitos decimales con parte entera <= 3 → asumir decimal (ej: 1.234)
            // 3 dígitos decimales con parte entera > 3 → asumir miles (ej: 66.488 → 66488)
            if (decimalPart.length <= 2 || integerPart.length <= 3) {
                // Mantener el punto como separador decimal
                normalized = raw;
            } else {
                // Asumir punto de miles
                normalized = raw.replace(/\./g, '');
            }
        } else {
            // Múltiples puntos: son de miles
            normalized = raw.replace(/\./g, '');
        }
    } else if (hasComma && hasDot) {
        const lastComma = raw.lastIndexOf(',');
        const lastDot = raw.lastIndexOf('.');
        if (lastComma > lastDot) {
            // Formato tipo 1.234,56 (europeo/latino)
            normalized = raw.replace(/\./g, '').replace(',', '.');
        } else {
            // Formato tipo 1,234.56 (inglés)
            normalized = raw.replace(/,/g, '');
        }
    } else if (hasComma) {
        // Formato tipo 1234,56 (solo coma como decimal)
        normalized = raw.replace(',', '.');
    } else {
        // Formato tipo 1234.56 o entero
        // Si hay múltiples puntos, son de miles
        const dotCount = (raw.match(/\./g) || []).length;
        if (dotCount > 1) {
            normalized = raw.replace(/\./g, '');
        } else {
            normalized = raw;
        }
    }

    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = { parseLocaleNumber };
