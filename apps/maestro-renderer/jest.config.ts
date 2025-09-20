const esModules = [].join('|')

export default {
    // rootDir: './',
    // transformIgnorePatterns: [`<rootDir>/node_modules/(?!${esModules})`],
    // transform: {
    //     '^.+\\.tsx?$': [
    //         'ts-jest',
    //         {
    //             allowSyntheticDefaultImports: true,
    //         },
    //     ],
    //     '^.+\\.js$': 'babel-jest',
    // },

    ////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////

    displayName: 'maestro-renderer',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    transform: {
        '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    },
    moduleFileExtensions: ['ts', 'js', 'html'],
    coverageDirectory: '../../coverage/maestro-renderer',
}
