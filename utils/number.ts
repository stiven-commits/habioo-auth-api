const parseLocaleNumber = (value: unknown, fallback = 0): number => {
    if (value === null || value === undefined || value === '') return fallback;
    const normalized = value.toString().replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = { parseLocaleNumber };
