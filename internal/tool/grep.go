package tool

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Grep struct{}

func (Grep) Name() string { return "grep" }
func (Grep) Description() string {
	return "Search file contents with a Go regex. Params: pattern, optional path (default cwd). Output: path:line: text."
}
func (Grep) Mutating() bool { return false }
func (Grep) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{
		"pattern":{"type":"string"},"path":{"type":"string"}},"required":["pattern"]}`)
}

var grepSkipDirs = map[string]bool{".git": true, "node_modules": true, "vendor": true}

func (Grep) Run(ctx context.Context, params json.RawMessage) (Result, error) {
	var p struct {
		Pattern string `json:"pattern"`
		Path    string `json:"path"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return Result{Content: "invalid params: " + err.Error(), IsError: true}, nil
	}
	re, err := regexp.Compile(p.Pattern)
	if err != nil {
		return Result{Content: "bad regex: " + err.Error(), IsError: true}, nil
	}
	root := p.Path
	if root == "" {
		root = "."
	}
	var sb strings.Builder
	count := 0
	filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || count >= 200 {
			return fs.SkipAll
		}
		if d.IsDir() {
			if grepSkipDirs[d.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil || bytes.IndexByte(b, 0) >= 0 { // skip unreadable/binary
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		for i, line := range strings.Split(string(b), "\n") {
			if re.MatchString(line) {
				fmt.Fprintf(&sb, "%s:%d: %s\n", rel, i+1, line)
				count++
				if count >= 200 {
					break
				}
			}
		}
		return nil
	})
	return Result{Content: sb.String()}, nil
}
