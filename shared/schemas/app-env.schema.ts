import { z } from 'zod'

export const appEnvSchema = z.object({
    DATABASE_URL: z.string(),
})
