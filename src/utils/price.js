const PRECISION = 10n ** 19n
const N_PRECISION = Number(PRECISION)

/**
 * @param {bigint} price
 * @return {number}
 */
function toRationalPrice(price) {
    return Number(price) / N_PRECISION
}

/**
 * @param {bigint} n
 * @param {bigint} d
 * @return {number}
 */
function approximatePrice(n, d) {
    return Number(n) / Number(d)
}

module.exports = {toRationalPrice, approximatePrice}