package cliprompt

import (
	"errors"
	"io"
	"strings"
	"testing"
)

// TestParseYes_AcceptanceForms covers the documented acceptance set:
// any case of "y" or "yes", with optional surrounding whitespace.
func TestParseYes_AcceptanceForms(t *testing.T) {
	for _, s := range []string{
		"y",
		"yes",
		"Y",
		"YES",
		" yes ",
		"Yes\n", // scanner strips the \n; left in to mirror a real read
		"  YES  ",
	} {
		if !ParseYes(s) {
			t.Errorf("ParseYes(%q) = false, want true", s)
		}
	}
}

// TestParseYes_RejectionForms covers the rejection set. "ya" / "yep" /
// "yess" are rejection because the rule requires exact "y" or "yes", not
// a strict-prefix match. Empty / Enter alone is rejection (default N).
func TestParseYes_RejectionForms(t *testing.T) {
	for _, s := range []string{
		"",
		" ",
		"n",
		"no",
		"N",
		"anything else",
		"ya",
		"yess",
		"yep",
		"always", // ParseYes is yes-only; the publish-ack caller dispatches "always" separately
	} {
		if ParseYes(s) {
			t.Errorf("ParseYes(%q) = true, want false", s)
		}
	}
}

// TestReadAnswer_StripsNewlineOnSingleLine asserts that the trailing
// newline is removed (bufio.Scanner behavior) so callers compare against
// "y" / "yes" / "always" verbatim without per-call .TrimSpace.
func TestReadAnswer_StripsNewlineOnSingleLine(t *testing.T) {
	got, err := ReadAnswer(strings.NewReader("yes\n"))
	if err != nil {
		t.Fatalf("ReadAnswer: %v", err)
	}
	if got != "yes" {
		t.Errorf("got %q, want %q", got, "yes")
	}
}

// TestReadAnswer_EOFReturnsEmptyString — an empty reader produces ("", nil),
// which both callers treat as the default-reject answer (Enter alone).
func TestReadAnswer_EOFReturnsEmptyString(t *testing.T) {
	got, err := ReadAnswer(strings.NewReader(""))
	if err != nil {
		t.Fatalf("ReadAnswer: %v", err)
	}
	if got != "" {
		t.Errorf("got %q, want empty string", got)
	}
}

// TestReadAnswer_ReaderErrorPropagates — a scanner I/O error reaches the
// caller (callers surface it as "reading prompt answer: <err>").
type errReader struct{ err error }

func (e errReader) Read(_ []byte) (int, error) { return 0, e.err }

func TestReadAnswer_ReaderErrorPropagates(t *testing.T) {
	want := errors.New("synthetic read failure")
	_, err := ReadAnswer(errReader{err: want})
	if !errors.Is(err, want) && err != want {
		// bufio.Scanner.Err() returns the wrapped error verbatim, not via
		// fmt.Errorf %w, so accept either identity match.
		t.Errorf("ReadAnswer err = %v, want %v", err, want)
	}
}

// TestReadAnswer_StopsAtFirstNewline — multi-line input is truncated
// at the first newline. The publish-ack and upgrade prompts both fire
// one question at a time; subsequent lines are not part of the answer.
func TestReadAnswer_StopsAtFirstNewline(t *testing.T) {
	got, err := ReadAnswer(strings.NewReader("always\nleftovers\n"))
	if err != nil {
		t.Fatalf("ReadAnswer: %v", err)
	}
	if got != "always" {
		t.Errorf("got %q, want %q", got, "always")
	}
}

// compile-time sanity: ReadAnswer accepts any io.Reader (channel readers,
// network sockets, *os.File, etc.). The check is a no-op at runtime.
var _ func(io.Reader) (string, error) = ReadAnswer
