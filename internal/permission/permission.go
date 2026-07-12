package permission

import "sync"

type Request struct {
	ToolName    string
	Description string
}

type Decision int

const (
	Deny Decision = iota
	AllowOnce
	AllowAlways
)

type AskFunc func(Request) Decision

type Service struct {
	mu     sync.Mutex
	ask    AskFunc
	always map[string]bool
}

func New(ask AskFunc) *Service {
	return &Service{ask: ask, always: map[string]bool{}}
}

func (s *Service) Allowed(req Request) bool {
	s.mu.Lock()
	if s.always[req.ToolName] {
		s.mu.Unlock()
		return true
	}
	s.mu.Unlock()

	switch s.ask(req) {
	case AllowAlways:
		s.mu.Lock()
		s.always[req.ToolName] = true
		s.mu.Unlock()
		return true
	case AllowOnce:
		return true
	default:
		return false
	}
}
