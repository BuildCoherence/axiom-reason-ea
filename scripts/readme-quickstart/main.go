// Command readme-quickstart prints one part of the README's Quickstart block
// so the readme-quickstart workflow runs the README's own lines, verbatim.
//
// The first fenced block under "## Quickstart" splits into:
//   - install: the line piped to sh (-os unix) or to iex (-os windows);
//   - setup: every other line except the agent launch (claude, codex) and the viewer;
//   - viewer: the `axm viewer` line, which blocks, so the workflow runs it in the background.
//
// -release-urls replaces the hosted installer URLs in the install line with
// the latest GitHub Release's installer assets.
//
// Usage (from the repository root):
//
//	go run ./scripts/readme-quickstart -os unix|windows -part install|setup|viewer [-release-urls] [-readme README.md]
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
)

const (
	quickstartHeading = "## Quickstart"
	fence             = "```"

	hostedInstaller   = "https://install.axiom.computer"
	hostedInstallerPS = hostedInstaller + "/install.ps1"
	releaseDownload   = "https://github.com/BuildCoherence/axiom-reason-ea/releases/latest/download/"
)

// releaseURLs maps the hosted installer URLs to the Release assets they
// redirect to. The longer URL comes first because strings.Replacer tries
// old strings in argument order at each position.
var releaseURLs = strings.NewReplacer(
	hostedInstallerPS, releaseDownload+"install.ps1",
	hostedInstaller, releaseDownload+"install.sh",
)

// agentLaunchers are the interactive agents the Quickstart starts; CI cannot drive them.
var agentLaunchers = []string{"claude", "codex"}

// Quickstart is the classified Quickstart block.
type Quickstart struct {
	Install map[string]string // keyed by -os value
	Setup   []string
	Viewer  string
}

func main() {
	osName := flag.String("os", "", "unix or windows")
	part := flag.String("part", "", "install, setup or viewer")
	release := flag.Bool("release-urls", false, "replace the hosted installer URLs with the latest Release's assets")
	readme := flag.String("readme", "README.md", "path to the README")
	flag.Parse()
	os.Exit(run(*readme, *osName, *part, *release, os.Stdout, os.Stderr))
}

func run(readmePath, osName, part string, release bool, stdout, stderr io.Writer) int {
	out, err := render(readmePath, osName, part, release)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "readme-quickstart: %v\n", err)
		return 1
	}
	_, _ = io.WriteString(stdout, out)
	return 0
}

func render(readmePath, osName, part string, release bool) (string, error) {
	if osName != "unix" && osName != "windows" {
		return "", fmt.Errorf("-os must be unix or windows, not %q", osName)
	}
	src, err := os.ReadFile(readmePath)
	if err != nil {
		return "", err
	}
	q, err := Parse(string(src))
	if err != nil {
		return "", fmt.Errorf("%s: %w", readmePath, err)
	}
	switch part {
	case "install":
		line := q.Install[osName]
		if release {
			if !strings.Contains(line, hostedInstaller) {
				return "", fmt.Errorf("-release-urls: the %s install line has no %s URL: %s", osName, hostedInstaller, line)
			}
			line = releaseURLs.Replace(line)
		}
		return line + "\n", nil
	case "setup":
		return strings.Join(q.Setup, "\n") + "\n", nil
	case "viewer":
		return q.Viewer + "\n", nil
	}
	return "", fmt.Errorf("-part must be install, setup or viewer, not %q", part)
}

// Parse classifies the lines of the first fenced block under the Quickstart heading.
func Parse(readme string) (Quickstart, error) {
	block, err := quickstartBlock(readme)
	if err != nil {
		return Quickstart{}, err
	}
	q := Quickstart{Install: map[string]string{}}
	for _, line := range block {
		cmd := command(line)
		fields := strings.Fields(cmd)
		switch {
		case len(fields) == 0:
		case slices.Contains(agentLaunchers, fields[0]):
		case len(fields) >= 2 && fields[0] == "axm" && fields[1] == "viewer":
			if q.Viewer != "" {
				return Quickstart{}, errors.New("the Quickstart block has more than one `axm viewer` line")
			}
			q.Viewer = line
		case strings.HasSuffix(cmd, "| sh"):
			if err := setInstall(q.Install, "unix", line); err != nil {
				return Quickstart{}, err
			}
		case strings.HasSuffix(cmd, "| iex"):
			if err := setInstall(q.Install, "windows", line); err != nil {
				return Quickstart{}, err
			}
		default:
			q.Setup = append(q.Setup, line)
		}
	}
	for _, osName := range []string{"unix", "windows"} {
		if q.Install[osName] == "" {
			return Quickstart{}, fmt.Errorf("the Quickstart block has no %s install line", osName)
		}
	}
	if q.Viewer == "" {
		return Quickstart{}, errors.New("the Quickstart block has no `axm viewer` line")
	}
	if len(q.Setup) == 0 {
		return Quickstart{}, errors.New("the Quickstart block has no setup lines")
	}
	return q, nil
}

func setInstall(install map[string]string, osName, line string) error {
	if install[osName] != "" {
		return fmt.Errorf("the Quickstart block has more than one %s install line", osName)
	}
	install[osName] = line
	return nil
}

// quickstartBlock returns the lines of the first fenced block between the
// Quickstart heading and the next level-2 heading.
func quickstartBlock(readme string) ([]string, error) {
	lines := strings.Split(strings.ReplaceAll(readme, "\r\n", "\n"), "\n")
	start := slices.IndexFunc(lines, func(l string) bool { return strings.TrimSpace(l) == quickstartHeading })
	if start < 0 {
		return nil, errors.New("no " + quickstartHeading + " heading")
	}
	var block []string
	open := false
	for _, l := range lines[start+1:] {
		switch {
		case !open && strings.HasPrefix(l, "## "):
			return nil, errors.New("no fenced block under " + quickstartHeading)
		case strings.HasPrefix(l, fence):
			if open {
				return block, nil
			}
			open = true
		case open:
			block = append(block, strings.TrimRight(l, " \t"))
		}
	}
	return nil, errors.New("no closed fenced block under " + quickstartHeading)
}

// command drops a trailing shell comment; sh and PowerShell both start one at
// a `#` that follows whitespace.
func command(line string) string {
	if i := strings.Index(line, " #"); i >= 0 {
		line = line[:i]
	}
	return strings.TrimSpace(line)
}
