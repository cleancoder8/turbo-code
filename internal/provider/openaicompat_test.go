package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const openaiSSE = `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hel"}}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"lo"}}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{\"file_path\":"}}]}}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.txt\"}"}}]}}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":7,"total_tokens":17}}

data: [DONE]

`

func TestOpenAICompatStream(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte(openaiSSE))
	}))
	defer srv.Close()

	p := NewOpenAICompat("test-key", srv.URL, []Model{{ID: "m", MaxTokens: 8192}})
	ch, err := p.Stream(context.Background(), Request{
		Model: "m", MaxTokens: 100,
		Messages: []Message{{Role: RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var text string
	var calls []ToolCall
	for ev := range ch {
		switch ev.Kind {
		case EventTextDelta:
			text += ev.Text
		case EventToolCall:
			calls = append(calls, *ev.ToolCall)
		case EventError:
			t.Fatal(ev.Err)
		}
	}
	if text != "hello" {
		t.Fatalf("text=%q", text)
	}
	if len(calls) != 1 || calls[0].ID != "call_1" || calls[0].Name != "read" || string(calls[0].Input) != `{"file_path":"a.txt"}` {
		t.Fatalf("calls: %+v", calls)
	}
}

func TestOpenAICompatStreamMalformedToolSchema(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("server should not be called for a malformed request")
	}))
	defer srv.Close()

	p := NewOpenAICompat("test-key", srv.URL, []Model{{ID: "m", MaxTokens: 8192}})
	ch, err := p.Stream(context.Background(), Request{
		Model: "m", MaxTokens: 100,
		Messages: []Message{{Role: RoleUser, Content: "hi"}},
		Tools: []ToolDef{{
			Name:   "bad",
			Schema: json.RawMessage("{not json"),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var gotErr bool
	for ev := range ch {
		if ev.Kind == EventError {
			gotErr = true
			if ev.Err == nil {
				t.Fatal("expected non-nil Err on EventError")
			}
		}
	}
	if !gotErr {
		t.Fatal("expected EventError for malformed tool schema JSON")
	}
}
