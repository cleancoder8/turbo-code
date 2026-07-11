package provider

import "context"

type Fake struct {
	Turns [][]Event
	Calls []Request
	turn  int
}

func (f *Fake) Stream(ctx context.Context, req Request) (<-chan Event, error) {
	f.Calls = append(f.Calls, req)
	if f.turn >= len(f.Turns) {
		panic("Fake: no scripted turn left")
	}
	events := f.Turns[f.turn]
	f.turn++
	ch := make(chan Event)
	go func() {
		defer close(ch)
		for _, ev := range events {
			select {
			case ch <- ev:
			case <-ctx.Done():
				return
			}
		}
	}()
	return ch, nil
}

func (f *Fake) Models() []Model { return []Model{{ID: "fake-model", MaxTokens: 8192}} }
