package config

import (
	"encoding/json"
	"fmt"
	"os"
)

type ModelConfig struct {
	ID        string `json:"id"`
	MaxTokens int    `json:"max_tokens"`
}

type ProviderConfig struct {
	Type      string        `json:"type"`
	BaseURL   string        `json:"base_url,omitempty"`
	APIKeyEnv string        `json:"api_key_env"`
	Models    []ModelConfig `json:"models"`
}

type Config struct {
	DefaultModel string                    `json:"default_model"`
	Providers    map[string]ProviderConfig `json:"providers"`
}

func readFile(path string, c *Config) error {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return json.Unmarshal(b, c)
}

func Load(globalPath, projectPath string) (*Config, error) {
	out := &Config{Providers: map[string]ProviderConfig{}}
	var g, p Config
	if err := readFile(globalPath, &g); err != nil {
		return nil, fmt.Errorf("global config: %w", err)
	}
	if err := readFile(projectPath, &p); err != nil {
		return nil, fmt.Errorf("project config: %w", err)
	}
	out.DefaultModel = g.DefaultModel
	if p.DefaultModel != "" {
		out.DefaultModel = p.DefaultModel
	}
	for k, v := range g.Providers {
		out.Providers[k] = v
	}
	for k, v := range p.Providers {
		out.Providers[k] = v
	}
	return out, nil
}

func (c *Config) FindModel(id string) (string, ProviderConfig, ModelConfig, error) {
	for name, pc := range c.Providers {
		for _, mc := range pc.Models {
			if mc.ID == id {
				return name, pc, mc, nil
			}
		}
	}
	return "", ProviderConfig{}, ModelConfig{}, fmt.Errorf("model %q not found in config", id)
}
