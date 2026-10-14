export const remediationInputs = () => ({
    group: { name: 'parser', versions: ['1.0.0'], ids: ['GHSA-parser'] },
    findings: [{ ecosystem: 'npm', name: 'parser', version: '1.0.0', id: 'GHSA-parser', status: 'blocked' }],
    advisories: [
        {
            affected: [
                {
                    package: { ecosystem: 'npm', name: 'parser' },
                    ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.1.0' }] }],
                },
            ],
        },
    ],
    registry: {
        versions: {
            '1.1.0': {},
            '1.1.1': {},
            '1.2.0': {},
            '2.0.0-beta.1': {},
            '2.0.0': { deprecated: 'Use 2.1' },
            '2.1.0': {},
        },
        time: {
            '1.1.0': '2026-10-01T00:00:00Z',
            '1.1.1': '2026-10-09T00:00:00Z',
            '1.2.0': '2026-10-10T00:00:00Z',
            '2.0.0-beta.1': '2026-10-01T00:00:00Z',
            '2.0.0': '2026-10-01T00:00:00Z',
        },
    },
    now: new Date('2026-10-12T00:00:00Z'),
})
