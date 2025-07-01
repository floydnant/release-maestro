import { z } from 'zod'

export const appEnvSchema = z.object({
    EMAIL_JSON_PATH: z.string(),
    APP_DATA_PATH: z.string(),
})
