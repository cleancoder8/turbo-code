package tool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func jstr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestWriteCreatesDirsAndFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "new", "file.txt")
	res := mustRun(t, Write{}, `{"file_path": `+jstr(p)+`, "content": "hello"}`)
	if res.IsError {
		t.Fatalf("unexpected error: %s", res.Content)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "hello" {
		t.Fatalf("content %q", b)
	}
}

func TestEdit(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f.txt")
	os.WriteFile(p, []byte("aaa bbb aaa"), 0o644)

	res := mustRun(t, Edit{}, `{"file_path": `+jstr(p)+`, "old_string": "bbb", "new_string": "xxx"}`)
	if res.IsError {
		t.Fatalf("unexpected error: %s", res.Content)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "aaa xxx aaa" {
		t.Fatalf("content %q", b)
	}

	res = mustRun(t, Edit{}, `{"file_path": `+jstr(p)+`, "old_string": "aaa", "new_string": "y"}`)
	if !res.IsError {
		t.Fatal("ambiguous old_string must be IsError")
	}
	res = mustRun(t, Edit{}, `{"file_path": `+jstr(p)+`, "old_string": "zzz", "new_string": "y"}`)
	if !res.IsError {
		t.Fatal("missing old_string must be IsError")
	}
}
