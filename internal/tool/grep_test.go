package tool

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGrep(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".git"), 0o755)
	os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main\nfunc Target() {}\n"), 0o644)
	os.WriteFile(filepath.Join(dir, ".git", "junk"), []byte("Target\n"), 0o644)

	res := mustRun(t, Grep{}, `{"pattern": "Target", "path": "`+dir+`"}`)
	if !strings.Contains(res.Content, "main.go:2:") {
		t.Fatalf("missing match: %q", res.Content)
	}
	if strings.Contains(res.Content, ".git") {
		t.Fatalf(".git not skipped: %q", res.Content)
	}

	res = mustRun(t, Grep{}, `{"pattern": "([", "path": "`+dir+`"}`)
	if !res.IsError {
		t.Fatal("bad regex should be IsError")
	}
}
