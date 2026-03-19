"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const addMonths = (yyyy_mm, m) => {
    let [year, month] = yyyy_mm.split('-').map(Number);
    month += m;
    while (month > 12) {
        month -= 12;
        year += 1;
    }
    return `${year}-${month.toString().padStart(2, '0')}`;
};
const formatMonthText = (YYYYMM) => {
    if (!YYYYMM)
        return '';
    const [year, month] = YYYYMM.split('-');
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${months[parseInt(month, 10) - 1]} ${year}`;
};
module.exports = { addMonths, formatMonthText };
//# sourceMappingURL=calendar.js.map