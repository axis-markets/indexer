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
    t.cursor = overrides.cursor ?? String(t.id)
    t.ts = overrides.ts ?? 1_700_000_000
    return t
}

describe('Trade.toJSON', () => {
    test('serializes BigInt fields as strings and includes approximate price', () => {
        const trade = makeTrade({id: 7n, order: 99n, sold: 100n, bought: 250n})
        const json = trade.toJSON()
        expect(json).toMatchObject({
            id: '7',
            order: '99',
            taker: 'TAKER',
            maker: 'MAKER',
            soldAsset: 'S',
            boughtAsset: 'B',
            sold: '100',
            bought: '250',
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
    })
})
