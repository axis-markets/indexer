const Trade = require('../../src/entries/trade')
const {formatDateUTC} = require('../../src/utils/date')

function makeTrade(overrides = {}) {
    const t = new Trade()
    t.id = overrides.id ?? 1n
    t.order = overrides.order ?? 10n
    t.taker = overrides.taker ?? 'TAKER'
    t.maker = overrides.maker ?? 'MAKER'
    t.soldAsset = overrides.soldAsset ?? 'S'
    t.boughtAsset = overrides.boughtAsset ?? 'B'
    t.sold = overrides.sold ?? 100n
    t.bought = overrides.bought ?? 200n
    t.left = overrides.left ?? 0n
    t.cursor = overrides.cursor ?? '1-0000'
    t.ts = overrides.ts ?? 1_700_000_000
    return t
}

describe('Trade.toJSON', () => {
    test('serializes BigInt fields as strings and includes approximate price', () => {
        const trade = makeTrade({id: 7n, order: 99n, sold: 100n, bought: 250n, left: 5n})
        const json = trade.toJSON()
        expect(json).toMatchObject({
            type: 'trade',
            id: '7',
            order: '99',
            taker: 'TAKER',
            maker: 'MAKER',
            soldAsset: 'S',
            boughtAsset: 'B',
            sold: '100',
            bought: '250',
            left: '5',
            price: 2.5,
            cursor: '7'
        })
    })

    test('produces a valid ISO timestamp from the trade ts', () => {
        const trade = makeTrade({ts: 1_700_000_000})
        expect(trade.toJSON().timestamp).toBe(formatDateUTC(new Date(1_700_000_000_000)))
    })

    test('JSON.stringify uses toJSON automatically', () => {
        const trade = makeTrade({id: 3n})
        const parsed = JSON.parse(JSON.stringify(trade))
        expect(parsed.id).toBe('3')
        expect(parsed.type).toBe('trade')
    })
})

describe('Trade.fromEvent', () => {
    test('copies the event fields and uses the event position as id', () => {
        const trade = Trade.fromEvent({
            id: 6000n, position: 6000n, ledger: 12, order: 10n, taker: 'TK', maker: 'MK',
            soldAsset: 'SOLD', boughtAsset: 'BOUGHT',
            sold: 100n, bought: 250n, left: 7n, cursor: '1-0002', ts: 1_700_000_000
        })
        expect(trade).toBeInstanceOf(Trade)
        expect(trade.type).toBe('trade')
        expect(trade.id).toBe(6000n)
        expect(trade.ledger).toBe(12)
        expect(trade.left).toBe(7n)
        //asset orientation comes from the payload (taker sold/bought), never reversed
        expect(trade.soldAsset).toBe('SOLD')
        expect(trade.boughtAsset).toBe('BOUGHT')
        //price is bought/sold-oriented; an asset/amount swap would invert it
        expect(trade.toJSON().price).toBe(2.5)
    })

    test('falls back to the position when the event carries no id', () => {
        const trade = Trade.fromEvent({position: 42n, order: 1n, taker: 'T', maker: 'M', soldAsset: 'S', boughtAsset: 'B', sold: 1n, bought: 1n, left: 0n, cursor: 'c', ts: 1})
        expect(trade.id).toBe(42n)
    })
})
