/* Fixture for the class-validation rules: not part of the application. */
import { Component } from '@angular/core'

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
export class SpecimenComponent {}
