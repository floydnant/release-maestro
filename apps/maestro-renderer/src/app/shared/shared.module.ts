import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { TranslatePipe, TranslateDirective } from '@ngx-translate/core'

@NgModule({
    declarations: [],
    imports: [CommonModule, TranslatePipe, TranslateDirective, FormsModule],
    exports: [TranslatePipe, TranslateDirective, FormsModule],
})
export class SharedModule {}
