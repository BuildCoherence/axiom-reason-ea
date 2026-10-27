package upgrade

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestReadVersionFeed(t *testing.T) {
	for _, tc := range []struct {
		name, body, wantError string
		status                int
	}{
		{"full feed", `{"cli":{"min":"1.0.0","current":"2.0.0"},"lean_client":{"current_tag":"9.9.9","remote_url":"old"},"toolchain":{"current":"lean"},"web_bundle":{"current_hash":"web"},"site":{"asset":"site.tar.zst","sha256":"abc"}}`, "", 200},
		{"invalid target", `{"cli":{"current":"../../other"}}`, "valid semver", 200},
		{"missing target", `{}`, "valid semver", 200},
		{"invalid JSON", `{`, "decoding response", 200},
		{"throttled", `not json`, "try again later", 429},
		{"missing", `not found`, "404", 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/owner/repo/releases/latest/download/axm-version.json" {
					t.Errorf("path = %s", r.URL.Path)
				}
				if r.Header.Get("Authorization") != "" || r.Header.Get("X-Serverless-Authorization") != "" {
					t.Error("release client sent credentials")
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			t.Setenv("AXM_RELEASE_BASE_URL", "")
			client := srv.Client()
			target, _ := url.Parse(srv.URL)
			client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
				req = req.Clone(req.Context())
				req.URL.Scheme = target.Scheme
				req.URL.Host = target.Host
				return http.DefaultTransport.RoundTrip(req)
			})
			feed, err := ReadVersionFeed(context.Background(), client, "owner/repo")
			if calls != 1 {
				t.Fatalf("feed requests = %d", calls)
			}
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("error = %v", err)
				}
				if errors.Is(err, ErrRateLimited) != (tc.status == 429) {
					t.Fatalf("rate limit classification = %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if feed.CLI.Current != "2.0.0" || feed.CLI.Min != "1.0.0" || feed.LeanClient.CurrentTag != "9.9.9" || feed.LeanClient.RemoteURL != "old" || feed.Toolchain.Current != "lean" || feed.WebBundle.CurrentHash != "web" || feed.Site.Asset != "site.tar.zst" || feed.Site.SHA256 != "abc" {
				t.Fatalf("feed = %+v", feed)
			}
		})
	}
}

func TestReleaseAssetOverride(t *testing.T) {
	t.Setenv("AXM_RELEASE_BASE_URL", "http://127.0.0.1:1234/axm/2.0.0/")
	for _, asset := range []string{"axm-version.json", "axm_linux_amd64.tar.gz", "axm_windows_arm64.zip", "checksums.txt", "axiom-corpus-export.tar.zst", "site.tar.zst"} {
		want := "http://127.0.0.1:1234/axm/2.0.0/" + asset
		if got := ReleaseAssetURL("owner/repo", "2.0.0", asset); got != want {
			t.Errorf("%s = %s", asset, got)
		}
		if got := ResolveAssetURL("https://github.com/owner/repo/releases/download/v2.0.0/" + asset); got != want {
			t.Errorf("compiled URL = %s", got)
		}
	}
}

func TestReadVersionFeed_Offline(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	base := srv.URL
	srv.Close()
	t.Setenv("AXM_RELEASE_BASE_URL", base)
	if _, err := ReadVersionFeed(context.Background(), nil, "owner/repo"); err == nil {
		t.Fatal("offline feed succeeded")
	}
}

func TestReleaseClientFollowsAnonymousCDNRedirect(t *testing.T) {
	cdnCalls := 0
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cdnCalls++
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-Serverless-Authorization") != "" {
			t.Error("CDN received credentials")
		}
		if !strings.HasPrefix(r.Header.Get("User-Agent"), "axm/") {
			t.Errorf("User-Agent = %q", r.Header.Get("User-Agent"))
		}
		_, _ = w.Write([]byte(`{"cli":{"current":"2.0.0"}}`))
	}))
	defer cdn.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, cdn.URL+"/feed", http.StatusFound) }))
	defer origin.Close()
	t.Setenv("AXM_RELEASE_BASE_URL", origin.URL)
	feed, err := ReadVersionFeed(context.Background(), newReleaseClient(), "owner/repo")
	if err != nil || feed.CLI.Current != "2.0.0" || cdnCalls != 1 {
		t.Fatalf("redirect: feed=%+v calls=%d error=%v", feed, cdnCalls, err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
