.PHONY: dev build build-dev build-prod package test test-watch test-core test-electron test-renderer lint format format-check e2e clean

# Development
dev: ## Start dev server (electron + renderer with hot reload)
	npx nx serve maestro-electron

serve-renderer: ## Start only the renderer dev server
	npx nx serve maestro-renderer

# Build
build: ## Build all projects (default config)
	npx nx build maestro-renderer && npx nx build maestro-electron

build-dev: ## Build all projects (development config)
	npx nx build maestro-renderer -c development && npx nx build maestro-electron

build-prod: ## Build all projects (production config)
	npx nx build maestro-renderer -c production && npx nx build maestro-electron -c production

# Package & Release
package: build-prod ## Build and package as distributable (DMG/zip)
	npx electron-builder build --publish=never

package-dir: build-prod ## Build and package (directory only, no installer)
	npx electron-builder build --dir --publish=never

run-local: build-dev ## Build for dev and launch electron
	npx electron dist/apps/maestro-electron/main.js

run-packaged: ## Run the packaged app (macOS) and keep terminal attached for logs
	release/mac-universal/Release\ Maestro.app/Contents/MacOS/Release\ Maestro

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

# Code Quality
lint: ## Lint all projects
	npx nx run-many -t lint

format: ## Format all files
	npx prettier --write "./**/*.ts" "./**/*.html" "./**/*.css" "./**/*.json"

format-check: ## Check formatting
	npx prettier --check "./**/*.ts" "./**/*.html" "./**/*.css" "./**/*.json"

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

# Help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
