package tool

import (
	"strings"
	"testing"
)

func TestBash(t *testing.T) {
	res := mustRun(t, Bash{}, `{"command": "echo hello && echo err >&2"}`)
	if res.IsError || !strings.Contains(res.Content, "hello") || !strings.Contains(res.Content, "err") {
		t.Fatalf("res: %+v", res)
	}

	res = mustRun(t, Bash{}, `{"command": "exit 3"}`)
	if !res.IsError || !strings.Contains(res.Content, "exit status 3") {
		t.Fatalf("res: %+v", res)
	}

	res = mustRun(t, Bash{}, `{"command": "sleep 5", "timeout_seconds": 1}`)
	if !res.IsError {
		t.Fatal("timeout should be IsError")
	}
}
