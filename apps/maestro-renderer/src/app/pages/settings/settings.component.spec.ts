import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ActivatedRoute } from '@angular/router'
import { SettingsComponent } from './settings.component'

describe(SettingsComponent.name, () => {
    let component: SettingsComponent
    let fixture: ComponentFixture<SettingsComponent>

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SettingsComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {} satisfies Partial<ActivatedRoute>,
                },
            ],
        }).compileComponents()

        fixture = TestBed.createComponent(SettingsComponent)
        component = fixture.componentInstance
        fixture.detectChanges()
    })

    // @TODO: tests
    it('should create', () => {
        expect(component).toBeTruthy()
    })
})
