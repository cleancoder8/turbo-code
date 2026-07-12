package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Write struct{}

func (Write) Name() string { return "write" }
func (Write) Description() string {
	return "Write a file (creates parent dirs, overwrites). Params: file_path, content."
}
func (Write) Mutating() bool { return true }
func (Write) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{
		"file_path":{"type":"string"},"content":{"type":"string"}},
		"required":["file_path","content"]}`)
}

func (Write) Run(ctx context.Context, params json.RawMessage) (Result, error) {
	var p struct {
		FilePath string `json:"file_path"`
		Content  string `json:"content"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return Result{Content: "invalid params: " + err.Error(), IsError: true}, nil
	}
	if err := os.MkdirAll(filepath.Dir(p.FilePath), 0o755); err != nil {
		return Result{Content: err.Error(), IsError: true}, nil
	}
	if err := os.WriteFile(p.FilePath, []byte(p.Content), 0o644); err != nil {
		return Result{Content: err.Error(), IsError: true}, nil
	}
	return Result{Content: fmt.Sprintf("wrote %d bytes to %s", len(p.Content), p.FilePath)}, nil
}
