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
 * The findings where the reader's next question is "so what do I do", because there is nothing to
 * fix in the class list itself.
 */
const DYNAMIC_MESSAGE = {
    dynamicClassList: 'Runtime-built class list — enumerate the classes, or suppress with a reason.',
}

/** `host: { class: someExpression }` is the decorator's version of `[class]`. */
const HOST_MESSAGES = { ...DYNAMIC_MESSAGE }

/**
 * The verdicts for a class list that names a component member the rule could not enumerate.
 *
 * `dynamicClassList` above is the honest answer when the expression is not addressing a member at
 * all, and it is a dead end for the reader: the only action it suggests is a suppression, which is
 * how suppressions accumulate. Each message here replaces it for a case where the rule knows more
 * than "runtime-built", and every one of them names the edit that would resolve the member — so an
 * agent reading the diagnostic has somewhere to go that is not `eslint-disable`.
 */
const MEMBER_MESSAGES = {
    unknownMember:
        '`{{name}}` is not a member of `{{component}}` — a class list has to come from the component ' +
        'this template belongs to.',

    shadowedMember:
        '`{{name}}` is bound by the template, not by `{{component}}` — Angular resolves template ' +
        'variables ahead of members, so nothing about its value is knowable here. Move the class ' +
        'list onto the component, or suppress with a reason.',

    chainedMember:
        'A class list reached through a property chain or an index is not resolvable — only ' +
        '`member` and `member()` resolve against the component. Give the whole class list its own ' +
        'member, or suppress with a reason.',

    memberCallShape:
        '`{{name}}` is {{declared}}, but the template reads it as {{read}} — write `{{fix}}`.',

    ambiguousMember:
        '`{{name}}` is declared by more than one component in this file — the template maps to the ' +
        'file, so there is no saying which. Give them distinct names.',

    // Two ways to fail to enumerate, and the difference matters to whoever has to fix it: the typed
    // tier can name the type standing in the way, the syntactic one can only say it looked.
    widerMember:
        '`{{name}}` is typed `{{type}}`, which is not a closed set of class names — narrow it to a ' +
        "string-literal union (`'flex' | 'hidden'`), or suppress with a reason.",

    unenumerableMember:
        '`{{name}}` is a member of `{{component}}` but its class list is not enumerable from that ' +
        'file — return string literals from every branch, or turn on `resolveTypes` and give it a ' +
        'string-literal union type, or suppress with a reason.',
}

const TEMPLATE_MESSAGES = {
    ...DYNAMIC_MESSAGE,
    ...MEMBER_MESSAGES,
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

module.exports = { CLASS_MESSAGES, describeUnknownClass, HOST_MESSAGES, TEMPLATE_MESSAGES }
