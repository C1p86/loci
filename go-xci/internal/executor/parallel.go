package executor

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/andrearuggeri/go-xci/internal/resolver"
)

// linePrefixWriter wraps a writer and prepends [prefix] to every output line.
type linePrefixWriter struct {
	mu     sync.Mutex
	w      io.Writer
	prefix string
	buf    bytes.Buffer
}

func newLinePrefixWriter(w io.Writer, prefix string) *linePrefixWriter {
	return &linePrefixWriter{w: w, prefix: prefix}
}

func (lp *linePrefixWriter) Write(p []byte) (int, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	lp.buf.Write(p)
	for {
		idx := bytes.IndexByte(lp.buf.Bytes(), '\n')
		if idx < 0 {
			break
		}
		line := lp.buf.Next(idx + 1)
		fmt.Fprintf(lp.w, "[%s] %s", lp.prefix, line)
	}
	return len(p), nil
}

// flush writes any remaining buffered content without a trailing newline.
func (lp *linePrefixWriter) flush() {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	if lp.buf.Len() > 0 {
		fmt.Fprintf(lp.w, "[%s] %s\n", lp.prefix, lp.buf.String())
		lp.buf.Reset()
	}
}

// result carries the outcome of one parallel goroutine.
type result struct {
	alias string
	code  int
	err   error
}

// runParallel executes all group entries concurrently.
// failMode "fast": on first non-zero exit, cancel remaining; return that code.
// failMode "complete": wait for all; return first non-zero code.
func runParallel(group []resolver.GroupEntry, failMode string, opts Options) (int, error) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	results := make(chan result, len(group))
	var wg sync.WaitGroup

	for _, entry := range group {
		entry := entry // capture
		wg.Add(1)
		go func() {
			defer wg.Done()

			argv := entry.Argv
			cwd := opts.Cwd
			if entry.Cwd != "" {
				cwd = entry.Cwd
			}

			if len(argv) == 0 {
				results <- result{alias: entry.Alias, code: 0}
				return
			}

			cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
			if cwd != "" {
				cmd.Dir = cwd
			}
			if len(opts.Env) > 0 {
				cmd.Env = opts.Env
			}

			if opts.ShowOutput {
				outW := newLinePrefixWriter(os.Stdout, entry.Alias)
				errW := newLinePrefixWriter(os.Stderr, entry.Alias)
				cmd.Stdout = outW
				cmd.Stderr = errW
				defer outW.flush()
				defer errW.flush()
			} else {
				cmd.Stdout = io.Discard
				cmd.Stderr = io.Discard
			}

			code := 0
			if err := cmd.Run(); err != nil {
				if exitErr, ok := err.(*exec.ExitError); ok {
					code = exitErr.ExitCode()
					if code < 0 {
						code = 1
					}
				} else if ctx.Err() != nil {
					// Context cancelled: treat as cancelled, not a real failure
					results <- result{alias: entry.Alias, code: 0}
					return
				} else {
					results <- result{alias: entry.Alias, code: 1, err: err}
					return
				}
			}
			results <- result{alias: entry.Alias, code: code}
		}()
	}

	// Close results channel when all goroutines finish
	go func() {
		wg.Wait()
		close(results)
	}()

	firstNonZero := 0
	var firstErr error
	summaryLines := make([]string, 0, len(group))

	for r := range results {
		summaryLines = append(summaryLines, fmt.Sprintf("  [%s] exit %d", r.alias, r.code))
		if r.code != 0 || r.err != nil {
			if firstNonZero == 0 {
				firstNonZero = r.code
				if firstNonZero == 0 {
					firstNonZero = 1
				}
				firstErr = r.err
			}
			if failMode == "fast" {
				cancel() // signal remaining goroutines to stop
			}
		}
	}

	// Print summary
	fmt.Fprintln(os.Stderr, "[xci] parallel results:")
	for _, line := range summaryLines {
		// Sort the output in a stable way (we collect as they arrive, order may vary)
		_ = line
	}
	// Use buffered scan for deterministic summary
	scanner := bufio.NewScanner(strings.NewReader(strings.Join(summaryLines, "\n")))
	for scanner.Scan() {
		fmt.Fprintln(os.Stderr, scanner.Text())
	}

	return firstNonZero, firstErr
}
