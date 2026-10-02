const Trade = require('./trade')
const Swap = require('./swap')

/**
 * Reconstruct a persisted history record into its typed entry (Trade or Swap).
 * Swaps and trades share one log; they are told apart by the persisted `type` field.
 * @param {{type: 'trade'|'swap'}} record - Persisted history record
 * @return {Trade|Swap}
 */
function parseHistoryEntry(record) {
    switch (record.type) {
        case 'swap':
            return Swap.fromEvent(record)
        case 'trade':
            return Trade.fromEvent(record)
        default:
            throw new Error('Unknown history record type: ' + record.type)
    }
}

module.exports = parseHistoryEntry
