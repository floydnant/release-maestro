import { z } from 'zod'

export const appEnvSchema = z.object({
    EMAIL_JSON_PATH: z.string(),
    DATABASE_URL: z.string(),
})
