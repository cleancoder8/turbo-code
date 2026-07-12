package tool

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mustRun(t *testing.T, tl Tool, params string) Result {
	t.Helper()
	res, err := tl.Run(context.Background(), json.RawMessage(params))
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func fixtureDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "sub"), 0o755)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("line1\nline2\nline3\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "sub", "b.go"), []byte("package sub\n"), 0o644)
	return dir
}

func TestRead(t *testing.T) {
	dir := fixtureDir(t)
	res := mustRun(t, Read{}, `{"file_path": "`+filepath.Join(dir, "a.txt")+`"}`)
	if !strings.Contains(res.Content, "1\tline1") || !strings.Contains(res.Content, "3\tline3") {
		t.Fatalf("content: %q", res.Content)
	}
	res = mustRun(t, Read{}, `{"file_path": "`+filepath.Join(dir, "nope")+`"}`)
	if !res.IsError {
		t.Fatal("missing file should be IsError")
	}
}

func TestLs(t *testing.T) {
	dir := fixtureDir(t)
	res := mustRun(t, Ls{}, `{"path": "`+dir+`"}`)
	if !strings.Contains(res.Content, "a.txt") || !strings.Contains(res.Content, "sub/") {
		t.Fatalf("content: %q", res.Content)
	}
}

func TestGlob(t *testing.T) {
	dir := fixtureDir(t)
	res := mustRun(t, Glob{}, `{"pattern": "**/*.go", "path": "`+dir+`"}`)
	if !strings.Contains(res.Content, filepath.Join("sub", "b.go")) {
		t.Fatalf("content: %q", res.Content)
	}
}
