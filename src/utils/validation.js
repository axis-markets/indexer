const {StrKey} = require('@stellar/stellar-base')
const stdErrors = require('../server/errors')

/**
 * Normalize page size based on default and max value
 * @param {number|string} limit
 * @param {number} [defaultValue]
 * @param {number} [max]
 * @return {number}
 */
function normalizeLimit(limit, defaultValue = 10, max = 100) {
    limit = parseInt(limit, 10)
    if (isNaN(limit) || limit <= 0) {
        limit = defaultValue
    }
    if (limit > max) {
        limit = max
    }
    return limit
}

/**
 * Check if the value is a possible valid DEX trading actor
 * @param {string} actor
 * @return {boolean}
 */
function isValidActor(actor) {
    if (typeof actor !== 'string' || actor.length !== 56)
        return false
    return StrKey.isValidEd25519PublicKey(actor)
        || StrKey.isValidContract(actor)
        || StrKey.isValidMed25519PublicKey(actor)
}

/**
 * Parse cursor ID from request
 * @param {string|bigint} cursor
 * @return {bigint}
 */
function parseIdCursor(cursor) {
    try {
        const id = BigInt(cursor)
        if (id <= 0n)
            throw new Error('Invalid ID')
        return id
    } catch (e) {
        throw stdErrors.validationError('cursor')
    }
}

module.exports = {normalizeLimit, isValidActor, parseIdCursor}