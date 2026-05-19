const stdErrors = require('../../src/server/errors')

describe('stdErrors', () => {
    test('badRequest returns 400 with default message', () => {
        const e = stdErrors.badRequest()
        expect(e).toBeInstanceOf(Error)
        expect(e.status).toBe(400)
        expect(e.message).toBe('Bad request.')
    })

    test('badRequest appends details', () => {
        const e = stdErrors.badRequest('missing field')
        expect(e.message).toBe('Bad request. missing field')
    })

    test('forbidden returns 403', () => {
        expect(stdErrors.forbidden().status).toBe(403)
    })

    test('notFound returns 404', () => {
        expect(stdErrors.notFound().status).toBe(404)
    })

    test('tradingError returns 409', () => {
        expect(stdErrors.tradingError('insufficient balance').status).toBe(409)
        expect(stdErrors.tradingError('insufficient balance').message).toBe('Trading error. insufficient balance')
    })

    test('validationError formats the parameter name and inherits 400 status', () => {
        const e = stdErrors.validationError('owner')
        expect(e.status).toBe(400)
        expect(e.message).toBe('Bad request. Invalid parameter: "owner".')
    })

    test('validationError includes optional details', () => {
        const e = stdErrors.validationError('cursor', 'must be positive')
        expect(e.message).toBe('Bad request. Invalid parameter: "cursor". must be positive')
    })

    test('genericError returns status 0', () => {
        expect(stdErrors.genericError().status).toBe(0)
    })
})
