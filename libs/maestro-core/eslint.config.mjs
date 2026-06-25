import baseConfig from '../../eslint.config.mjs'

export default [
    ...baseConfig,
    {
        files: ['**/package.json'],
        rules: {
            '@nx/dependency-checks': [
                'error',
                {
                    ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
                    // `electron` is imported type-only by the IPC contract wrappers
                    // (`src/ipc/*`) and erased at runtime, so it is not a runtime dependency.
                    ignoredDependencies: ['tslib', 'electron'],
                },
            ],
        },
    },
]
