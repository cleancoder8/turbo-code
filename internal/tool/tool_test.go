package tool

import (
	"context"
	"encoding/json"
	"testing"
)

type stub struct{ name string }

func (s stub) Name() string            { return s.name }
func (s stub) Description() string     { return "stub tool" }
func (s stub) Schema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (s stub) Mutating() bool          { return false }
func (s stub) Run(ctx context.Context, p json.RawMessage) (Result, error) {
	return Result{Content: "ok"}, nil
}

func TestRegistry(t *testing.T) {
	r := NewRegistry(stub{"a"}, stub{"b"})
	if _, ok := r.Get("a"); !ok {
		t.Fatal("a not found")
	}
	if _, ok := r.Get("zzz"); ok {
		t.Fatal("zzz should not exist")
	}
	defs := r.Defs()
	if len(defs) != 2 || defs[0].Name != "a" || defs[1].Name != "b" {
		t.Fatalf("defs wrong: %+v", defs)
	}
}
