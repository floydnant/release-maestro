import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ProgressBarComponent } from './progress-bar.component'

describe('ProgressBarComponent', () => {
    let component: ProgressBarComponent
    let fixture: ComponentFixture<ProgressBarComponent>

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ProgressBarComponent],
            providers: [],
        }).compileComponents()

        fixture = TestBed.createComponent(ProgressBarComponent)
        fixture.componentRef.setInput('segments', [])
        component = fixture.componentInstance
        fixture.detectChanges()
    })

    // @TODO: tests
    it('should create', () => {
        expect(component).toBeTruthy()
    })
})
