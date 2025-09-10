import { appEnvSchema } from '../shared/schemas/app-env.schema'

export const appEnv = appEnvSchema.parse(process.env)
