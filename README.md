# turbo-code

A terminal coding agent powered by GitHub Copilot. The TypeScript harness uses the official [Copilot SDK](https://github.com/github/copilot-sdk) and the user's Copilot sign-in. It supports Copilot models only.

## Setup

1. Use Node.js 20.19+ or 22.12+ (`nvm install && nvm use` selects the version in `.nvmrc`).
2. Sign in to GitHub Copilot with the `copilot` CLI, or provide a supported GitHub token through `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`.
3. Run `npm ci && npm run build`, then `node dist/cli.js` in the project you want to work on.

The model defaults to Copilot's `auto` selection. An optional global config at `~/.config/turbo-code/config.json` or project config at `turbo-code.json` can select a Copilot model:

```json
{
  "model": "auto",
  "lsp": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    }
  }
}
```

The project config overrides the global config. LSP entries merge by name; setting an entry to `false` disables it. Language servers are optional and require an installed command. The TUI asks permission before starting one. Set `context_window` to a known token capacity if you want a context percentage in the sidebar.

## Usage

- `node dist/cli.js` — new Copilot session
- `node dist/cli.js --model <copilot-model-id>` — select a Copilot model
- `node dist/cli.js --continue` — resume the latest Copilot session
- `node dist/cli.js sessions` — list Copilot sessions

In the TUI, Enter sends, Ctrl+X cancels the current turn, Ctrl+C quits, and Ctrl+B toggles the token/LSP sidebar. Permission prompts use Left/Right to select, Enter to confirm, and Escape to reject. You can also use `y` for once, `a` for the session, and `n` to reject. Always-allow requests require a second confirmation; Up/Down scroll long request details.

The tools are `read`, `ls`, `glob`, `grep`, `write`, `edit`, and `bash`. Tool calls run through the Copilot SDK and retain turbo-code's permission prompts for mutating operations.

## Direct model transport probe

`npm run probe:copilot` checks direct Copilot model discovery without changing the chat harness. `npm run probe:copilot -- --roundtrip` attempts a streamed `probe_echo` tool call and feeds its harmless local result back to the model. Choose a model with `--model <id>`. The probe takes `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`, falling back to `gh auth token`; it never prints the token. The round trip makes two model requests and may use Copilot credits.

Model discovery does not guarantee inference access. On the account used to develop this probe, `gh auth token` listed models but direct chat requests returned `400 model_not_supported`. The [transport milestone](docs/cross-harness-roadmap.md) remains open until authentication, streaming, and the tool round trip succeed with turbo-code's own supported login. The normal SDK-backed chat path is unchanged.

Local transcript and usage files are stored under `~/.local/share/turbo-code/sessions/`. Copilot keeps its own agent session state under `~/.copilot/`. Earlier non-Copilot turbo-code sessions remain on disk but are not listed or resumed by the Copilot-only CLI.
