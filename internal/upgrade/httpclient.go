package upgrade

import (
	"net/http"
	"time"
)

// UserAgentVersion is stamped into every release download as `axm/<UserAgentVersion>`; cmd sets it once at startup.
var UserAgentVersion = "dev"

// releaseTimeout bounds one release, feed, corpus or site download.
const releaseTimeout = 380 * time.Second

// userAgentTransport stamps the axm User-Agent unless the caller set one.
type userAgentTransport struct {
	inner http.RoundTripper
}

func (t *userAgentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Header.Get("User-Agent") != "" {
		return t.inner.RoundTrip(req)
	}
	// The RoundTripper contract forbids mutating the caller's request.
	cloned := req.Clone(req.Context())
	if cloned.Header == nil {
		cloned.Header = http.Header{}
	}
	cloned.Header.Set("User-Agent", "axm/"+UserAgentVersion)
	return t.inner.RoundTrip(cloned)
}

// newReleaseClient returns an anonymous client that follows asset CDN redirects.
func newReleaseClient() *http.Client {
	return &http.Client{
		Timeout:   releaseTimeout,
		Transport: &userAgentTransport{inner: http.DefaultTransport},
	}
}
