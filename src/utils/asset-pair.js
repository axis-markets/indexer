/**
 * Get standard asset pair representation
 * @param {string} asset1
 * @param {string} asset2
 * @return {string}
 */
function toPair(asset1, asset2) {
    if (asset1 > asset2)
        return `${asset1}/${asset2}`
    return `${asset2}/${asset1}`
}

module.exports = {toPair}