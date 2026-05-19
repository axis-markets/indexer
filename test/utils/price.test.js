const {toRationalPrice, approximatePrice} = require('../../src/utils/price')

const PRECISION = 10n ** 18n

describe('toRationalPrice', () => {
    test('returns 1 for the precision constant', () => {
        expect(toRationalPrice(PRECISION)).toBe(1)
    })

    test('returns 0 for a zero price', () => {
        expect(toRationalPrice(0n)).toBe(0)
    })

    test('converts a half-precision value to 0.5', () => {
        expect(toRationalPrice(PRECISION / 2n)).toBe(0.5)
    })

    test('handles values larger than precision', () => {
        expect(toRationalPrice(PRECISION * 2n)).toBe(2)
    })
})

describe('approximatePrice', () => {
    test('divides numerator by denominator as Numbers', () => {
        expect(approximatePrice(1n, 4n)).toBe(0.25)
        expect(approximatePrice(100n, 4n)).toBe(25)
    })

    test('returns Infinity when denominator is 0', () => {
        expect(approximatePrice(1n, 0n)).toBe(Infinity)
    })

    test('returns NaN when both arguments are 0', () => {
        expect(approximatePrice(0n, 0n)).toBeNaN()
    })
})
