import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core'
import { TranslatePipe } from '@ngx-translate/core'

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.css'],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe],
})
export class HomeComponent implements OnInit {
    ngOnInit(): void {
        console.log('HomeComponent INIT')
    }
}
