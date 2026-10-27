// Package progress renders Axiom-branded, TTY-aware progress spinners for the
// long, output-less waits in the CLI (the `lake --version` toolchain probe,
// the silent Lean elaboration inside `axm check`, and
// the Lake build during `axm init` pre-warm).
//
// The empty time during these steps is among a new user's first experiences
// with Axiom, so we fill it with a purple spinner that
// reports live information — a ticking elapsed timer and, while Lake builds,
// the running job count — in the Claude-Code style rather than a blank
// terminal or a stream of completion lines separated by 20-second silences.
//
// Design rules (all enforced by New):
//
//   - Animation/threading is delegated to github.com/briandowns/spinner; the
//     brand colour comes from github.com/fatih/color's 24-bit RGB support so
//     the glyph is the exact Axiom purple #655af5 (RGB 101,90,245).
//   - The spinner is a NO-OP whenever the destination is not an interactive
//     terminal, NO_COLOR is set, CI is set, or AXM_NO_SPINNER=1. In those
//     environments every method does nothing and LakeWriter is a transparent
//     pass-through, so piped output and CI logs stay byte-for-byte identical to
//     a spinner-free build. Callers never branch on "is this a TTY?" — they
//     always get a *Spinner and call its methods unconditionally.
//   - The spinner never collides with the subprocess output it accompanies:
//     LakeWriter erases the live status line before echoing each subprocess
//     line and lets the spinner redraw itself below, so the subprocess log
//     scrolls cleanly with the status line pinned to the bottom.
//   - The spinner defers to a subprocess that runs its own progress display
//     (an elan toolchain download, a Lake dependency-fetch bar): a carriage
//     return in the subprocess stream switches LakeWriter into verbatim
//     passthrough and stops our spinner so the subprocess owns the line. The
//     defer is a *phase*, not a latch — when the subprocess closes its
//     progress display (a newline arrives after the last carriage return,
//     with no further carriage return in the same Write), our spinner
//     resumes and ticks through whatever silent phase follows (an elan
//     toolchain extraction, a Lake olean-load phase). The next carriage
//     return defers again. The two spinners cannot collide and any silence
//     after the subprocess's display is filled by our elapsed timer.
package progress

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/briandowns/spinner"
	"github.com/fatih/color"
	"golang.org/x/term"
)

// axiomPurple is the canonical brand purple (#655af5). Defined once here so
// the CLI matches axiom/web (globals.css) and coherencelabs-dot-net.
var axiomPurple = color.RGB(101, 90, 245)

// frameInterval is the per-frame delay of the braille spinner. 80ms reads as a
// smooth, calm rotation rather than a frantic blink.
const frameInterval = 80 * time.Millisecond

// tickInterval is how often the elapsed-time suffix is refreshed. One second
// matches what the eye needs to confirm "still working" without busy churn.
const tickInterval = time.Second

// spinnerShowDelay defers a spinner's first visible frame: Start schedules the
// underlying animation this long in the future rather than drawing immediately,
// and a Stop/Done before it elapses cancels the draw entirely. So a
// sub-threshold operation renders as just its final "✓" line (or nothing) with
// no spinner flicker. Applied package-wide — every spinner inherits it with no
// per-call change. The value tracks common tool defaults (~200–300 ms; below
// Material Design's ~500 ms indicator-suppression and above Nielsen-Norman's
// 0.1 s "feels instant"); it is a UX-perception constant, deliberately not a
// configurable knob — if evidence argues for a different value we change it here.
const spinnerShowDelay = 250 * time.Millisecond

// afterFunc is the timer constructor used to schedule the deferred first frame.
// It is a package-level seam (defaulting to time.AfterFunc) so a unit test can
// swap in a fake clock and drive the delay without sleeping on the wall clock;
// tests must restore it via defer.
var afterFunc = time.AfterFunc

// Spinner is a thin handle over a briandowns spinner. A zero/disabled Spinner
// (the value returned on a non-interactive destination) has a nil inner and
// every method is a no-op, so callers never branch on TTY-ness.
//
// The animated suffix is "<base> · <detail> · <elapsed>", where detail is
// optional (set by LakeWriter as Lake reports job progress) and elapsed ticks
// once a second. briandowns reads its Suffix field under its own mutex during
// each frame, so the tick goroutine mutates it through inner.Lock/Unlock; the
// Spinner's own mu guards base/detail/start against that goroutine.
type Spinner struct {
	// inner and w are set once in New and never reassigned, so they are read
	// without holding mu (the tick goroutine, echoAbove, and Stop all rely on
	// this). mu guards the mutable suffix inputs (base/detail/start), the tick
	// channel, and the lakeWriters slice.
	inner *spinner.Spinner
	w     io.Writer

	mu          sync.Mutex
	base        string
	detail      string
	start       time.Time
	stop        chan struct{} // closed by Stop/Done to end the tick goroutine
	suspended   bool          // true after suspend(): briandowns is halted; Done must print its own completion line
	lakeWriters []*lakeWriter // created via LakeWriter; flushed on Stop/Done

	// showTimer schedules the first visible frame spinnerShowDelay after Start;
	// stopped is set by Stop/Done so a timer callback that has already fired
	// (but not yet taken mu) sees the spinner is done and draws nothing. The two
	// together close the timer-vs-Stop race: Stop both cancels the timer and
	// flips stopped, and the callback re-checks stopped under mu before drawing.
	showTimer *time.Timer
	stopped   bool
}

// New returns a Spinner that draws to w, or a disabled (no-op) Spinner when w
// is not an interactive terminal or output has been suppressed by the
// environment (NO_COLOR, CI, AXM_NO_SPINNER=1). It does not start animating;
// call Start.
func New(w io.Writer) *Spinner {
	if !enabled(w) {
		// Still record w: LakeWriter() returns it as the transparent
		// pass-through so a disabled spinner forwards subprocess output to the
		// same stream an enabled one would draw on.
		return &Spinner{w: w}
	}
	return newEnabled(w)
}

// newEnabled builds an animating Spinner unconditionally (bypassing the TTY /
// env gate in New). It backs New's enabled path and lets tests drive the
// concurrent tick / echo / detail machinery against an in-memory writer.
func newEnabled(w io.Writer) *Spinner {
	// CharSet 14 is the smooth braille dot cycle (⣾⣽⣻⢿⡿⣟⣯⣷). Pre-colour each
	// frame purple so the glyph itself carries the brand colour; the suffix
	// message is left in the terminal's default foreground for readability.
	frames := purpleFrames(spinner.CharSets[14])
	s := spinner.New(frames, frameInterval,
		spinner.WithWriter(w),
		spinner.WithHiddenCursor(true),
	)
	return &Spinner{inner: s, w: w}
}

// Start begins the animation with the given base status message. The rendered
// suffix grows a " · <elapsed>" tail that updates once a second. Safe to call
// on a disabled spinner.
func (s *Spinner) Start(msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.inner == nil {
		return
	}
	s.base = msg
	s.detail = ""
	// start tracks the real Start call so Done's elapsed time measures the whole
	// operation, not just the visible portion after the show-delay.
	s.start = time.Now()
	s.stop = make(chan struct{})
	s.stopped = false
	s.inner.Suffix = " " + s.renderLocked()
	// Defer the first visible frame by spinnerShowDelay: a Stop/Done before it
	// fires cancels the timer (and flips stopped) so a sub-threshold operation
	// never draws a spinner. The tick goroutine still runs from the real Start so
	// the elapsed suffix is correct the instant the frame does become visible.
	s.showTimer = afterFunc(spinnerShowDelay, s.showFirstFrame)
	go s.tick(s.stop)
	// Register so a SIGINT/SIGTERM during the wait restores the cursor that
	// WithHiddenCursor hid (briandowns only un-hides it inside Stop, which a
	// signal would otherwise skip — leaving the user's terminal cursorless).
	register(s)
}

// showFirstFrame is the deferred timer callback that actually starts the
// underlying animation. It re-checks stopped under mu so a callback that fired
// concurrently with Stop/Done (and lost the race to mu) draws nothing — closing
// the timer-vs-Stop race together with Stop's timer cancellation.
func (s *Spinner) showFirstFrame() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped || s.inner == nil {
		return
	}
	s.inner.Start()
}

// tick refreshes the elapsed-time suffix every second until done is closed.
// It takes the channel by value so a concurrent Start (which swaps s.stop)
// cannot leave this goroutine watching the wrong channel.
func (s *Spinner) tick(done chan struct{}) {
	t := time.NewTicker(tickInterval)
	defer t.Stop()
	for {
		select {
		case <-done:
			return
		case <-t.C:
			s.mu.Lock()
			suffix := " " + s.renderLocked()
			inner := s.inner
			s.mu.Unlock()
			// Mutate Suffix under briandowns' own lock so the frame loop
			// never reads a half-written string.
			inner.Lock()
			inner.Suffix = suffix
			inner.Unlock()
		}
	}
}

// Detail sets the middle segment of the suffix ("<base> · <detail> · <s>") for
// callers that drive their own sub-progress ticker (e.g. `axm fetch`'s
// "m/n files" closure-download counter). Safe on a disabled spinner and safe to call from multiple goroutines.
// The LakeWriter path uses the same unexported setDetail.
func (s *Spinner) Detail(detail string) { s.setDetail(detail) }

// setDetail sets the middle segment of the suffix ("<base> · <detail> · <s>"),
// used to surface live sub-progress such as Lake's running job count. Only
// LakeWriter and Detail call it; kept unexported because no external caller
// needs it.
func (s *Spinner) setDetail(detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.inner == nil {
		return
	}
	s.detail = detail
	suffix := " " + s.renderLocked()
	inner := s.inner
	// renderLocked only reads fields we hold via s.mu; briandowns' lock guards
	// the write to its Suffix.
	inner.Lock()
	inner.Suffix = suffix
	inner.Unlock()
}

// renderLocked builds the suffix text. Caller must hold s.mu.
func (s *Spinner) renderLocked() string {
	out := s.base
	if s.detail != "" {
		out += " · " + s.detail
	}
	return out + " · " + fmtElapsed(time.Since(s.start))
}

// stopTick closes the tick channel exactly once. Caller must hold s.mu.
func (s *Spinner) stopTickLocked() {
	if s.stop != nil {
		close(s.stop)
		s.stop = nil
	}
}

// stopShowTimerLocked cancels the pending first-frame timer and marks the
// spinner stopped, so a not-yet-fired callback is cancelled and a callback that
// already fired (but is blocked on mu) sees stopped and draws nothing. Caller
// must hold s.mu. Idempotent. briandowns' own Stop is a no-op if the underlying
// spinner never started, so it is safe to call after a cancelled (never-shown)
// first frame.
func (s *Spinner) stopShowTimerLocked() {
	s.stopped = true
	if s.showTimer != nil {
		s.showTimer.Stop()
		s.showTimer = nil
	}
}

// Stop halts the animation and clears the spinner line, leaving the cursor at
// column 0 so the caller can print whatever comes next. Idempotent and safe on
// a disabled or already-suspended spinner.
func (s *Spinner) Stop() {
	if s.inner == nil { // inner is immutable after New; no lock needed
		return
	}
	s.flushLakeWriters()
	s.mu.Lock()
	if s.suspended {
		s.mu.Unlock()
		return
	}
	s.stopShowTimerLocked()
	s.stopTickLocked()
	s.inner.FinalMSG = ""
	s.inner.Stop()
	s.mu.Unlock()
	deregister(s)
}

// Done stops the spinner and leaves a persistent "✓ <msg> · <elapsed>" line in
// its place (the check mark in Axiom purple), marking the step complete. On a
// disabled spinner it does nothing — callers that want a guaranteed completion
// line on non-TTY output should print it themselves.
//
// If the spinner was previously deferred to a subprocess's own progress display
// (LakeWriter saw a '\r'), briandowns is no longer animating, so we print the
// completion line directly to s.w on its own line below whatever the subprocess
// left behind.
func (s *Spinner) Done(msg string) {
	if s.inner == nil {
		return
	}
	s.flushLakeWriters()
	s.mu.Lock()
	if s.suspended {
		final := axiomPurple.Sprint("✓ ") + msg + " · " + fmtElapsed(time.Since(s.start)) + "\n"
		s.mu.Unlock()
		// Route through writeRaw so this serialises against any in-flight
		// writeRaw from a still-draining LakeWriter via the briandowns mutex.
		_, _ = s.writeRaw([]byte("\n" + final))
		return
	}
	s.stopShowTimerLocked()
	s.stopTickLocked()
	s.inner.FinalMSG = axiomPurple.Sprint("✓ ") + msg + " · " + fmtElapsed(time.Since(s.start)) + "\n"
	s.inner.Stop()
	s.mu.Unlock()
	deregister(s)
}

// flushLakeWriters drains any buffered trailing (non-newline-terminated) line
// from each LakeWriter before the spinner stops. The subprocess's final and
// most diagnostic bytes (e.g. a Lean panic that does not end in '\n') would
// otherwise be silently dropped. Snapshot the slice under mu, then flush
// outside the lock — flush → echoAbove does not take s.mu.
func (s *Spinner) flushLakeWriters() {
	s.mu.Lock()
	writers := append([]*lakeWriter(nil), s.lakeWriters...)
	s.mu.Unlock()
	for _, w := range writers {
		w.flush()
	}
}

// LakeWriter returns a writer to use as a subprocess's Stdout/Stderr while the
// spinner runs. For each complete line the subprocess emits it:
//
//   - echoes the line above the live spinner (erasing the status line first so
//     the two never overlap), preserving Lake's own "✔ [n/m] Built X" detail,
//     and
//   - parses a "[n/m]" job marker and feeds it to SetDetail, so the pinned
//     status line shows the running job count and keeps its elapsed timer
//     ticking through Lake's long per-job silences.
//
// The echo target is the spinner's own writer (the one passed to New), so the
// echoed output and the animated frames always share a stream — callers cannot
// accidentally split them. When the spinner is disabled the returned writer IS
// that same stream unwrapped, so piped / CI output is exactly the raw
// subprocess stream on the stream the caller chose.
func (s *Spinner) LakeWriter() io.Writer {
	if s.inner == nil {
		return s.w
	}
	lw := &lakeWriter{spinner: s}
	s.mu.Lock()
	s.lakeWriters = append(s.lakeWriters, lw)
	s.mu.Unlock()
	return lw
}

// jobMarker matches Lake's "[n/m]" build-progress counter, e.g.
// "✔ [6/10] Built CommandLib.Basic:c.o (21s)".
var jobMarker = regexp.MustCompile(`\[(\d+)/(\d+)\]`)

type lakeWriter struct {
	spinner *Spinner
	mu      sync.Mutex // guards buf: os/exec may write from >1 goroutine
	buf     bytes.Buffer
}

// Write buffers bytes and flushes on each newline. A trailing partial line is
// held until its newline arrives (or until the spinner's flush on Stop), so the
// spinner is never corrupted by a half-line echo. The buffer is mutex-guarded
// because transform.Invoke can drive a single sink from two goroutines (the
// exec stderr copier and the main scanner's non-JSON fallback).
//
// On the first '\r' byte the writer suspends the (shared) spinner and switches
// every LakeWriter on it to verbatim passthrough — the subprocess is running
// its own progress display, so we yield the line. The deferred flag lives on
// the Spinner so siblings see the switch atomically. When the subprocess
// closes its display — signalled by a Write whose tail contains a newline at
// a position after the last carriage return (so the most recent in-place
// line has been finalized) — the spinner resumes. The next '\r' defers
// again. This phase-aware behaviour lets our elapsed timer fill any silence
// that follows a download bar (elan's extraction phase, Lake's olean load)
// while still keeping the row clear during the bar itself.
func (w *lakeWriter) Write(p []byte) (int, error) {
	if w.spinner.isDeferred() {
		n, err := w.spinner.writeRaw(p)
		if err != nil {
			return n, err
		}
		if progressEnded(p) {
			w.spinner.resume()
		}
		return n, nil
	}
	if bytes.IndexByte(p, '\r') >= 0 {
		w.mu.Lock()
		rem := w.buf.String()
		w.buf.Reset()
		w.mu.Unlock()
		w.spinner.suspend()
		if rem != "" {
			if _, err := w.spinner.writeRaw([]byte(rem)); err != nil {
				return 0, err
			}
		}
		n, err := w.spinner.writeRaw(p)
		if err != nil {
			return n, err
		}
		if progressEnded(p) {
			w.spinner.resume()
		}
		return n, nil
	}
	w.mu.Lock()
	w.buf.Write(p)
	var lines []string
	for {
		line, err := w.buf.ReadString('\n')
		if err != nil {
			// No newline yet — push the remainder back and wait for more.
			w.buf.Reset()
			w.buf.WriteString(line)
			break
		}
		lines = append(lines, line) // includes trailing '\n'
	}
	w.mu.Unlock()
	// Echo outside the buffer lock so a slow terminal write can't stall a
	// concurrent Write into the buffer.
	for _, line := range lines {
		if err := w.handleLine(line); err != nil {
			return len(p), err
		}
	}
	return len(p), nil
}

// progressEnded reports whether p closes a carriage-return progress display.
// The subprocess has finished its in-place updates when the most recent '\n'
// in p sits after the most recent '\r' (the newline finalizes the bar, with
// no further in-place update inside this Write) — or when p contains '\n'
// and no '\r' at all (a clean line, the bar is well behind us). Both are
// signals it is safe for our spinner to resume on the next row.
func progressEnded(p []byte) bool {
	nIdx := bytes.LastIndexByte(p, '\n')
	if nIdx < 0 {
		return false
	}
	rIdx := bytes.LastIndexByte(p, '\r')
	return nIdx > rIdx
}

// isDeferred reports whether the spinner is currently yielded to a
// subprocess's own progress display. The flag flips back when resume()
// fires on the closing newline of that display, so callers must re-check
// per Write rather than caching.
func (s *Spinner) isDeferred() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.suspended
}

// flush emits any buffered trailing line (terminating it with a newline so the
// final output is clean). Called by the spinner on Stop/Done.
//
// If the spinner is deferred when flush runs, route the line through writeRaw
// rather than echoAbove — echoAbove emits a "\r\033[K" clear-line sequence
// that would clobber a row of whatever the subprocess is currently painting.
// handleLine has the symmetric branch for the same reason.
func (w *lakeWriter) flush() {
	w.mu.Lock()
	rem := w.buf.String()
	w.buf.Reset()
	w.mu.Unlock()
	if rem == "" {
		return
	}
	if !strings.HasSuffix(rem, "\n") {
		rem += "\n"
	}
	if w.spinner.isDeferred() {
		_, _ = w.spinner.writeRaw([]byte(rem))
		return
	}
	_ = w.spinner.echoAbove(rem)
}

func (w *lakeWriter) handleLine(line string) error {
	// If a sibling LakeWriter saw a '\r' between our buffer-fill and now,
	// the spinner is already suspended — pass the line through verbatim
	// rather than running echoAbove's clear-line-and-redraw dance against
	// a halted spinner (it would erase a row of the subprocess's display).
	if w.spinner.isDeferred() {
		_, err := w.spinner.writeRaw([]byte(line))
		return err
	}
	if m := jobMarker.FindStringSubmatch(line); m != nil {
		// Indices validated by the \d+ pattern, so Atoi cannot fail.
		done, _ := strconv.Atoi(m[1])
		total, _ := strconv.Atoi(m[2])
		w.spinner.setDetail(fmt.Sprintf("%d/%d jobs", done, total))
	}
	return w.spinner.echoAbove(line)
}

// echoAbove prints one subprocess line above the live spinner. It erases the
// status line, writes the line, and lets briandowns redraw the spinner on the
// freshly-opened line below. The whole sequence runs under briandowns' lock so
// it can't interleave with a frame render. inner and w are immutable after New,
// so no s.mu is needed. The write error is propagated so a broken pipe / closed
// tty surfaces to the caller rather than vanishing.
func (s *Spinner) echoAbove(line string) error {
	if s.inner == nil {
		return nil
	}
	s.inner.Lock()
	defer s.inner.Unlock()
	// \r returns to column 0; \033[K clears to end of line, wiping the status
	// line so the echoed line takes its place. The echoed line's own newline
	// then opens a fresh bottom line for the next spinner frame.
	if _, err := fmt.Fprint(s.w, "\r\033[K"); err != nil {
		return err
	}
	_, err := fmt.Fprint(s.w, line)
	return err
}

// suspend stops the spinner without printing a final line, restoring the cursor
// briandowns hides on Start. Used by LakeWriter to yield to a subprocess's own
// progress display the moment we detect carriage-return updates from it.
// The suspended flag latches until resume() flips it back, so an interleaved
// sibling LakeWriter sees the switch atomically.
// Safe on a disabled or already-suspended spinner.
func (s *Spinner) suspend() {
	if s.inner == nil {
		return
	}
	s.mu.Lock()
	if s.suspended {
		s.mu.Unlock()
		return
	}
	s.suspended = true
	s.stopTickLocked()
	s.inner.FinalMSG = ""
	s.inner.Stop()
	s.mu.Unlock()
	deregister(s)
}

// resume restarts the spinner after a previous suspend(). briandowns supports
// Start() after Stop() — it allocates a fresh stopChan and frame goroutine —
// and our tick loop is recreated with a new done channel. The suffix is
// re-rendered from the (still-ticking) start time so the elapsed timer
// continues without resetting. Safe on a disabled or not-suspended spinner.
//
// Called by LakeWriter when the subprocess closes its '\r' progress display:
// the next phase (often silent — an elan extract, a Lake olean load) gets
// our spinner ticking through it rather than a blank terminal.
func (s *Spinner) resume() {
	if s.inner == nil {
		return
	}
	s.mu.Lock()
	if !s.suspended {
		s.mu.Unlock()
		return
	}
	s.suspended = false
	s.stop = make(chan struct{})
	s.inner.Suffix = " " + s.renderLocked()
	// Re-register BEFORE inner.Start hides the cursor again — a SIGINT
	// delivered between Start (cursor hidden) and the registry insertion
	// would find an empty active map and exit 130 with the cursor stranded.
	register(s)
	// inner.Start re-hides the cursor (WithHiddenCursor was set in New) and
	// spawns its own frame goroutine; take its lock implicitly by going
	// through its API. Order matches Start: s.mu held, then inner.Start.
	s.inner.Start()
	go s.tick(s.stop)
	s.mu.Unlock()
}

// writeRaw passes bytes straight to s.w. Used after suspend() to forward a
// subprocess's own bytes (an elan download bar, a Lake dep-fetch progress)
// verbatim. The briandowns mutex is held for the write so a sibling LakeWriter
// triggering resume(), a concurrent writeRaw from another sibling, or Done()'s
// suspended-branch direct write cannot interleave bytes on s.w with us — same
// lock echoAbove uses for the same reason.
func (s *Spinner) writeRaw(p []byte) (int, error) {
	s.inner.Lock()
	defer s.inner.Unlock()
	return s.w.Write(p)
}

// Spin runs fn under a spinner that shows msg with a ticking elapsed timer,
// stopping the spinner before returning fn's error (so the caller's error
// output is never drawn over). It's the one-liner for the common
// output-less-probe shape — a toolchain check, an auth round-trip — that would
// otherwise repeat New/Start/Stop at every call site.
func Spin(w io.Writer, msg string, fn func() error) error {
	s := New(w)
	s.Start(msg)
	err := fn()
	s.Stop()
	return err
}

// ── Cursor restoration on interrupt ─────────────────────────────────────────
//
// briandowns hides the cursor (WithHiddenCursor) and only un-hides it inside
// Stop. A SIGINT/SIGTERM during a wait would terminate the process before Stop
// runs, stranding the user's terminal with an invisible cursor. We keep a
// registry of live spinners and, on first registration, install a one-shot
// signal handler that restores every live spinner's cursor before exiting 130.

var (
	activeMu  sync.Mutex
	active    = map[*Spinner]struct{}{}
	signalSet sync.Once
)

func register(s *Spinner) {
	activeMu.Lock()
	active[s] = struct{}{}
	activeMu.Unlock()
	signalSet.Do(installSignalHandler)
}

func deregister(s *Spinner) {
	activeMu.Lock()
	delete(active, s)
	activeMu.Unlock()
}

// showCursor is the ANSI "show cursor" sequence (the inverse of the "\033[?25l"
// briandowns emits on Start). "\r\033[K" first clears the abandoned status line.
const showCursor = "\r\033[K\033[?25h"

func installSignalHandler() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-ch
		activeMu.Lock()
		for s := range active {
			fmt.Fprint(s.w, showCursor)
		}
		activeMu.Unlock()
		// 128 + signal number (SIGINT=2) is the conventional shell exit code.
		os.Exit(130)
	}()
}

// Successf prints a completed-step line to w, prefixed with a check mark. The
// mark is rendered in Axiom purple only when w is an enabled interactive
// terminal; otherwise it degrades to a plain "✓" with no escape codes so
// piped output and CI logs stay clean. Use for a finished step or the terminal
// "done" line of a command, where there is no spinner left to call Done on.
func Successf(w io.Writer, format string, a ...interface{}) {
	mark := "✓"
	if enabled(w) {
		mark = axiomPurple.Sprint("✓")
	}
	fmt.Fprintf(w, "%s %s\n", mark, fmt.Sprintf(format, a...))
}

// amber styles the warning glyph; yellow is the conventional "attention, not
// failure" colour and degrades to no-op on a non-colour terminal.
var amber = color.New(color.FgYellow)

// Warnf prints a soft-warning line to w prefixed with "⚠" (amber on an enabled
// terminal, plain otherwise). Use for non-fatal conditions — a skipped
// pre-warm, a missing toolchain — that leave the command usable.
func Warnf(w io.Writer, format string, a ...interface{}) {
	mark := "⚠"
	if enabled(w) {
		mark = amber.Sprint("⚠")
	}
	fmt.Fprintf(w, "%s %s\n", mark, fmt.Sprintf(format, a...))
}

// faint styles low-emphasis helper text; it degrades to a no-op on a
// non-colour terminal so piped output and CI logs stay clean.
var faint = color.New(color.Faint)

// Dim returns s wrapped in the terminal "faint" escape when w is an enabled
// interactive terminal, else s unchanged. Use for inline secondary text — a
// "(detected)" status tag, a "[default]" hint — that should read as guidance
// without competing with the primary content.
func Dim(w io.Writer, s string) string {
	if enabled(w) {
		return faint.Sprint(s)
	}
	return s
}

// FmtElapsed is the exported form of fmtElapsed, for callers that print their
// own completion line with a "· <elapsed>" suffix in the package's house style
// (e.g. `axm fetch`'s per-root completion lines, which are not driven by a
// spinner's Done).
func FmtElapsed(d time.Duration) string { return fmtElapsed(d) }

// fmtElapsed renders a duration as a compact "<1s" / "12s" / "1m04s". Sub-second
// durations render "<1s" rather than "0s", which read as a glitch on the common
// warm-cache completion.
func fmtElapsed(d time.Duration) string {
	if d < time.Second {
		return "<1s"
	}
	secs := int(d.Seconds())
	if secs < 60 {
		return strconv.Itoa(secs) + "s"
	}
	return fmt.Sprintf("%dm%02ds", secs/60, secs%60)
}

// purpleFrames wraps every frame of cs in the Axiom-purple escape so the
// rotating glyph is brand-coloured. The message text is intentionally left
// uncoloured (set as the spinner's suffix elsewhere).
func purpleFrames(cs []string) []string {
	out := make([]string, len(cs))
	for i, f := range cs {
		out[i] = axiomPurple.Sprint(f)
	}
	return out
}

// enabled decides whether a real spinner should be drawn to w. It must be an
// interactive terminal AND the environment must not have opted out. The checks
// mirror the de-facto standard for CLI colour/animation:
//
//   - NO_COLOR (https://no-color.org): any value disables.
//   - CI: build agents set this; spinner churn pollutes captured logs.
//   - AXM_NO_SPINNER: an Axiom-specific escape hatch — any non-empty value
//     disables, matching the NO_COLOR/CI convention (not just "1").
func enabled(w io.Writer) bool {
	if os.Getenv("AXM_NO_SPINNER") != "" {
		return false
	}
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	if os.Getenv("CI") != "" {
		return false
	}
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}
