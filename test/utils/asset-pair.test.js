const {toPair} = require('../../src/utils/asset-pair')

describe('toPair', () => {
    test('orders lexicographically larger asset first', () => {
        expect(toPair('A', 'B')).toBe('B/A')
        expect(toPair('B', 'A')).toBe('B/A')
    })

    test('is stable regardless of argument order', () => {
        const a = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
        const b = 'CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'
        expect(toPair(a, b)).toBe(toPair(b, a))
    })

    test('handles equal assets by returning the duplicated form', () => {
        expect(toPair('X', 'X')).toBe('X/X')
    })
})
