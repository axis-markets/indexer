function generateError({message, status}) {
    let error = new Error(message)
    error.status = status || 0
    return error
}

function withDetails(message, details) {
    if (!details)
        return message
    return message + ' ' + details
}

const stdErrors = {
    genericError: function (internalError) {
        return generateError({
            message: 'Error occurred. If this error persists, please contact our support.',
            status: 0,
            internalError: internalError
        })
    },
    badRequest: function (details = null) {
        return generateError({
            message: withDetails('Bad request.', details),
            status: 400
        })
    },
    forbidden: function (details = null) {
        return generateError({
            message: withDetails('Forbidden.', details),
            status: 403
        })
    },
    notFound: function (details = null) {
        return generateError({
            message: withDetails('Not found.', details),
            status: 404
        })
    },
    validationError: function (invalidParamName, details = null) {
        return this.badRequest(withDetails(`Invalid parameter: "${invalidParamName}".`, details))
    },
    tradingError: function (details = null){
        return generateError({
            message: withDetails('Trading error.', details),
            status: 409
        })
    }
}

module.exports = stdErrors