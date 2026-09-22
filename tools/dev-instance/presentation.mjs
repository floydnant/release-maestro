const slotLabel = instance =>
    instance.slot === null ? `renderer ${instance.bundle.renderer}` : `slot ${instance.slot}`

const ansi = {
    bold: '\u001b[1m',
    dim: '\u001b[2m',
    cyan: '\u001b[36m',
    green: '\u001b[32m',
    yellow: '\u001b[33m',
    reset: '\u001b[0m',
}

const paint = (value, style, color) => (color ? `${style}${value}${ansi.reset}` : value)
const label = (value, color) => paint(value, ansi.cyan, color)
const state = (value, color) => paint(value, value === 'active' ? ansi.green : ansi.yellow, color)
const health = (value, color) => paint(value, value === 'healthy' ? ansi.green : ansi.yellow, color)

const formatHolders = (holders, color) =>
    holders.length
        ? holders
              .map(
                  holder =>
                      `    ${label(holder.role, color)}: PID ${holder.pid}, started ${holder.startIdentity}`,
              )
              .join('\n')
        : '    none'

export const developmentAppName = instance => `Release Maestro dev [${slotLabel(instance)}]`

export const formatDevelopmentSummary = (instance, { color = false } = {}) =>
    [
        paint(`Release Maestro dev instance [${slotLabel(instance)}]`, ansi.bold, color),
        `  ${label('renderer ', color)} http://localhost:${instance.bundle.renderer}`,
        `  ${label('CDP      ', color)} http://127.0.0.1:${instance.bundle.cdp}`,
        `  ${label('inspector', color)} http://127.0.0.1:${instance.bundle.inspector}`,
        `  ${label('app data ', color)} ${instance.appDataPath}`,
        '',
    ].join('\r\n')

export const formatDevelopmentStatus = (status, { color = false } = {}) => {
    if (!status.bundle) return `${status.state}: ${status.path}`
    return [
        `${state(status.state, color)} (${health(status.health, color)}) [${slotLabel(status)}]`,
        `${label('worktree', color)}: ${status.path}`,
        `${label('identity', color)}: ${status.worktreeId}`,
        `${label('renderer', color)}: ${status.bundle.renderer}`,
        `${label('CDP', color)}: ${status.bundle.cdp}`,
        `${label('inspector', color)}: ${status.bundle.inspector}`,
        `${label('app data', color)}: ${status.appDataPath}`,
        `${label('age', color)}: ${Math.round(status.ageMs / 1000)}s`,
        `${label('resources', color)}: ${status.claims.join(', ')}`,
        `${label('holders', color)}:\n${formatHolders(status.holders, color)}`,
    ].join('\n')
}

export const formatInstanceList = ({ instances }, { color = false } = {}) => {
    if (instances.length === 0) return 'No instances.'
    return instances
        .map(instance => {
            const description =
                instance.kind === 'development'
                    ? `development [${slotLabel(instance)}]`
                    : `${instance.workflow} [${slotLabel(instance)}]`
            return [
                `${paint(description, ansi.bold, color)}: ${state(instance.state, color)} (${health(instance.health, color)})`,
                `  ${label('worktree', color)}: ${instance.path}`,
                `  ${label('identity', color)}: ${instance.worktreeId}`,
                `  ${label('renderer', color)}: ${instance.bundle.renderer}`,
                `  ${label('CDP', color)}: ${instance.bundle.cdp}`,
                `  ${label('inspector', color)}: ${instance.bundle.inspector}`,
                `  ${label('holders', color)}:\n${formatHolders(instance.holders, color)}`,
            ].join('\n')
        })
        .join('\n\n')
}

const formatLogValue = value => (typeof value === 'string' ? value : JSON.stringify(value))

export const formatLogEvent = (event, { color = false } = {}) => {
    const { at, event: name, ...details } = event
    return [
        `${paint(name ?? 'unknown event', ansi.bold, color)} ${paint(at ?? 'unknown time', ansi.dim, color)}`,
        ...Object.entries(details).map(([key, value]) => {
            const keyFormatted = paint(key + ':', ansi.dim, color)
            if (key == 'role') return `  ${keyFormatted} ${paint(value, ansi.cyan, color)}`
            if (key == 'path') return `  ${keyFormatted} ${paint(value, ansi.green, color)}`
            if (key == 'ports') {
                return `  ${keyFormatted} ${Object.entries(value)
                    .map(([holder, port]) => `${holder} ${paint(port, ansi.cyan, color)}`)
                    .join(' | ')}`
            }
            if (key.endsWith('Id')) return `  ${keyFormatted} ${paint(value, ansi.dim, color)}`

            return `  ${keyFormatted} ${formatLogValue(value)}`
        }),
    ].join('\n')
}
