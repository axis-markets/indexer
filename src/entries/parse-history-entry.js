const Trade = require('./trade')
const Swap = require('./swap')

/**
 * Reconstruct a persisted history record into its typed entry (Trade or Swap).
 * Swaps and trades share one log; they are told apart by shape — a swap has a
 * single `trader` and no `maker`, so a record without a `maker` is a Swap.
 * @param {{maker?: string}} record - Persisted history record
 * @return {Trade|Swap}
 */
function parseHistoryEntry(record) {
    return record.maker === undefined ? Swap.fromEvent(record) : Trade.fromEvent(record)
}

module.exports = parseHistoryEntry
