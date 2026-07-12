package permission

import "testing"

func TestAllowAlwaysRemembered(t *testing.T) {
	asks := 0
	s := New(func(r Request) Decision {
		asks++
		return AllowAlways
	})
	if !s.Allowed(Request{ToolName: "bash", Description: "ls"}) {
		t.Fatal("want allowed")
	}
	if !s.Allowed(Request{ToolName: "bash", Description: "rm x"}) {
		t.Fatal("want allowed")
	}
	if asks != 1 {
		t.Fatalf("asked %d times, want 1", asks)
	}
}

func TestDenyAndAllowOnce(t *testing.T) {
	decisions := []Decision{Deny, AllowOnce, Deny}
	i := 0
	s := New(func(r Request) Decision { d := decisions[i]; i++; return d })
	if s.Allowed(Request{ToolName: "edit"}) {
		t.Fatal("want denied")
	}
	if !s.Allowed(Request{ToolName: "edit"}) {
		t.Fatal("want allowed once")
	}
	if s.Allowed(Request{ToolName: "edit"}) {
		t.Fatal("AllowOnce must not persist")
	}
}
