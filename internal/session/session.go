package session

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"turbo-code/internal/provider"
)

type Meta struct {
	ID      string    `json:"id"`
	Title   string    `json:"title"`
	Created time.Time `json:"created"`
}

type Session struct {
	Meta     Meta
	Messages []provider.Message
	f        *os.File
}

func path(dir, id string) string { return filepath.Join(dir, id+".jsonl") }

func Create(dir, title string) (*Session, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	base := time.Now().Format("20060102-150405")
	id := base
	for i := 1; ; i++ {
		if _, err := os.Stat(path(dir, id)); os.IsNotExist(err) {
			break
		}
		id = fmt.Sprintf("%s-%d", base, i)
	}
	f, err := os.OpenFile(path(dir, id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	s := &Session{Meta: Meta{ID: id, Title: title, Created: time.Now()}, f: f}
	return s, writeLine(f, s.Meta)
}

func writeLine(f *os.File, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = f.Write(append(b, '\n'))
	return err
}

func Load(dir, id string) (*Session, error) {
	f, err := os.Open(path(dir, id))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)
	s := &Session{}
	first := true
	for sc.Scan() {
		line := sc.Bytes()
		if first {
			if err := json.Unmarshal(line, &s.Meta); err != nil {
				return nil, fmt.Errorf("corrupt meta line: %w", err)
			}
			first = false
			continue
		}
		var m provider.Message
		if err := json.Unmarshal(line, &m); err != nil {
			break // corrupt trailing line (crash mid-write): keep what we have
		}
		s.Messages = append(s.Messages, m)
	}
	af, err := os.OpenFile(path(dir, id), os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	s.f = af
	return s, nil
}

func List(dir string) ([]Meta, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var metas []Meta
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		f, err := os.Open(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		if sc.Scan() {
			var m Meta
			if json.Unmarshal(sc.Bytes(), &m) == nil {
				metas = append(metas, m)
			}
		}
		f.Close()
	}
	sort.Slice(metas, func(i, j int) bool { return metas[i].ID > metas[j].ID })
	return metas, nil
}

func (s *Session) Append(m provider.Message) error {
	s.Messages = append(s.Messages, m)
	return writeLine(s.f, m)
}

func (s *Session) Close() error { return s.f.Close() }
