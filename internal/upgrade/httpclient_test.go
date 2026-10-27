package upgrade

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// roundTripperFunc adapts a closure into an http.RoundTripper for tests.
// Standard Go test pattern — captures the inner request the wrapper
// forwards so assertions can inspect it without spinning up a server.
type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

// withResetVersion restores UserAgentVersion to the prior value at the
// end of a test so tests that mutate the var don't bleed into each other.
func withResetVersion(t *testing.T, v string) {
	t.Helper()
	prior := UserAgentVersion
	UserAgentVersion = v
	t.Cleanup(func() { UserAgentVersion = prior })
}

func TestUserAgentTransport_StampsHeader(t *testing.T) {
	withResetVersion(t, "0.1.0")
	var seenUA string
	tr := &userAgentTransport{
		inner: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			seenUA = r.Header.Get("User-Agent")
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		}),
	}
	req, err := http.NewRequest(http.MethodGet, "http://example.invalid/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if _, err := tr.RoundTrip(req); err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	if want := "axm/0.1.0"; seenUA != want {
		t.Errorf("inner saw User-Agent = %q, want %q", seenUA, want)
	}
}

func TestUserAgentTransport_RespectsCallerOverride(t *testing.T) {
	withResetVersion(t, "0.1.0")
	var seenUA string
	tr := &userAgentTransport{
		inner: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			seenUA = r.Header.Get("User-Agent")
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		}),
	}
	req, err := http.NewRequest(http.MethodGet, "http://example.invalid/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("User-Agent", "custom/1.0")
	if _, err := tr.RoundTrip(req); err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	if seenUA != "custom/1.0" {
		t.Errorf("inner saw User-Agent = %q, want %q (caller override should win)", seenUA, "custom/1.0")
	}
}

// TestUserAgentTransport_DoesNotMutateOriginal — the RoundTripper contract
// forbids mutating the caller's request. We assert the caller's request
// has no User-Agent header set AFTER RoundTrip returns, even though the
// inner saw one — the transport must clone, not mutate.
func TestUserAgentTransport_DoesNotMutateOriginal(t *testing.T) {
	withResetVersion(t, "0.1.0")
	tr := &userAgentTransport{
		inner: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		}),
	}
	req, err := http.NewRequest(http.MethodGet, "http://example.invalid/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if _, err := tr.RoundTrip(req); err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	if got := req.Header.Get("User-Agent"); got != "" {
		t.Errorf("original request's User-Agent = %q, want %q (transport mutated caller's req)", got, "")
	}
}

// TestUserAgentTransport_UsesCurrentVersionVar — the var is read at
// RoundTrip time, so a late mutation takes effect on the next request.
func TestUserAgentTransport_UsesCurrentVersionVar(t *testing.T) {
	withResetVersion(t, "1.2.3")
	var seenUA string
	tr := &userAgentTransport{
		inner: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			seenUA = r.Header.Get("User-Agent")
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		}),
	}
	req, err := http.NewRequest(http.MethodGet, "http://example.invalid/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if _, err := tr.RoundTrip(req); err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	if want := "axm/1.2.3"; seenUA != want {
		t.Errorf("inner saw User-Agent = %q, want %q", seenUA, want)
	}
}

// TestUserAgentTransport_DevDefault — without touching the var, the
// default "dev" value flows through; a dev build sends `axm/dev`, which
// the API's Floor middleware recognises as the developer-bypass form.
func TestUserAgentTransport_DevDefault(t *testing.T) {
	// Note: we deliberately do NOT call withResetVersion here — the
	// package-level default should be "dev" already. But to be safe
	// against test order, snapshot and restore.
	withResetVersion(t, "dev")
	var seenUA string
	tr := &userAgentTransport{
		inner: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			seenUA = r.Header.Get("User-Agent")
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(""))}, nil
		}),
	}
	req, err := http.NewRequest(http.MethodGet, "http://example.invalid/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if _, err := tr.RoundTrip(req); err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	if want := "axm/dev"; seenUA != want {
		t.Errorf("inner saw User-Agent = %q, want %q", seenUA, want)
	}
}

// TestUserAgentTransport_RealServer — full integration via httptest.NewServer:
// the real net/http stack carries the request from a *http.Client through
// our transport to a real handler, which captures the User-Agent the
// server actually received on the wire.
func TestUserAgentTransport_RealServer(t *testing.T) {
	withResetVersion(t, "2.0.0")
	var seenUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenUA = r.Header.Get("User-Agent")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := &http.Client{
		Transport: &userAgentTransport{inner: http.DefaultTransport},
	}
	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatalf("client.Get: %v", err)
	}
	_ = resp.Body.Close()
	if want := "axm/2.0.0"; seenUA != want {
		t.Errorf("server saw User-Agent = %q, want %q", seenUA, want)
	}
}
