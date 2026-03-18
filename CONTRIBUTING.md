# Contributing

How to develop, test, and release Copilot Uplink.

## Development Setup

**Prerequisites:**
- Node.js 22.14+
- npm
- GitHub Copilot CLI (optional — the mock agent works without it)

**Get started:**

```bash
git clone https://github.com/denifia/copilot-uplink.git
cd copilot-uplink
npm install
```

## Running Locally

### With the Mock Agent (Recommended)

The mock agent simulates the Copilot CLI — no real Copilot installation needed.

**macOS / Linux:**
```bash
COPILOT_COMMAND="npx tsx src/mock/mock-agent.ts --acp --stdio" npm run dev
```

**Windows (PowerShell):**
```powershell
$env:COPILOT_COMMAND="npx tsx src/mock/mock-agent.ts --acp --stdio"
npm run dev
```

Vite serves the PWA with hot-reload. Changes to `src/client/` reflect instantly.

### With the Real Copilot CLI

Build and run directly:

```bash
npm run build
node dist/bin/cli.js --cwd /path/to/your/project
```

Or skip the build:

```bash
npx tsx bin/cli.ts --cwd /path/to/your/project
```

## Build

```bash
npm run build
```

This compiles TypeScript (`tsc`) and bundles the client (`vite build`).

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:e2e      # Playwright end-to-end tests
npm run test:all      # Lint + build + unit + e2e
```

### Test Structure

| Type | Location | Purpose |
|------|----------|---------|
| Unit | `test/unit/` | Bridge, ACP client, conversation state |
| Integration | `test/integration/` | Full WS client → bridge → mock agent flows |
| E2E | `test/e2e/` | Browser automation with Playwright |

All automated tests use the mock agent — no Copilot CLI required.

### Mock Agent Scenarios

The mock agent (`src/mock/mock-agent.ts`) simulates different behaviors based on prompt content:

| Prompt contains | Scenario |
|-----------------|----------|
| *(default)* | Simple text response |
| `tool` | Tool call flow |
| `permission` | Permission request |
| `stream` | Rapid multi-chunk streaming |
| `plan` | Plan + execution |
| `reason` | Thinking/reasoning mode |
| `refuse` | Refusal response |

## Linting

```bash
npm run lint:css      # Stylelint for CSS
```

## Releasing

Releases are automated via GitHub Actions with [trusted publishing](https://docs.npmjs.com/trusted-publishers).

**Steps:**

1. **Bump the version:**
   ```bash
   npm version patch  # or minor / major
   ```

2. **Push with tags:**
   ```bash
   git push && git push --tags
   ```

3. **Create a GitHub Release:**
   - Go to [Releases](https://github.com/denifia/copilot-uplink/releases)
   - Click **Draft a new release**
   - Select the tag
   - Add release notes
   - Click **Publish release**

4. The `publish.yml` workflow builds, tests, and publishes to npm automatically.

**Verify:** Check the [Actions tab](https://github.com/denifia/copilot-uplink/actions/workflows/publish.yml) and [npm package](https://www.npmjs.com/package/@denifia/copilot-uplink).

### Testing a Package Locally

Before releasing, you can test the packaged version:

```bash
npm pack
npm install -g ./denifia-copilot-uplink-*.tgz
copilot-uplink --help
```

## Code Style

- TypeScript throughout
- Preact for the PWA
- CSS with stylelint enforcement
- No comments unless they match existing style or explain complex logic
