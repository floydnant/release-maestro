import { Component, ChangeDetectionStrategy } from '@angular/core'
import { HlmCardImports } from '@spartan-ng/helm/card'

@Component({
    selector: 'app-page-not-found',
    templateUrl: './page-not-found.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [HlmCardImports],
})
export class PageNotFoundComponent {}
