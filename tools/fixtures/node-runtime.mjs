export const nodeRuntimeFixture = () => ({
    range: '>= 22.23.4 < 23 || >= 24.22.1 < 25',
    pin: '24.22.1',
    now: new Date('2026-11-02T12:00:00Z'),
    releases: [
        { version: 'v24.24.0', date: '2026-11-01', lts: 'Krypton', security: false },
        { version: 'v26.12.1', date: '2026-11-01', lts: false, security: true },
        { version: 'v24.23.0', date: '2026-11-01', lts: 'Krypton', security: true },
        { version: 'v22.24.0', date: '2026-11-01', lts: 'Jod', security: true },
        { version: 'v24.22.1', date: '2026-10-21', lts: 'Krypton', security: true },
        { version: 'v22.23.4', date: '2026-10-21', lts: 'Jod', security: true },
    ],
    schedule: {
        v22: { lts: '2024-10-29', end: '2027-04-30' },
        v24: { lts: '2025-10-28', end: '2028-04-30' },
    },
})
