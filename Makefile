.PHONY: dev serve-renderer build build-prod build-engine generate-icons package package-dir run-packaged install-packaged test test-watch test-core test-electron test-renderer test-engine e2e e2e-show-report lint format f format-check sure affected db-generate db-push db-studio clean install version help

ICON_DIR := apps/maestro-renderer/src/assets/icons
ICON_SOURCE := $(ICON_DIR)/app-icon.png

# Development
dev: ## Start dev server (electron + renderer with hot reload)
	npx nx serve maestro-electron

serve-renderer: ## Start only the renderer dev server
	npx nx serve maestro-renderer

# Build
build: ## Build all projects (development config)
	npx nx run-many -t build -c development
build-prod: ## Build all projects (production config)
	npx nx run-many -t build -p maestro-renderer maestro-electron -c production
build-engine: ## Build the Rust metadata-engine worker binary (release)
	npx nx build metadata-engine

# Package & Release
generate-icons: ## Generate app icon variants from app-icon.png
	@test -f "$(ICON_SOURCE)" || (echo "Missing $(ICON_SOURCE)" && exit 1)
	@command -v magick >/dev/null || (echo "Missing ImageMagick: install 'magick'" && exit 1)
	@command -v iconutil >/dev/null || (echo "Missing iconutil: run this target on macOS" && exit 1)
	@iconset_dir="$$(mktemp -d)/release-maestro.iconset"; \
		mkdir -p "$$iconset_dir"; \
		magick "$(ICON_SOURCE)" -resize 512x512 "$(ICON_DIR)/favicon.512x512.png"; \
		magick "$(ICON_SOURCE)" -resize 256x256 "$(ICON_DIR)/favicon.256x256.png"; \
		cp "$(ICON_DIR)/favicon.256x256.png" "$(ICON_DIR)/favicon.png"; \
		magick "$(ICON_SOURCE)" -define icon:auto-resize=256,128,64,48,32,16 "$(ICON_DIR)/favicon.ico"; \
		for size in 16 32 128 256 512; do \
			magick "$(ICON_SOURCE)" -resize "$${size}x$${size}" "$$iconset_dir/icon_$${size}x$${size}.png"; \
			doubled=$$((size * 2)); \
			magick "$(ICON_SOURCE)" -resize "$${doubled}x$${doubled}" "$$iconset_dir/icon_$${size}x$${size}@2x.png"; \
		done; \
		iconutil -c icns "$$iconset_dir" -o "$(ICON_DIR)/favicon.icns"; \
		rm -rf "$$(dirname "$$iconset_dir")"

package: ## Build and package as distributable (DMG/zip)
	npx nx make maestro-electron
package-dir: ## Build and package (directory only, no installer)
	npx nx make maestro-electron --prepackageOnly
run-packaged: package-dir ## Run the packaged app (macOS) and keep terminal attached for logs
	dist/packages/mac-arm64/Release\ Maestro.app/Contents/MacOS/Release\ Maestro
open-dmg: ## Open the generated DMG file (macOS)
	dmgPath="$$(find dist/executables -name '*.dmg' -print -quit | tr -d '\n')" && \
	open "$$dmgPath"
install-dmg: package ## Install the packaged app (macOS) using the DMG
	dmgPath="$$(find dist/executables -name '*.dmg' -print -quit | tr -d '\n')" && \
	hdiutil attach "$$dmgPath" && \
	volumeName="$$(find /Volumes -d -name "Release Maestro *-universal" -print -quit | tr -d '\n')" && \
	appPath="$$volumeName/Release Maestro.app" && \
	cp -R "$$appPath" /Applications && \
	hdiutil detach "$$volumeName"

# Test
test: ## Run all tests
	npx nx run-many -t test
test-watch: ## Run all tests in watch mode
	npx nx run-many -t test -- --watch
test-core: ## Run core library tests
	npx nx test maestro-core
test-electron: ## Run electron backend tests
	npx nx test maestro-electron
test-renderer: ## Run renderer tests
	npx nx test maestro-renderer
test-engine: ## Run metadata-engine (Rust) tests
	npx nx test metadata-engine

e2e: ## Run end-to-end tests
	npx playwright test -c apps/maestro-renderer-e2e/playwright.config.ts
e2e-show-report: ## Show the latest e2e test report
	npx playwright show-report dist/.playwright/apps/maestro-renderer-e2e/playwright-report

# Code Quality
lint: ## Lint all projects
	npx nx run-many -t lint
format: ## Format all files
	npx prettier --write "./**/*.ts" "./**/*.html" "./**/*.css" "./**/*.json" "./**/*.md"
f: format
format-check: ## Check formatting
	npx prettier --check "./**/*.ts" "./**/*.html" "./**/*.css" "./**/*.json" "./**/*.md"

sure: format ## Run all checks (format, lint, test, build)
	npx nx run-many -t lint,build,test -c development
affected: ## Run checks only on affected projects based on git changes
	npx nx affected -t build,lint,test,e2e

# Database
db-generate: ## Generate a new drizzle migration
	npx drizzle-kit generate
db-push: ## Push schema changes directly (no migration)
	npx drizzle-kit push
db-studio: ## Open drizzle studio
	npx drizzle-kit studio

# Maintenance
clean: ## Clean build outputs and caches
	rm -rf dist/ release/ .angular/cache/
	npx nx reset
install: ## Install dependencies
	npm install

version: ## Generate changelog and update version
	npx conventional-changelog -i CHANGELOG.md -s -r 0 && npx prettier --write CHANGELOG.md && git add CHANGELOG.md

# Help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
