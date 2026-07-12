package tool

import (
	"context"
	"encoding/json"
	"os"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
)

type Glob struct{}

func (Glob) Name() string { return "glob" }
func (Glob) Description() string {
	return "Find files by glob pattern (** supported). Params: pattern, optional path (default cwd)."
}
func (Glob) Mutating() bool { return false }
func (Glob) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{
		"pattern":{"type":"string"},"path":{"type":"string"}},"required":["pattern"]}`)
}

func (Glob) Run(ctx context.Context, params json.RawMessage) (Result, error) {
	var p struct {
		Pattern string `json:"pattern"`
		Path    string `json:"path"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return Result{Content: "invalid params: " + err.Error(), IsError: true}, nil
	}
	root := p.Path
	if root == "" {
		root = "."
	}
	matches, err := doublestar.Glob(os.DirFS(root), p.Pattern)
	if err != nil {
		return Result{Content: err.Error(), IsError: true}, nil
	}
	if len(matches) > 500 {
		matches = matches[:500]
	}
	return Result{Content: strings.Join(matches, "\n")}, nil
}
