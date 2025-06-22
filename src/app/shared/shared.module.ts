import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { TranslateModule } from '@ngx-translate/core'

@NgModule({
    declarations: [],
    imports: [CommonModule, TranslateModule, FormsModule],
    exports: [TranslateModule, FormsModule],
})
export class SharedModule {}
