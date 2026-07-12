package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

const anthropicSSE = `event: message_start
data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"m","usage":{"input_tokens":10,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"read","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\":\"a.txt\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}

event: message_stop
data: {"type":"message_stop"}

`

func TestAnthropicStream(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte(anthropicSSE))
	}))
	defer srv.Close()

	p := NewAnthropic("test-key", srv.URL, []Model{{ID: "m", MaxTokens: 8192}})
	ch, err := p.Stream(context.Background(), Request{
		Model: "m", MaxTokens: 100,
		Messages: []Message{{Role: RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var text string
	var calls []ToolCall
	var done bool
	var usage Usage
	for ev := range ch {
		switch ev.Kind {
		case EventTextDelta:
			text += ev.Text
		case EventToolCall:
			calls = append(calls, *ev.ToolCall)
		case EventDone:
			done = true
			usage = ev.Usage
		case EventError:
			t.Fatal(ev.Err)
		}
	}
	if text != "hello" || !done {
		t.Fatalf("text=%q done=%v", text, done)
	}
	if len(calls) != 1 || calls[0].ID != "tu_1" || calls[0].Name != "read" || string(calls[0].Input) != `{"file_path":"a.txt"}` {
		t.Fatalf("calls: %+v", calls)
	}
	if usage.OutputTokens != 7 {
		t.Fatalf("usage: %+v", usage)
	}
}
