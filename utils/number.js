const parseLocaleNumber = (value, fallback = 0) => {
    if (value === null || value === undefined || value === '') return fallback;
    const normalized = value.toString().replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = { parseLocaleNumber };

