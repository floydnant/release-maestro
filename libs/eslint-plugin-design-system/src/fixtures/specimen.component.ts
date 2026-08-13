/* Fixture for the class-validation rules: not part of the application. */
import { Component, computed, signal } from '@angular/core'

@Component({
    selector: 'app-specimen',
    templateUrl: './specimen.component.html',
    styleUrls: ['./specimen.component.css'],
    styles: `
        .inline-scoped {
            display: block;
        }
    `,
    host: {
        class: 'inline-flex scoped-only',
    },
})
export class SpecimenComponent {
    /**
     * The members below are the corpus for member resolution. Names the template tests expect to
     * stay unresolvable — `workerHealthClass`, `classMap`, `typographyClass` — are deliberately not
     * declared here: a template naming a member this component does not have is exactly the case
     * that must keep reporting.
     */
    private readonly busy = signal(false)

    /** A closed vocabulary in a method: every branch a string literal. */
    statusClass(state: 'ok' | 'busy' | 'gone'): string {
        switch (state) {
            case 'ok':
                return 'bg-status-info-background text-content-primary'
            case 'busy':
                return 'bg-background-surface text-content-muted'
            case 'gone':
                return 'bg-background-canvas text-content-muted'
        }
    }

    /** The same, derived: `computed` is the one factory whose value is its callback's return. */
    readonly badgeClass = computed(() => (this.busy() ? 'opacity-30 blur-sm' : 'flex items-center'))

    /** A ternary in a concise body, read through `()` like any other derived value. */
    readonly toneClass = computed(() => (this.busy() ? 'type-code-sm' : 'type-body-sm'))

    /** A plain constant, read without `()`. */
    readonly listClass = 'flex items-center gap-3'

    /** A getter: read without `()`, resolved from its returns. */
    get panelClass(): string {
        return 'panel'
    }

    /** Resolvable and wrong — the literals are validated, not trusted for where they came from. */
    plantedClass(): string {
        return 'flex fleex'
    }

    /** A closed vocabulary the rule cannot see: one branch is not a literal. */
    mixedClass(suffix: string): string {
        if (this.busy()) return 'flex'
        return `gap-${suffix}`
    }

    /** Writable, so its initial value says nothing about what the template renders. */
    readonly mutableClass = signal('flex')
}
