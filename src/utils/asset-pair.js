const {Address} = require('@stellar/stellar-sdk')

/**
 * Serialized `ScAddress` by address string (assets are few, the cache is capped anyway)
 * @type {Map<string, Buffer|null>}
 */
const keyCache = new Map()
const maxCachedKeys = 10_000

/**
 * @param {string} address
 * @return {Buffer|null} - XDR-encoded ScAddress, null for a string that is not a Stellar address
 */
function addressKey(address) {
    let key = keyCache.get(address)
    if (key !== undefined)
        return key
    try {
        key = Address.fromString(address).toScAddress().toXDR()
    } catch (e) {
        key = null
    }
    if (keyCache.size >= maxCachedKeys) {
        keyCache.clear()
    }
    keyCache.set(address, key)
    return key
}

/**
 * Compare two assets in the contract canonical order: the order of `Address` values in Soroban (address type first,
 * then the 32 key/hash bytes), which is the order of their XDR-encoded `ScAddress`. Strings that are not Stellar
 * addresses fall back to plain string comparison.
 * @param {string} x
 * @param {string} y
 * @return {number} - Negative if `x` goes first, positive if `y` goes first, 0 if equal
 */
function compareAssets(x, y) {
    if (x === y)
        return 0
    const kx = addressKey(x)
    const ky = addressKey(y)
    if (kx && ky)
        return Buffer.compare(kx, ky)
    return x < y ? -1 : 1
}

/**
 * Order an asset pair canonically, as the contract stores markets: `a` goes first
 * @param {string} x
 * @param {string} y
 * @return {[string, string]} - `[a, b]`
 */
function canonicalPair(x, y) {
    return compareAssets(x, y) <= 0 ? [x, y] : [y, x]
}

/**
 * Get standard asset pair representation `a/b` (contract canonical order; `a` is the base, `b` the quote)
 * @param {string} asset1
 * @param {string} asset2
 * @return {string}
 */
function toPair(asset1, asset2) {
    const [a, b] = canonicalPair(asset1, asset2)
    return `${a}/${b}`
}

module.exports = {toPair, canonicalPair, compareAssets}
