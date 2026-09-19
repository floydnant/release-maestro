module.exports = {
    displayName: 'maestro-e2e',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    transform: {
        '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    },
    moduleFileExtensions: ['ts', 'js', 'html'],
    coverageDirectory: '../../coverage/maestro-e2e',
}
