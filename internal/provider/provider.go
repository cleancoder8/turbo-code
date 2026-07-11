package provider

import (
	"context"
	"encoding/json"
)

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

type ToolCall struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type Message struct {
	Role       Role       `json:"role"`
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"` // assistant only
	ToolCallID string     `json:"tool_call_id,omitempty"` // RoleTool only
	IsError    bool       `json:"is_error,omitempty"`      // RoleTool only
}

type ToolDef struct {
	Name        string
	Description string
	Schema      json.RawMessage
}

type Request struct {
	Model     string
	System    string
	Messages  []Message
	Tools     []ToolDef
	MaxTokens int
}

type EventKind int

const (
	EventTextDelta EventKind = iota
	EventToolCall // one COMPLETE tool call (providers accumulate deltas internally)
	EventDone
	EventError
)

type Usage struct {
	InputTokens  int
	OutputTokens int
}

type Event struct {
	Kind     EventKind
	Text     string    // EventTextDelta
	ToolCall *ToolCall // EventToolCall
	Usage    Usage     // EventDone
	Err      error     // EventError
}

type Model struct {
	ID        string
	MaxTokens int
}

type Provider interface {
	Stream(ctx context.Context, req Request) (<-chan Event, error)
	Models() []Model
}
