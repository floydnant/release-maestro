import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import type { ExternalLink } from '../../browse/external-links'
import { IconComponent } from '../icon/icon.component'

/** The row of outbound service links under a detail page's title. Renders nothing without links. */
@Component({
    selector: 'app-external-links',
    templateUrl: './external-links.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent],
})
export class ExternalLinksComponent {
    links = input.required<ExternalLink[]>()
    label = input.required<string>()
}
