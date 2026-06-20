import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.css'],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslateModule],
})
export class HomeComponent implements OnInit {
    ngOnInit(): void {
        console.log('HomeComponent INIT')
    }
}
