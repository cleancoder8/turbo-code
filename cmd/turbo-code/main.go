package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"turbo-code/internal/agent"
	"turbo-code/internal/config"
	"turbo-code/internal/permission"
	"turbo-code/internal/provider"
	"turbo-code/internal/session"
	"turbo-code/internal/tool"
	"turbo-code/internal/tui"
)

func dataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "turbo-code")
}

func sessionsDir() string { return filepath.Join(dataDir(), "sessions") }

func configPaths() (string, string) {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "turbo-code", "config.json"), "turbo-code.json"
}

func buildProvider(pc config.ProviderConfig) (provider.Provider, error) {
	apiKey := os.Getenv(pc.APIKeyEnv)
	if apiKey == "" {
		return nil, fmt.Errorf("env var %s is empty (required by provider config)", pc.APIKeyEnv)
	}
	var models []provider.Model
	for _, m := range pc.Models {
		models = append(models, provider.Model{ID: m.ID, MaxTokens: m.MaxTokens})
	}
	switch pc.Type {
	case "anthropic":
		return provider.NewAnthropic(apiKey, pc.BaseURL, models), nil
	case "openai-compat":
		return provider.NewOpenAICompat(apiKey, pc.BaseURL, models), nil
	default:
		return nil, fmt.Errorf("unknown provider type %q", pc.Type)
	}
}

func main() {
	modelFlag := flag.String("model", "", "model id from config (default: config default_model)")
	continueFlag := flag.Bool("continue", false, "resume most recent session")
	flag.Parse()

	globalCfg, projectCfg := configPaths()
	cfg, err := config.Load(globalCfg, projectCfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "config error:", err)
		os.Exit(1)
	}

	if flag.Arg(0) == "sessions" {
		metas, err := session.List(sessionsDir())
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		for _, m := range metas {
			fmt.Printf("%s  %s  %s\n", m.ID, m.Created.Format("2006-01-02 15:04"), m.Title)
		}
		return
	}

	modelID := cfg.DefaultModel
	if *modelFlag != "" {
		modelID = *modelFlag
	}
	if modelID == "" {
		fmt.Fprintln(os.Stderr, "no model: set default_model in config or pass --model")
		os.Exit(1)
	}
	_, pc, mc, err := cfg.FindModel(modelID)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	prov, err := buildProvider(pc)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	var sess *session.Session
	if *continueFlag {
		metas, _ := session.List(sessionsDir())
		if len(metas) == 0 {
			fmt.Fprintln(os.Stderr, "no session to continue")
			os.Exit(1)
		}
		sess, err = session.Load(sessionsDir(), metas[0].ID)
	} else {
		cwd, _ := os.Getwd()
		sess, err = session.Create(sessionsDir(), filepath.Base(cwd))
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "session error:", err)
		os.Exit(1)
	}
	defer sess.Close()

	maxTokens := mc.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 8192
	}
	ag := &agent.Agent{
		Provider: prov, Model: modelID, MaxTokens: maxTokens,
		System: agent.DefaultSystemPrompt,
		Tools: tool.NewRegistry(
			tool.Read{}, tool.Ls{}, tool.Glob{}, tool.Grep{},
			tool.Write{}, tool.Edit{}, tool.Bash{},
		),
		Perms:   permission.New(func(permission.Request) permission.Decision { return permission.Deny }),
		Session: sess,
	}
	// tui.Run replaces Perms with the interactive asker before starting.
	if err := tui.Run(ag, modelID, sess.Meta.ID); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
