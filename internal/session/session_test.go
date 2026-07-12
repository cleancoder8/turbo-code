package session

import (
	"os"
	"path/filepath"
	"testing"

	"turbo-code/internal/provider"
)

func TestCreateAppendLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := Create(dir, "test session")
	if err != nil {
		t.Fatal(err)
	}
	s.Append(provider.Message{Role: provider.RoleUser, Content: "hi"})
	s.Append(provider.Message{Role: provider.RoleAssistant, Content: "hello"})
	s.Close()

	loaded, err := Load(dir, s.Meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Meta.Title != "test session" || len(loaded.Messages) != 2 {
		t.Fatalf("loaded: %+v", loaded)
	}
	if loaded.Messages[1].Content != "hello" {
		t.Fatalf("msg: %+v", loaded.Messages[1])
	}
}

func TestLoadSkipsCorruptTrailingLine(t *testing.T) {
	dir := t.TempDir()
	s, _ := Create(dir, "t")
	s.Append(provider.Message{Role: provider.RoleUser, Content: "hi"})
	s.Close()
	path := filepath.Join(dir, s.Meta.ID+".jsonl")
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	f.WriteString(`{"role":"assist`) // simulated crash mid-write
	f.Close()

	loaded, err := Load(dir, s.Meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Messages) != 1 {
		t.Fatalf("want 1 message, got %d", len(loaded.Messages))
	}
}

func TestListNewestFirst(t *testing.T) {
	dir := t.TempDir()
	a, _ := Create(dir, "a")
	a.Close()
	b, _ := Create(dir, "b")
	b.Close()
	metas, err := List(dir)
	if err != nil || len(metas) != 2 {
		t.Fatalf("metas %v err %v", metas, err)
	}
	if metas[0].ID < metas[1].ID {
		t.Fatal("want newest first")
	}
}
