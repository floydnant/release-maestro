import { afterEach, describe, expect, it } from '@jest/globals'
import { environmentPort } from './environment-port'

describe('environmentPort', () => {
    const name = 'RELEASE_MAESTRO_TEST_PORT'

    afterEach(() => {
        delete process.env[name]
    })

    it('uses the fallback when the variable is absent', () => {
        expect(environmentPort(name, 4200)).toBe(4200)
    })

    it('parses a valid user port', () => {
        process.env[name] = '4310'
        expect(environmentPort(name, 4200)).toBe(4310)
    })

    it.each(['abc', '1023', '65536', '4200.5', '', ' 4300', '0x10CC'])('rejects %s', value => {
        process.env[name] = value
        expect(() => environmentPort(name, 4200)).toThrow(`${name} must be an integer from 1024 to 65535`)
    })
})
