export const snapshotInputs = () => {
    const component = (name, version, ecosystem, scope) => ({
        name,
        version,
        purl: `pkg:${ecosystem}/${name.split('/').map(encodeURIComponent).join('/')}@${version}`,
        properties: [{ name: 'release-maestro:dependency-scope', value: scope }],
    })
    return {
        bom: {
            components: [
                component('pnpm', '12.8.1', 'npm', 'development'),
                component('@app/ui', '1.0.0', 'npm', 'runtime'),
                component('helper', '2.0.0', 'npm', 'runtime'),
                component('optional', '3.0.0', 'npm', 'runtime'),
                component('test', '1.0.0', 'npm', 'development'),
                component('reader', '1.0.0', 'cargo', 'runtime'),
                component('macro', '1.0.0', 'cargo', 'development'),
            ],
        },
        documents: [
            {
                importers: { '.': { packageManagerDependencies: { pnpm: { version: '12.8.1' } } } },
                snapshots: { 'pnpm@12.8.1': {} },
            },
            {
                importers: {
                    '.': {
                        dependencies: { '@app/ui': { version: '1.0.0(peer@2.0.0)' } },
                        devDependencies: { test: { version: '1.0.0' } },
                    },
                },
                snapshots: {
                    '@app/ui@1.0.0(peer@2.0.0)': {
                        dependencies: { alias: 'helper@2.0.0' },
                        optionalDependencies: { optional: '3.0.0' },
                    },
                    'test@1.0.0': { dependencies: { helper: '2.0.0' } },
                    'helper@2.0.0': {},
                    'optional@3.0.0': {},
                },
            },
        ],
        metadata: {
            packages: ['engine', 'reader', 'macro'].map(name => ({ id: name, name, version: '1.0.0' })),
            resolve: {
                root: 'engine',
                nodes: [
                    { id: 'engine', deps: [{ pkg: 'reader' }, { pkg: 'macro' }] },
                    { id: 'reader', deps: [{ pkg: 'macro' }] },
                    { id: 'macro', deps: [] },
                ],
            },
        },
    }
}
