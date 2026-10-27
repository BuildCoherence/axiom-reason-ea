package upgrade

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"

	"golang.org/x/mod/semver"
)

const versionFeedAsset = "axm-version.json"

var siteAssetRe = regexp.MustCompile(`^axiom-site-[0-9A-Za-z.+-]+\.tar\.zst$`)

// ErrRateLimited distinguishes release throttling from artifact integrity failures.
var ErrRateLimited = errors.New("release downloads are rate limited; try again later")

// VersionFeed preserves the hosted feed's wire shape and adds the site asset.
type VersionFeed struct {
	CLI struct {
		Min     string `json:"min"`
		Current string `json:"current"`
	} `json:"cli"`
	LeanClient struct {
		CurrentTag string `json:"current_tag"`
		RemoteURL  string `json:"remote_url"`
	} `json:"lean_client"`
	Toolchain struct {
		Current string `json:"current"`
	} `json:"toolchain"`
	WebBundle struct {
		CurrentHash string `json:"current_hash"`
	} `json:"web_bundle"`
	Site struct {
		Asset  string `json:"asset"`
		SHA256 string `json:"sha256"`
	} `json:"site"`
}

// ResolveAssetURL maps any release asset, including corpus and site, to the test base.
func ResolveAssetURL(productionURL string) string {
	base := os.Getenv("AXM_RELEASE_BASE_URL")
	if base == "" {
		return productionURL
	}
	parsed, err := url.Parse(productionURL)
	if err != nil {
		return productionURL
	}
	return strings.TrimRight(base, "/") + "/" + path.Base(parsed.Path)
}

// ReleaseAssetURL resolves a tagged asset, or the latest feed when version is empty.
func ReleaseAssetURL(repo, version, asset string) string {
	base := "https://github.com/" + repo + "/releases/"
	if version == "" {
		base += "latest/download/"
	} else {
		base += "download/v" + version + "/"
	}
	return ResolveAssetURL(base + asset)
}

// ReadVersionFeed fetches and validates the GitHub Version Feed exactly once.
func ReadVersionFeed(ctx context.Context, client *http.Client, repo string) (*VersionFeed, error) {
	if client == nil {
		client = newReleaseClient()
	}
	body, err := downloadOne(ctx, client, "GitHub Version Feed", ReleaseAssetURL(repo, "", versionFeedAsset), maxSidecarBytes)
	if err != nil {
		return nil, err
	}
	var feed VersionFeed
	if err := json.Unmarshal(body, &feed); err != nil {
		return nil, fmt.Errorf("GitHub Version Feed: decoding response: %w", err)
	}
	if !semver.IsValid("v" + feed.CLI.Current) {
		return nil, fmt.Errorf("GitHub Version Feed: target version %q is not a valid semver", feed.CLI.Current)
	}
	return &feed, nil
}

// SiteAsset validates the feed's site object and resolves it against the latest Release.
func (f *VersionFeed) SiteAsset(repo string) (UserAsset, error) {
	if !siteAssetRe.MatchString(f.Site.Asset) {
		return UserAsset{}, fmt.Errorf("GitHub Version Feed: site asset %q is not an axiom-site-<version>.tar.zst name", f.Site.Asset)
	}
	if !sha256HexRe.MatchString(f.Site.SHA256) {
		return UserAsset{}, fmt.Errorf("GitHub Version Feed: site sha256 %q is not 64 lowercase hex digits", f.Site.SHA256)
	}
	return UserAsset{Kind: SiteKind, URL: ReleaseAssetURL(repo, "", f.Site.Asset), SHA256: f.Site.SHA256}, nil
}
