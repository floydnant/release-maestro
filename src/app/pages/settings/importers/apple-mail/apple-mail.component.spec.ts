import { ComponentFixture, TestBed } from '@angular/core/testing'
import { AppleMailImporterComponent } from './apple-mail.component'

describe('AppleMailComponent', () => {
    let component: AppleMailImporterComponent
    let fixture: ComponentFixture<AppleMailImporterComponent>

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AppleMailImporterComponent],
        }).compileComponents()

        fixture = TestBed.createComponent(AppleMailImporterComponent)
        component = fixture.componentInstance
        fixture.detectChanges()
    })

    it('should create', () => {
        expect(component).toBeTruthy()
    })
})
