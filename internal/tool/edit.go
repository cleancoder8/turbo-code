package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type Edit struct{}

func (Edit) Name() string { return "edit" }
func (Edit) Description() string {
	return "Replace an exact unique string in a file. Params: file_path, old_string, new_string."
}
func (Edit) Mutating() bool { return true }
func (Edit) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{
		"file_path":{"type":"string"},"old_string":{"type":"string"},"new_string":{"type":"string"}},
		"required":["file_path","old_string","new_string"]}`)
}

func (Edit) Run(ctx context.Context, params json.RawMessage) (Result, error) {
	var p struct {
		FilePath  string `json:"file_path"`
		OldString string `json:"old_string"`
		NewString string `json:"new_string"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return Result{Content: "invalid params: " + err.Error(), IsError: true}, nil
	}
	b, err := os.ReadFile(p.FilePath)
	if err != nil {
		return Result{Content: err.Error(), IsError: true}, nil
	}
	s := string(b)
	switch n := strings.Count(s, p.OldString); {
	case n == 0:
		return Result{Content: "old_string not found in file", IsError: true}, nil
	case n > 1:
		return Result{Content: fmt.Sprintf("old_string appears %d times; must be unique", n), IsError: true}, nil
	}
	s = strings.Replace(s, p.OldString, p.NewString, 1)
	if err := os.WriteFile(p.FilePath, []byte(s), 0o644); err != nil {
		return Result{Content: err.Error(), IsError: true}, nil
	}
	return Result{Content: "edited " + p.FilePath}, nil
}
