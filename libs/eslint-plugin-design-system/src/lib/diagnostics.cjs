/**
 * Every message both rules can emit, in one place — they overlap almost entirely, and wording that
 * drifts between two rules reporting the same mistake is worse than no wording at all.
 *
 * House style: name the failure, then the way out. No sentence explains the mechanism twice, and
 * none explains the pipe convention to someone who is already using it — that is the skill's job,
 * not the diagnostic's.
 */

/** Shared by `valid-template-classnames` and `valid-host-classnames`. */
const CLASS_MESSAGES = {
    unknownClass: 'Unknown class `{{className}}`.',
    unknownClassWithSuggestion: 'Unknown class `{{className}}` — did you mean `{{suggestion}}`?',

    // Same verdict, plus the other reading, where the token sits where a descriptor would. Phrased
    // as a question because that is honestly all the rule knows: nothing about the shape of a bare
    // word separates a descriptor from a typo, which is why the pipe exists in the first place.
    unknownClassOrDescriptor: 'Unknown class `{{className}}` — or a descriptor missing its `|`?',
    unknownClassOrDescriptorWithSuggestion:
        'Unknown class `{{className}}` — did you mean `{{suggestion}}`, or a descriptor missing its `|`?',

    // A real utility whose value is off this project's scale, and a real utility with no bare form
    // at all. Both look like ordinary Tailwind and emit nothing; neither is a misspelling, and
    // calling them "unknown" sends the reader to the Tailwind docs to find that the name is fine.
    offScaleValue: '`{{className}}` is off the `{{scale}}` scale — did you mean `{{suggestion}}`?',
    bareUtility: 'Bare `{{className}}` emits no CSS — did you mean `{{suggestion}}`?',

    emptyDescriptor: 'Descriptor missing before `|`.',
    multipleDescriptors: 'More than one descriptor before `|`.',
    multiplePipes: 'More than one `|` in a class list.',

    bareTokenVariable: 'Bare design token `{{variable}}` — use `theme(…)`.',
    unknownThemePath: 'No such theme path: `{{themePath}}`.',
}

/**
 * Template-only, and the only two findings where the reader's next question is "so what do I do" —
 * there is nothing to fix in the class list itself.
 */
const TEMPLATE_MESSAGES = {
    dynamicClassList: 'Runtime-built class list — enumerate the classes, or suppress with a reason.',
    partialClass:
        '`{{className}}` is glued to a runtime value — suppress with a reason if the vocabulary is closed.',
}

/**
 * Turns a failed class and its suggestion into the report descriptor that says the most precise
 * true thing about it.
 *
 * @param {string} className
 * @param {import('./suggest.cjs').Suggestion|null} suggestion
 * @param {{ inDescriptorPosition?: boolean }} [placement]
 * @returns {{ messageId: keyof CLASS_MESSAGES, data: Record<string, string> }}
 */
function describeUnknownClass(className, suggestion, { inDescriptorPosition = false } = {}) {
    // A value off a real scale, or a real utility with no bare form, is not a name someone invented
    // — offering "descriptor?" there would be noise, so those two verdicts always win.
    switch (suggestion?.kind) {
        case 'offScale':
            return {
                messageId: 'offScaleValue',
                data: { className, suggestion: suggestion.name, scale: suggestion.scale ?? '' },
            }
        case 'bareUtility':
            return { messageId: 'bareUtility', data: { className, suggestion: suggestion.name } }
        default:
            break
    }

    if (!suggestion) {
        return inDescriptorPosition
            ? { messageId: 'unknownClassOrDescriptor', data: { className } }
            : { messageId: 'unknownClass', data: { className } }
    }

    return inDescriptorPosition
        ? {
              messageId: 'unknownClassOrDescriptorWithSuggestion',
              data: { className, suggestion: suggestion.name },
          }
        : { messageId: 'unknownClassWithSuggestion', data: { className, suggestion: suggestion.name } }
}

module.exports = { CLASS_MESSAGES, describeUnknownClass, TEMPLATE_MESSAGES }
