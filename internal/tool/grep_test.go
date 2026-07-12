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

	res = mustRun(t, Grep{}, `{"pattern": "x", "path": "`+filepath.Join(dir, "does-not-exist")+`"}`)
	if !res.IsError {
		t.Fatal("nonexistent path should be IsError")
	}
}

func TestGrepUnreadableRoot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root; permission bits are ignored")
	}
	dir := t.TempDir()
	locked := filepath.Join(dir, "locked")
	if err := os.Mkdir(locked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(locked, 0o000); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(locked, 0o755)

	res := mustRun(t, Grep{}, `{"pattern": "x", "path": "`+locked+`"}`)
	if !res.IsError {
		t.Fatalf("unreadable root dir should be IsError, got %q", res.Content)
	}
}
