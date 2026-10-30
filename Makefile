# Thin task runner over Buf and pnpm (A§17.1, D91). CMake targets join later.
PNPM ?= pnpm
WEB := $(PNPM) --dir web

.PHONY: gen web-install web-lint web-format-check web-typecheck web-test web-e2e web-build test

web-install:
	$(PNPM) install

gen: web-install
	$(WEB) run gen

web-lint: gen
	$(WEB) run lint

web-format-check: web-install
	$(WEB) run format:check

web-typecheck: gen
	$(WEB) run typecheck

web-test: gen
	$(WEB) run test

web-e2e: gen
	$(WEB) run e2e

web-build: gen
	$(WEB) run build

test: web-typecheck web-lint web-format-check web-test web-e2e
