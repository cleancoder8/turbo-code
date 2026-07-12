package tool

import (
	"context"
	"encoding/json"
	"os"
	"strings"
)

type Ls struct{}

func (Ls) Name() string { return "ls" }
func (Ls) Description() string {
	return "List directory entries. Params: path. Directories end with /."
}
func (Ls) Mutating() bool { return false }
func (Ls) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}`)
}

func (Ls) Run(ctx context.Context, params json.RawMessage) (Result, error) {
	var p struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return Result{Content: "invalid params: " + err.Error(), IsError: true}, nil
	}
	entries, err := os.ReadDir(p.Path)
	if err != nil {
		return Result{Content: err.Error(), IsError: true}, nil
	}
	var sb strings.Builder
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			name += "/"
		}
		sb.WriteString(name + "\n")
	}
	return Result{Content: sb.String()}, nil
}
