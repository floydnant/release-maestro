const slotLabel = instance =>
    instance.slot === null ? `renderer ${instance.bundle.renderer}` : `slot ${instance.slot}`

const formatHolders = holders =>
    holders.length
        ? holders
              .map(holder => `    ${holder.role}: PID ${holder.pid}, started ${holder.startIdentity}`)
              .join('\n')
        : '    none'

export const developmentAppName = instance => `Release Maestro dev [${slotLabel(instance)}]`

export const formatDevelopmentSummary = instance =>
    [
        `Release Maestro dev instance [${slotLabel(instance)}]`,
        `  renderer  http://localhost:${instance.bundle.renderer}`,
        `  CDP       http://127.0.0.1:${instance.bundle.cdp}`,
        `  inspector http://127.0.0.1:${instance.bundle.inspector}`,
        `  app data  ${instance.appDataPath}`,
        '',
    ].join('\r\n')

export const formatDevelopmentStatus = status => {
    if (!status.bundle) return `${status.state}: ${status.path}`
    return [
        `${status.state} (${status.health}) [${slotLabel(status)}]`,
        `worktree: ${status.path}`,
        `identity: ${status.worktreeId}`,
        `renderer: ${status.bundle.renderer}`,
        `CDP: ${status.bundle.cdp}`,
        `inspector: ${status.bundle.inspector}`,
        `app data: ${status.appDataPath}`,
        `age: ${Math.round(status.ageMs / 1000)}s`,
        `resources: ${status.claims.join(', ')}`,
        `holders:\n${formatHolders(status.holders)}`,
    ].join('\n')
}

export const formatInstanceList = ({ instances }) => {
    if (instances.length === 0) return 'No instances.'
    return instances
        .map(instance => {
            const description =
                instance.kind === 'development'
                    ? `development [${slotLabel(instance)}]`
                    : `${instance.workflow} [${slotLabel(instance)}]`
            return [
                `${description}: ${instance.state} (${instance.health})`,
                `  worktree: ${instance.path}`,
                `  identity: ${instance.worktreeId}`,
                `  renderer: ${instance.bundle.renderer}`,
                `  CDP: ${instance.bundle.cdp}`,
                `  inspector: ${instance.bundle.inspector}`,
                `  holders:\n${formatHolders(instance.holders)}`,
            ].join('\n')
        })
        .join('\n\n')
}

const formatLogValue = value => (typeof value === 'string' ? value : JSON.stringify(value))

export const formatLogEvent = event => {
    const { at, event: name, ...details } = event
    return [
        `${at ?? 'unknown time'} ${name ?? 'unknown event'}`,
        ...Object.entries(details).map(([key, value]) => `  ${key}: ${formatLogValue(value)}`),
    ].join('\n')
}
