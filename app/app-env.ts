import { appEnvSchema } from '../src/shared/app-env.schema'

export const appEnv = appEnvSchema.parse(process.env)
