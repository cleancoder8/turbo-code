# turbo-code

Company-internal terminal coding agent. Single Go binary.

## Setup

1. `make build`
2. Create `~/.config/turbo-code/config.json`:

```json
{
  "default_model": "claude-sonnet-5",
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "api_key_env": "ANTHROPIC_API_KEY",
      "models": [{"id": "claude-sonnet-5", "max_tokens": 8192}]
    },
    "gateway": {
      "type": "openai-compat",
      "base_url": "https://llm.company.internal/v1",
      "api_key_env": "GATEWAY_TOKEN",
      "models": [{"id": "gw-model", "max_tokens": 8192}]
    }
  }
}
```

3. Export the API key env var and run `./turbo-code` in a project directory.

## Usage

- `turbo-code` — new session
- `turbo-code --model <id>` — pick a configured model
- `turbo-code --continue` — resume last session
- `turbo-code sessions` — list sessions
- In the TUI: `enter` send, `alt+enter` newline, `ctrl+c` quit;
  permission prompts: `y` once / `a` always / `n` deny.

A project-local `turbo-code.json` overrides the global config.
