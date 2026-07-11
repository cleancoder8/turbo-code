package provider

import (
	"context"
	"testing"
)

func TestFakeReplaysTurnsAndRecordsCalls(t *testing.T) {
	f := &Fake{Turns: [][]Event{
		{{Kind: EventTextDelta, Text: "hel"}, {Kind: EventTextDelta, Text: "lo"}, {Kind: EventDone}},
		{{Kind: EventDone}},
	}}
	ch, err := f.Stream(context.Background(), Request{Model: "fake-model"})
	if err != nil {
		t.Fatal(err)
	}
	var got string
	for ev := range ch {
		if ev.Kind == EventTextDelta {
			got += ev.Text
		}
	}
	if got != "hello" {
		t.Fatalf("got %q, want %q", got, "hello")
	}
	ch2, _ := f.Stream(context.Background(), Request{Model: "fake-model"})
	for range ch2 {
	}
	if len(f.Calls) != 2 {
		t.Fatalf("recorded %d calls, want 2", len(f.Calls))
	}
}
