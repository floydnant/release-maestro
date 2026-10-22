import { HlmAvatar } from './lib/hlm-avatar'
import { HlmAvatarFallback } from './lib/hlm-avatar-fallback'
import { HlmAvatarGroup } from './lib/hlm-avatar-group'
import { HlmAvatarGroupCount } from './lib/hlm-avatar-group-count'
import { HlmAvatarImage } from './lib/hlm-avatar-image'

export * from './lib/hlm-avatar'
export * from './lib/hlm-avatar-fallback'
export * from './lib/hlm-avatar-group'
export * from './lib/hlm-avatar-group-count'
export * from './lib/hlm-avatar-image'

export const HlmAvatarImports = [
    HlmAvatar,
    HlmAvatarFallback,
    HlmAvatarGroup,
    HlmAvatarGroupCount,
    HlmAvatarImage,
] as const
