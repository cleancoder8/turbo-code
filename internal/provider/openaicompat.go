package provider

import (
	"context"
	"encoding/json"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

// OpenAICompat is a Provider backed by the OpenAI Chat Completions API,
// streamed via the official Go SDK. It covers both OpenAI direct (empty
// baseURL) and OpenAI-compatible gateways (custom baseURL).
type OpenAICompat struct {
	client openai.Client
	models []Model
}

// NewOpenAICompat constructs an OpenAICompat provider. An empty baseURL uses
// the SDK's default API endpoint; a non-empty baseURL is used as-is (useful
// for internal gateways and tests).
func NewOpenAICompat(apiKey, baseURL string, models []Model) *OpenAICompat {
	opts := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}
	return &OpenAICompat{client: openai.NewClient(opts...), models: models}
}

func (o *OpenAICompat) Models() []Model { return o.models }

// toOpenAIMessages converts domain messages to SDK params. It returns an
// error rather than silently dropping malformed tool-call input JSON, so
// callers can surface a proper EventError instead of sending a malformed
// request to the API.
func toOpenAIMessages(system string, msgs []Message) ([]openai.ChatCompletionMessageParamUnion, error) {
	var out []openai.ChatCompletionMessageParamUnion
	if system != "" {
		out = append(out, openai.SystemMessage(system))
	}
	for _, m := range msgs {
		switch m.Role {
		case RoleUser:
			out = append(out, openai.UserMessage(m.Content))
		case RoleAssistant:
			asst := openai.ChatCompletionAssistantMessageParam{}
			if m.Content != "" {
				asst.Content.OfString = openai.String(m.Content)
			}
			for _, c := range m.ToolCalls {
				// Round-trip through json.Unmarshal/Marshal so a malformed
				// Input surfaces as an error here rather than being sent to
				// the API as a literal (and likely invalid) string.
				var input any
				if err := json.Unmarshal(c.Input, &input); err != nil {
					return nil, err
				}
				asst.ToolCalls = append(asst.ToolCalls, openai.ChatCompletionMessageToolCallParam{
					ID: c.ID,
					Function: openai.ChatCompletionMessageToolCallFunctionParam{
						Name:      c.Name,
						Arguments: string(c.Input),
					},
				})
			}
			out = append(out, openai.ChatCompletionMessageParamUnion{OfAssistant: &asst})
		case RoleTool:
			out = append(out, openai.ToolMessage(m.Content, m.ToolCallID))
		}
	}
	return out, nil
}

// toOpenAITools converts domain tool definitions to SDK params. It returns
// an error rather than silently dropping a malformed schema, so callers can
// surface a proper EventError instead of sending a malformed request to the
// API.
func toOpenAITools(defs []ToolDef) ([]openai.ChatCompletionToolParam, error) {
	var out []openai.ChatCompletionToolParam
	for _, d := range defs {
		var params map[string]any
		if err := json.Unmarshal(d.Schema, &params); err != nil {
			return nil, err
		}
		out = append(out, openai.ChatCompletionToolParam{
			Function: openai.FunctionDefinitionParam{
				Name:        d.Name,
				Description: openai.String(d.Description),
				Parameters:  params,
			},
		})
	}
	return out, nil
}

// Stream implements Provider. It issues a streaming chat completion call and
// translates SDK chunks into the provider Event contract: text deltas are
// emitted immediately, tool calls are emitted once complete (via the SDK
// accumulator's JustFinishedToolCall, deduped by ID), followed by a final
// EventDone carrying usage. Any stream/accumulation error is surfaced as
// EventError.
func (o *OpenAICompat) Stream(ctx context.Context, req Request) (<-chan Event, error) {
	messages, err := toOpenAIMessages(req.System, req.Messages)
	if err != nil {
		return errorChan(ctx, err), nil
	}
	tools, err := toOpenAITools(req.Tools)
	if err != nil {
		return errorChan(ctx, err), nil
	}

	params := openai.ChatCompletionNewParams{
		Model:               openai.ChatModel(req.Model),
		Messages:            messages,
		Tools:               tools,
		MaxCompletionTokens: openai.Int(int64(req.MaxTokens)),
	}

	ch := make(chan Event)
	go func() {
		defer close(ch)
		stream := o.client.Chat.Completions.NewStreaming(ctx, params)
		defer stream.Close()

		acc := openai.ChatCompletionAccumulator{}
		emitted := map[string]bool{} // tool-call IDs already sent
		for stream.Next() {
			chunk := stream.Current()
			acc.AddChunk(chunk)

			if tc, ok := acc.JustFinishedToolCall(); ok && !emitted[tc.ID] {
				emitted[tc.ID] = true
				if !emit(ctx, ch, Event{Kind: EventToolCall, ToolCall: &ToolCall{
					ID: tc.ID, Name: tc.Name, Input: json.RawMessage(tc.Arguments),
				}}) {
					return
				}
			}
			if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				if !emit(ctx, ch, Event{Kind: EventTextDelta, Text: chunk.Choices[0].Delta.Content}) {
					return
				}
			}
		}
		if err := stream.Err(); err != nil {
			emit(ctx, ch, Event{Kind: EventError, Err: err})
			return
		}

		// JustFinishedToolCall only fires on the chunk boundary following a
		// tool call's completion. When a call's last argument delta shares a
		// chunk with finish_reason, there is no subsequent chunk to trigger
		// it, so it never fires and the call would otherwise be dropped.
		// The fully accumulated message (acc.Choices[0].Message.ToolCalls)
		// always contains every completed call, so flush any not already
		// emitted here.
		if len(acc.Choices) > 0 {
			for _, tc := range acc.Choices[0].Message.ToolCalls {
				if emitted[tc.ID] {
					continue
				}
				emitted[tc.ID] = true
				if !emit(ctx, ch, Event{Kind: EventToolCall, ToolCall: &ToolCall{
					ID: tc.ID, Name: tc.Function.Name, Input: json.RawMessage(tc.Function.Arguments),
				}}) {
					return
				}
			}
		}

		emit(ctx, ch, Event{Kind: EventDone, Usage: Usage{
			InputTokens:  int(acc.Usage.PromptTokens),
			OutputTokens: int(acc.Usage.CompletionTokens),
		}})
	}()
	return ch, nil
}
