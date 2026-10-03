import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core'
import { TranslatePipe } from '@ngx-translate/core'
import { HlmCardImports } from '@spartan-ng/helm/card'

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe, HlmCardImports],
})
export class HomeComponent implements OnInit {
    ngOnInit(): void {
        console.log('HomeComponent INIT')
    }
}
