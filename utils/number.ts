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
    // Ej: "471.700" -> ¿es 471,70 (punto decimal) o 471700 (punto de miles)?
    // Heurística: si la parte entera (antes del punto) tiene <= 3 dígitos,
    // y la parte decimal tiene 1-3 dígitos, asumir punto decimal.
    if (hasDot && !hasComma) {
        const parts = raw.split('.');
        if (parts.length === 2) {
            const integerPart = parts[0].replace(/^-/, ''); // remover signo negativo si existe
            const decimalPart = parts[1];
            
            // Si la parte entera tiene 3 o menos dígitos y la decimal tiene 1-3 dígitos,
            // es probable que sea formato decimal (ej: 471.700 = 471,700)
            if (integerPart.length <= 3 && decimalPart.length >= 1 && decimalPart.length <= 3) {
                // Mantener el punto como separador decimal
                normalized = raw;
            } else {
                // Asumir punto de miles (ej: 1.234.567)
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
