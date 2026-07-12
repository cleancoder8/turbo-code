package config

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadMergesProjectOverGlobal(t *testing.T) {
	dir := t.TempDir()
	global := write(t, dir, "global.json", `{
		"default_model": "claude-sonnet-5",
		"providers": {
			"anthropic": {"type": "anthropic", "api_key_env": "ANTHROPIC_API_KEY",
				"models": [{"id": "claude-sonnet-5", "max_tokens": 8192}]}
		}}`)
	project := write(t, dir, "project.json", `{
		"default_model": "gw-model",
		"providers": {
			"gateway": {"type": "openai-compat", "base_url": "https://llm.internal/v1",
				"api_key_env": "GW_TOKEN", "models": [{"id": "gw-model", "max_tokens": 4096}]}
		}}`)
	c, err := Load(global, project)
	if err != nil {
		t.Fatal(err)
	}
	if c.DefaultModel != "gw-model" {
		t.Fatalf("default_model = %q, want gw-model", c.DefaultModel)
	}
	if len(c.Providers) != 2 {
		t.Fatalf("providers = %d, want 2", len(c.Providers))
	}
	name, pc, mc, err := c.FindModel("gw-model")
	if err != nil || name != "gateway" || pc.Type != "openai-compat" || mc.MaxTokens != 4096 {
		t.Fatalf("FindModel: %v %v %v %v", name, pc, mc, err)
	}
}

func TestLoadMissingFilesOK(t *testing.T) {
	c, err := Load("/nonexistent/a.json", "/nonexistent/b.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := c.FindModel("nope"); err == nil {
		t.Fatal("want error for unknown model")
	}
}
