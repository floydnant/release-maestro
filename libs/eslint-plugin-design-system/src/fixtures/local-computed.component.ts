/*
 * Fixture for the class-validation rules: not part of the application.
 *
 * The whole point of this file is its first line. `computed` here is a local helper that shares a
 * name with Angular's and does something else entirely — the exact shape that made the removed
 * generated-API exemption unsound. Member resolution checks the import site, not the spelling, so
 * `wrapperClass` below stays unresolvable.
 *
 * Its template is never written to disk; the corpus addresses it by name through `RuleTester`,
 * which is enough for `componentFileFor` to map back here through `templateUrl`.
 */
import { Component } from '@angular/core'

const computed = (produce: () => string) => () => `${produce()}-suffixed`

@Component({
    selector: 'app-local-computed',
    templateUrl: './local-computed.component.html',
})
export class LocalComputedComponent {
    readonly wrapperClass = computed(() => 'flex')
}
