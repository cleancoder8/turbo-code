package tool

import (
	"context"
	"encoding/json"

	"turbo-code/internal/provider"
)

type Result struct {
	Content string
	IsError bool
}

type Tool interface {
	Name() string
	Description() string
	Schema() json.RawMessage
	Mutating() bool
	Run(ctx context.Context, params json.RawMessage) (Result, error)
}

type Registry struct {
	tools map[string]Tool
	order []string
}

func NewRegistry(tools ...Tool) *Registry {
	r := &Registry{tools: map[string]Tool{}}
	for _, t := range tools {
		r.tools[t.Name()] = t
		r.order = append(r.order, t.Name())
	}
	return r
}

func (r *Registry) Get(name string) (Tool, bool) {
	t, ok := r.tools[name]
	return t, ok
}

func (r *Registry) Defs() []provider.ToolDef {
	defs := make([]provider.ToolDef, 0, len(r.order))
	for _, name := range r.order {
		t := r.tools[name]
		defs = append(defs, provider.ToolDef{Name: t.Name(), Description: t.Description(), Schema: t.Schema()})
	}
	return defs
}
