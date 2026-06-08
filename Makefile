.PHONY: dev build build-dev build-prod package test test-watch test-core test-electron test-renderer lint format format-check e2e clean

# Development
dev: ## Start dev server (electron + renderer with hot reload)
	npx nx serve maestro-electron

serve-renderer: ## Start only the renderer dev server
	npx nx serve maestro-renderer

# Build
build: ## Build all projects (default config)
	npx nx run-many -t build
build-dev: ## Build all projects (development config)
	npx nx run-many -t build -c development
build-prod: ## Build all projects (production config)
	npx nx run-many -t build -p maestro-renderer maestro-electron -c production

# Package & Release
package: ## Build and package as distributable (DMG/zip)
	npx nx make maestro-electron
package-dir: ## Build and package (directory only, no installer)
	npx nx make maestro-electron --prepackageOnly
run-packaged: package-dir ## Run the packaged app (macOS) and keep terminal attached for logs
	dist/packages/mac-arm64/Release\ Maestro.app/Contents/MacOS/Release\ Maestro
install-packaged: package ## Install the packaged app (macOS) using the DMG
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
sure: format
	npx nx run-many -t lint,build,test -c development

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
