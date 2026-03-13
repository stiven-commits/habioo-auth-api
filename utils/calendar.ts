const addMonths = (yyyy_mm: string, m: number): string => {
    let [year, month] = yyyy_mm.split('-').map(Number);
    month += m;
    while (month > 12) {
        month -= 12;
        year += 1;
    }
    return `${year}-${month.toString().padStart(2, '0')}`;
};

const formatMonthText = (YYYYMM: string | undefined | null): string => {
    if (!YYYYMM) return '';
    const [year, month] = YYYYMM.split('-');
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${months[parseInt(month, 10) - 1]} ${year}`;
};

module.exports = { addMonths, formatMonthText };
