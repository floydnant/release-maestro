module.exports = {
    displayName: 'maestro-renderer',
    preset: '../../jest.preset.js',
    setupFilesAfterEnv: ['<rootDir>/src/test/test-setup.ts'],
    coverageDirectory: '../../coverage/apps/maestro-renderer',
    // Design-system tooling has its own Node-environment project (`tools/jest.config.cjs`); running
    // those specs here too would put ESLint and Tailwind inside jsdom, where they do not belong.
    testPathIgnorePatterns: ['<rootDir>/tools/'],
    transform: {
        '^.+\\.(ts|mjs|js|html)$': [
            'jest-preset-angular',
            {
                tsconfig: '<rootDir>/tsconfig.spec.json',
                stringifyContentPathRegex: '\\.(html|svg)$',
            },
        ],
    },
    transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
    snapshotSerializers: [
        'jest-preset-angular/build/serializers/no-ng-attributes',
        'jest-preset-angular/build/serializers/ng-snapshot',
        'jest-preset-angular/build/serializers/html-comment',
    ],
}
