export type SettingsSection = 'library-folders' | 'feed' | 'apple-mail' | 'debug' | 'design-system'

/**
 * Router commands that open the settings dialog on a section, over the current page. Absolute, so
 * the dialog opens in the root `modal` outlet whichever route the link sits in.
 */
export const settingsLink = (section: SettingsSection) => ['/', { outlets: { modal: ['settings', section] } }]
