package provider

import (
	"context"
	"encoding/json"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// Anthropic is a Provider backed by the Anthropic Messages API, streamed via
// the official Go SDK.
type Anthropic struct {
	client anthropic.Client
	models []Model
}

// NewAnthropic constructs an Anthropic provider. An empty baseURL uses the
// SDK's default API endpoint; a non-empty baseURL is used as-is (useful for
// proxies and tests).
func NewAnthropic(apiKey, baseURL string, models []Model) *Anthropic {
	opts := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}
	return &Anthropic{client: anthropic.NewClient(opts...), models: models}
}

func (a *Anthropic) Models() []Model { return a.models }

func toAnthropicMessages(msgs []Message) []anthropic.MessageParam {
	var out []anthropic.MessageParam
	for _, m := range msgs {
		switch m.Role {
		case RoleUser:
			out = append(out, anthropic.NewUserMessage(anthropic.NewTextBlock(m.Content)))
		case RoleAssistant:
			var blocks []anthropic.ContentBlockParamUnion
			if m.Content != "" {
				blocks = append(blocks, anthropic.NewTextBlock(m.Content))
			}
			for _, c := range m.ToolCalls {
				var input any
				json.Unmarshal(c.Input, &input)
				blocks = append(blocks, anthropic.NewToolUseBlock(c.ID, input, c.Name))
			}
			out = append(out, anthropic.NewAssistantMessage(blocks...))
		case RoleTool:
			out = append(out, anthropic.NewUserMessage(
				anthropic.NewToolResultBlock(m.ToolCallID, m.Content, m.IsError)))
		}
	}
	return out
}

func toAnthropicTools(defs []ToolDef) []anthropic.ToolUnionParam {
	var out []anthropic.ToolUnionParam
	for _, d := range defs {
		var schema struct {
			Properties map[string]any `json:"properties"`
			Required   []string       `json:"required"`
		}
		json.Unmarshal(d.Schema, &schema)
		out = append(out, anthropic.ToolUnionParam{OfTool: &anthropic.ToolParam{
			Name:        d.Name,
			Description: anthropic.String(d.Description),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: schema.Properties, Required: schema.Required},
		}})
	}
	return out
}

// Stream implements Provider. It issues a streaming Messages.NewStreaming
// call and translates SDK stream events into the provider Event contract:
// text deltas are emitted immediately, tool calls are emitted once complete
// (after the accumulated message finishes), followed by a final EventDone
// carrying usage. Any stream/accumulation error is surfaced as EventError.
func (a *Anthropic) Stream(ctx context.Context, req Request) (<-chan Event, error) {
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(req.Model),
		MaxTokens: int64(req.MaxTokens),
		Messages:  toAnthropicMessages(req.Messages),
		Tools:     toAnthropicTools(req.Tools),
	}
	if req.System != "" {
		params.System = []anthropic.TextBlockParam{{Text: req.System}}
	}

	ch := make(chan Event)
	go func() {
		defer close(ch)
		stream := a.client.Messages.NewStreaming(ctx, params)
		defer stream.Close()

		message := anthropic.Message{}
		for stream.Next() {
			event := stream.Current()
			if err := message.Accumulate(event); err != nil {
				ch <- Event{Kind: EventError, Err: err}
				return
			}
			if event.Type == "content_block_delta" && event.Delta.Text != "" {
				ch <- Event{Kind: EventTextDelta, Text: event.Delta.Text}
			}
		}
		if err := stream.Err(); err != nil {
			ch <- Event{Kind: EventError, Err: err}
			return
		}

		for _, block := range message.Content {
			if tu, ok := block.AsAny().(anthropic.ToolUseBlock); ok {
				ch <- Event{Kind: EventToolCall, ToolCall: &ToolCall{
					ID:    tu.ID,
					Name:  tu.Name,
					Input: json.RawMessage(tu.Input),
				}}
			}
		}

		ch <- Event{Kind: EventDone, Usage: Usage{
			InputTokens:  int(message.Usage.InputTokens),
			OutputTokens: int(message.Usage.OutputTokens),
		}}
	}()
	return ch, nil
}
