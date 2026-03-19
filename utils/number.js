"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const parseLocaleNumber = (value, fallback = 0) => {
    if (value === null || value === undefined || value === '')
        return fallback;
    const raw = value.toString().trim().replace(/\s+/g, '');
    if (!raw)
        return fallback;
    const hasComma = raw.includes(',');
    const hasDot = raw.includes('.');
    let normalized = raw;
    if (hasComma && hasDot) {
        const lastComma = raw.lastIndexOf(',');
        const lastDot = raw.lastIndexOf('.');
        if (lastComma > lastDot) {
            // Formato tipo 1.234,56
            normalized = raw.replace(/\./g, '').replace(',', '.');
        }
        else {
            // Formato tipo 1,234.56
            normalized = raw.replace(/,/g, '');
        }
    }
    else if (hasComma) {
        // Formato tipo 1234,56
        normalized = raw.replace(',', '.');
    }
    else {
        // Formato tipo 1234.56 o entero
        normalized = raw;
    }
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
};
module.exports = { parseLocaleNumber };
//# sourceMappingURL=number.js.map