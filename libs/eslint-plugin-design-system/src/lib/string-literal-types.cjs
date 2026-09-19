/**
 * Every string a TypeScript type can be, or null once any constituent is wider than a string
 * literal. A closed union is proof that the runtime value can only be one of the returned strings.
 *
 * @param {import('typescript').Type} type
 * @returns {string[]|null}
 */
function stringLiteralsOf(type) {
    const parts = type.isUnion() ? type.types : [type]

    /** @type {string[]} */
    const literals = []
    for (const part of parts) {
        if (!part.isStringLiteral()) return null
        literals.push(part.value)
    }
    return literals.length > 0 ? literals : null
}

module.exports = { stringLiteralsOf }
