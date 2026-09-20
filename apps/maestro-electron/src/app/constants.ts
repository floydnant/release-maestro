const configuredRendererPort = Number(process.env['RELEASE_MAESTRO_RENDERER_PORT'] ?? 4200)

if (
    !Number.isSafeInteger(configuredRendererPort) ||
    configuredRendererPort < 1024 ||
    configuredRendererPort > 65535
) {
    throw new Error('RELEASE_MAESTRO_RENDERER_PORT must be an integer from 1024 through 65535')
}

export const rendererAppPort = configuredRendererPort
export const rendererAppName = 'maestro-renderer' // options.name.split('-')[0] + '-web'
export const electronAppName = 'maestro-electron'

// TODO: figure out how updates will be hosted
export const updateServerUrl = 'https://deployment-server-url.com'
