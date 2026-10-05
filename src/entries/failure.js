const {formatDateUTC} = require('../utils/date')

/**
 * Failed AXIS call: the transaction failed, or a calling contract caught the failure (`caught`). A failed call changes
 * no state, so the record only describes what failed: it never blames a party. A token error on a settlement transfer is ambiguous by design (the payer could not
 * pay, or the recipient could not be credited), and in a `crossfill` the payer is the taker order owner, not the caller
 */
class Failure {
    /**
     * Record type discriminator
     * @type {'failure'}
     * @readonly
     */
    type = 'failure'
    /**
     * Unique id (position of the transaction derived from its ledger and application order, plus the index of the
     * failed call within it)
     * @type {bigint}
     */
    id
    /**
     * Transaction hash
     * @type {string}
     */
    txHash
    /**
     * Ledger sequence
     * @type {number}
     */
    ledger
    /**
     * Ledger close time, UNIX seconds
     * @type {number}
     */
    ts
    /**
     * Contract function called
     * @type {string}
     */
    fn
    /**
     * Address authorizing the call (`trader` or `sponsor` argument), the transaction source otherwise
     * @type {string}
     */
    caller
    /**
     * Maker order ids listed by the call
     * @type {bigint[]}
     */
    orders = []
    /**
     * Taker order id of a `crossfill`
     * @type {bigint|undefined}
     */
    takerOrder
    /**
     * Operation (or transaction) result code
     * @type {string}
     */
    result
    /**
     * The transaction succeeded: a calling contract caught the failed call
     * @type {boolean}
     */
    caught = false
    /**
     * Failure kind: `contract` (AXIS error), `transfer` (a token transfer failed), `resources`, `auth` or `unknown`
     * @type {'contract'|'transfer'|'resources'|'auth'|'unknown'}
     */
    reason
    /**
     * Contract error that failed the call
     * @type {{contract: string, code: number, name?: string}|undefined}
     */
    error
    /**
     * Token transfer that failed, when diagnostic events show it
     * @type {{token: string, fn: string, from: string, to: string, amount: bigint}|undefined}
     */
    transfer

    /**
     * Whether the account called the contract or is a party of the failed transfer
     * @param {string} account
     * @return {boolean}
     */
    involves(account) {
        return this.caller === account || this.transfer?.from === account || this.transfer?.to === account
    }

    toJSON() {
        const res = {
            type: 'failure',
            id: this.id.toString(),
            txHash: this.txHash,
            ledger: this.ledger,
            timestamp: formatDateUTC(this.ts),
            fn: this.fn,
            caller: this.caller,
            orders: this.orders.map(id => id.toString()),
            result: this.result,
            reason: this.reason,
            cursor: this.id.toString()
        }
        if (this.caught) {
            res.caught = true
        }
        if (this.takerOrder !== undefined) {
            res.takerOrder = this.takerOrder.toString()
        }
        if (this.error) {
            res.error = {...this.error}
        }
        if (this.transfer) {
            res.transfer = {...this.transfer, amount: this.transfer.amount.toString()}
        }
        return res
    }

    /**
     * @param {FailureEvent} failureEvent - Event reported by a data source, or a persisted record
     * @return {Failure}
     */
    static fromEvent(failureEvent) {
        const failure = new Failure()
        failure.id = BigInt(failureEvent.id ?? failureEvent.position)
        failure.txHash = failureEvent.txHash
        failure.ledger = failureEvent.ledger
        failure.ts = failureEvent.ts
        failure.fn = failureEvent.fn
        failure.caller = failureEvent.caller
        failure.orders = (failureEvent.orders || []).map(id => BigInt(id))
        if (failureEvent.takerOrder !== undefined && failureEvent.takerOrder !== null) {
            failure.takerOrder = BigInt(failureEvent.takerOrder)
        }
        failure.result = failureEvent.result
        failure.caught = failureEvent.caught === true
        failure.reason = failureEvent.reason || 'unknown'
        if (failureEvent.error) {
            failure.error = {...failureEvent.error}
        }
        if (failureEvent.transfer) {
            failure.transfer = {...failureEvent.transfer, amount: BigInt(failureEvent.transfer.amount)}
        }
        return failure
    }
}

module.exports = Failure
