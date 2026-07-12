package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

type Bash struct{}

func (Bash) Name() string { return "bash" }
func (Bash) Description() string {
	return "Run a shell command via bash -c. Params: command, optional timeout_seconds (default 60, max 600)."
}
func (Bash) Mutating() bool { return true }
func (Bash) Schema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{
		"command":{"type":"string"},"timeout_seconds":{"type":"integer"}},
		"required":["command"]}`)
}

const bashOutputCap = 30000

func (Bash) Run(ctx context.Context, params json.RawMessage) (Result, error) {
	var p struct {
		Command        string `json:"command"`
		TimeoutSeconds int    `json:"timeout_seconds"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return Result{Content: "invalid params: " + err.Error(), IsError: true}, nil
	}
	timeout := time.Duration(p.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	if timeout > 600*time.Second {
		timeout = 600 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, "bash", "-c", p.Command)
	out, err := cmd.CombinedOutput()
	content := string(out)
	if len(content) > bashOutputCap {
		content = content[:bashOutputCap] + "\n[output truncated]"
	}
	if cctx.Err() == context.DeadlineExceeded {
		return Result{Content: content + "\n[command timed out]", IsError: true}, nil
	}
	if err != nil {
		return Result{Content: fmt.Sprintf("%s\n[%s]", content, err), IsError: true}, nil
	}
	return Result{Content: content}, nil
}
