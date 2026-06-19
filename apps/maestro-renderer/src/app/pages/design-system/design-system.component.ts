import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component } from '@angular/core'
import {
    contrastPairs,
    foundationColorIdentifiers,
    foundationToken,
    opacityTokenIdentifiers,
    radiusTokenIdentifiers,
    semanticColor,
    SemanticColorIdentifier,
    semanticColorIdentifiers,
    shadowTokenIdentifiers,
    sizeTokenIdentifiers,
    spacingTokenIdentifiers,
    typographyVariantIdentifiers,
} from '../../shared/design-tokens.generated'

@Component({
    selector: 'app-design-system',
    imports: [CommonModule],
    templateUrl: './design-system.component.html',
    styleUrls: ['./design-system.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesignSystemComponent {
    readonly foundationColorColumns = Object.entries(
        foundationColorIdentifiers.reduce<Record<string, string[]>>((columns, token) => {
            const [, family] = token.split('.')
            if (!family) return columns
            columns[family] ??= []
            columns[family].push(token)
            return columns
        }, {}),
    ).map(([family, tokens]) => ({ family, tokens }))
    readonly semanticColors = semanticColorIdentifiers
    readonly contrastPairs = contrastPairs.map(([foreground, background]) => ({ foreground, background }))
    readonly spacingTokens = spacingTokenIdentifiers
    readonly radiusTokens = radiusTokenIdentifiers
    readonly sizeTokens = sizeTokenIdentifiers
    readonly opacityTokens = opacityTokenIdentifiers
    readonly shadowTokens = shadowTokenIdentifiers
    readonly typographyVariants = typographyVariantIdentifiers

    semanticColor(identifier: SemanticColorIdentifier): string {
        return semanticColor(identifier)
    }

    semanticColorFromIdentifier(identifier: string): string {
        return semanticColor(identifier as SemanticColorIdentifier)
    }

    foundationToken(identifier: string): string {
        return foundationToken(identifier)
    }
}
