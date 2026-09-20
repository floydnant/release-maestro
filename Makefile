.PHONY: dev serve-renderer build build-prod build-engine generate-icons package package-dir run-packaged install-packaged test test-watch test-core test-electron test-renderer test-engine design-tokens design-tokens-watch design-tokens-check e2e e2e-production e2e-renderer e2e-show-report typecheck-e2e lint format f format-check dependency-policy-check agents-check sure affected db-generate db-studio db-check db-truncate-library clean corepack-enable install rebuild-electron rebuild-node nx version help

ICON_DIR := apps/maestro-renderer/src/assets/icons
ICON_SOURCE := $(ICON_DIR)/app-icon.png
SKIP_NX_CACHE := false
E2E_REPORT := electron
COREPACK_DIR := $(CURDIR)/.corepack
ifeq ($(OS),Windows_NT)
PNPM := "$(COREPACK_DIR)/pnpm.cmd"
else
PNPM := "$(COREPACK_DIR)/pnpm"
endif

# Development
dev: ## Start dev server (electron + renderer with hot reload)
	$(PNPM) exec nx serve maestro-electron

serve-renderer: ## Start only the renderer dev server
	$(PNPM) exec nx serve maestro-renderer

# Build
build: ## Build all projects (development config)
	$(PNPM) exec nx run-many -t build -c development
build-prod: ## Build all projects (production config)
	$(PNPM) exec nx run-many -t build -p maestro-renderer maestro-electron -c production
build-engine: ## Build the Rust metadata-engine worker binary (release)
	$(PNPM) exec nx run metadata-engine:build-package

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
	$(PNPM) exec nx make maestro-electron
package-dir: ## Build and package (directory only, no installer)
	$(PNPM) exec nx package maestro-electron
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
	$(PNPM) exec nx run-many -t test --skipNxCache=$(SKIP_NX_CACHE)
test-watch: ## Run all tests in watch mode
	$(PNPM) exec nx run-many -t test -- --watch
test-core: ## Run core library tests
	$(PNPM) exec nx test maestro-core
test-electron: ## Run electron backend tests
	$(PNPM) exec nx test maestro-electron
test-renderer: ## Run renderer tests
	$(PNPM) exec nx test maestro-renderer
design-tokens: ## Generate renderer design-token artifacts
	$(PNPM) exec nx run maestro-renderer:design-tokens-generate
design-tokens-watch: ## Regenerate renderer design-token artifacts when token files change
	$(PNPM) exec nx run maestro-renderer:design-tokens-watch
design-tokens-check: ## Test and verify renderer design-token artifacts
	$(PNPM) exec nx run maestro-renderer:design-tokens-check
test-engine: ## Run metadata-engine (Rust) tests
	$(PNPM) exec nx test metadata-engine

e2e: ## Run full Electron end-to-end tests
	$(PNPM) exec nx run maestro-e2e:e2e
e2e-production: package-dir ## Package and run Electron end-to-end tests for the current OS
	$(PNPM) exec nx run maestro-e2e:e2e-production
e2e-renderer: ## Run renderer only end-to-end tests
	$(PNPM) exec nx run maestro-e2e:e2e-renderer
e2e-show-report: ## Show an e2e report (E2E_REPORT=electron, renderer, or production)
	$(PNPM) exec playwright show-report playwright-report/$(E2E_REPORT)

# Code Quality
typecheck-e2e: ## Type-check the end-to-end test suite (also runs automatically before e2e)
	$(PNPM) exec nx run maestro-e2e:typecheck
lint: ## Lint all projects
	$(PNPM) exec nx run-many -t lint --output-style=stream --skipNxCache=$(SKIP_NX_CACHE)
format: ## Format all files
	$(PNPM) exec prettier --write "./**/*.ts" "./**/*.html" "./**/*.css" "./**/*.json" "./**/*.md" "./**/*.yaml" "./**/*.yml" "./**/*.mjs"
	@echo ""
	@git status --short
f: format
format-check: ## Check formatting
	$(PNPM) exec prettier --check "./**/*.ts" "./**/*.html" "./**/*.css" "./**/*.json" "./**/*.md" "./**/*.yaml" "./**/*.yml" "./**/*.mjs"

dependency-policy-check: ## Verify exact dependencies and immutable GitHub Action references
	node tools/verify-dependency-policy.mjs

agents-check: ## Verify the canonical agent skills and their harness adapters
	node --test tools/*.test.mjs
	node tools/verify-agent-harness.mjs

sure: format ## Format, lint, build, unit test, and development E2E; build is the app type gate
	$(PNPM) exec nx run-many -t build,lint,test,e2e,e2e-renderer -c development --skipNxCache=$(SKIP_NX_CACHE)
affected: ## Run checks only on affected projects based on git changes
	$(PNPM) exec nx affected -t build,lint,test,e2e,e2e-renderer --skipNxCache=$(SKIP_NX_CACHE)

# Database
drizzleCommand = mkdir -p .app-data.dev/data && DATABASE_URL=file:./.app-data.dev/data/mailbox-tool.db ELECTRON_RUN_AS_NODE=1 $(PNPM) exec electron ./node_modules/drizzle-kit/bin.cjs
db-generate: ## Generate a new migration with the given NAME (e.g. make db-generate NAME=add_users_table)
	@test -n "$(NAME)" || (echo "Usage: make db-generate NAME=migration_name" && exit 1)
	$(drizzleCommand) generate --name=$(NAME)
db-studio: ## Open drizzle studio
	$(drizzleCommand) studio 
db-check: ## Check the database
	$(drizzleCommand) check
db-truncate-library: ## Truncate library tables (keeps migrations + feed tables) and delete the library scan state
	ELECTRON_RUN_AS_NODE=1 $(PNPM) exec electron apps/maestro-electron/tools/db-truncate-library.cjs

# Maintenance
clean: ## Clean build outputs and caches
	rm -rf dist/ release/ .angular/cache/
	$(PNPM) exec nx reset
.PHONY: i
corepack-enable: ## Enable the pnpm shim pinned by package.json (requires Node 22 or 24)
	mkdir -p "$(COREPACK_DIR)"
	corepack enable pnpm --install-directory "$(COREPACK_DIR)"

install: corepack-enable ## Install pnpm packages, Rust crates, and Playwright Chromium dependencies
	$(PNPM) install --frozen-lockfile
	cargo fetch --locked --manifest-path apps/metadata-engine/Cargo.toml
	$(PNPM) exec playwright install --with-deps chromium
i: install ## Alias for install
rebuild-electron: ## Rebuild native dependencies (e.g. after Electron version change)
	electron-rebuild -f -w better-sqlite3
rebuild-node: ## Rebuild native dependencies for Node.js (e.g. after Node version change)
	$(PNPM) rebuild better-sqlite3
nx: ## Run a focused Nx command through pinned pnpm (for example: make nx ARGS='test maestro-core')
	$(if $(strip $(ARGS)),,$(error Usage: make nx ARGS='test maestro-core'))
	$(PNPM) exec nx $(ARGS)

version: ## Generate changelog and update version
	$(PNPM) exec conventional-changelog -i CHANGELOG.md -s -r 0 && $(PNPM) exec prettier --write CHANGELOG.md && git add CHANGELOG.md

# Help
help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
