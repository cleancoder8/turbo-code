package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type Read struct{}

func (Read) Name() string { return "read" }
func (Read) Description() string {
	return "Read a file with line numbers. Params: file_path, optional offset (1-based line) and limit."
}
func (Read) Mutating() bool { return false }
func (Read) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{
		"file_path":{"type":"string"},
		"offset":{"type":"integer"},
		"limit":{"type":"integer"}},
		"required":["file_path"]}`)
}

func (Read) Run(ctx context.Context, params json.RawMessage) (Result, error) {
	var p struct {
		FilePath string `json:"file_path"`
		Offset   int    `json:"offset"`
		Limit    int    `json:"limit"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return Result{Content: "invalid params: " + err.Error(), IsError: true}, nil
	}
	b, err := os.ReadFile(p.FilePath)
	if err != nil {
		return Result{Content: err.Error(), IsError: true}, nil
	}
	lines := strings.Split(strings.TrimSuffix(string(b), "\n"), "\n")
	start := p.Offset
	if start < 1 {
		start = 1
	}
	limit := p.Limit
	if limit <= 0 {
		limit = 2000
	}
	var sb strings.Builder
	for i := start - 1; i < len(lines) && i < start-1+limit; i++ {
		fmt.Fprintf(&sb, "%6d\t%s\n", i+1, lines[i])
	}
	return Result{Content: sb.String()}, nil
}
