export const USE_SAME_MESSAGE = Symbol('useSameMessage')

export abstract class Exception extends Error {
    constructor(
        message: string /** Pass USE_SAME_MESSAGE to use the same message for the user-facing message. */,
        userFacingMessage: string | typeof USE_SAME_MESSAGE,
    ) {
        super(message)
        if (userFacingMessage == USE_SAME_MESSAGE) {
            this.userFacingMessage = message
        } else {
            this.userFacingMessage = userFacingMessage
        }
    }

    userFacingMessage: string
}

export class FetchFailedException extends Exception {
    constructor(
        message: string /** Pass USE_SAME_MESSAGE to use the same message for the user-facing message. */,
        public url: string,
        public originalError: Error,
        userFacingMessage: string | typeof USE_SAME_MESSAGE,
    ) {
        super(message, userFacingMessage)
    }
}
