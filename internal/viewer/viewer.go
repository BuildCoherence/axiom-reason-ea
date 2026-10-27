// Package viewer serves an installed Axiom Site Archive, and optionally a
// Workspace's files, to a browser on loopback.
package viewer

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	// LoopbackHost is the only address the viewer listens on.
	LoopbackHost = "127.0.0.1"

	filesAPIPath   = "/local/api/files"
	fileAPIPath    = "/local/api/file"
	fileQueryParam = "path"
	notFoundPage   = "404.html"
	indexPage      = "index.html"
	sourceExt      = ".lean"
)

// Listen binds LoopbackHost:port; port 0 picks a free port.
func Listen(port int) (net.Listener, error) {
	ln, err := net.Listen("tcp", net.JoinHostPort(LoopbackHost, strconv.Itoa(port)))
	if err != nil {
		if port != 0 {
			return nil, fmt.Errorf("cannot serve on port %d: %w", port, err)
		}
		return nil, fmt.Errorf("listening on %s: %w", LoopbackHost, err)
	}
	return ln, nil
}

// Handler serves the site and, when a Workspace is given, the read-only /local API.
type Handler struct {
	site      *os.Root
	workspace *os.Root
	hosts     map[string]bool
}

// NewHandler serves siteDir to requests addressed to 127.0.0.1:port or
// localhost:port; workspaceDir may be empty.
func NewHandler(siteDir, workspaceDir string, port int) (*Handler, error) {
	site, err := os.OpenRoot(siteDir)
	if err != nil {
		return nil, fmt.Errorf("opening the site archive: %w", err)
	}
	h := &Handler{site: site, hosts: map[string]bool{
		net.JoinHostPort(LoopbackHost, strconv.Itoa(port)): true,
		net.JoinHostPort("localhost", strconv.Itoa(port)):  true,
	}}
	if workspaceDir != "" {
		if h.workspace, err = os.OpenRoot(workspaceDir); err != nil {
			site.Close()
			return nil, fmt.Errorf("opening the Workspace: %w", err)
		}
	}
	return h, nil
}

// Close releases the site and Workspace directory handles.
func (h *Handler) Close() error {
	var errs []error
	errs = append(errs, h.site.Close())
	if h.workspace != nil {
		errs = append(errs, h.workspace.Close())
	}
	return errors.Join(errs...)
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Any other Host is a DNS-rebinding attempt to read Workspace files cross-site.
	if !h.hosts[strings.ToLower(r.Host)] {
		http.Error(w, "forbidden host", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.workspace != nil {
		switch r.URL.Path {
		case filesAPIPath:
			h.serveFileList(w)
			return
		case fileAPIPath:
			h.serveWorkspaceFile(w, r)
			return
		}
	}
	h.serveSite(w, r)
}

// serveSite resolves /x to x, then x.html, as the archive's static host does.
func (h *Handler) serveSite(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	candidates := []string{indexPage}
	if rel != "" {
		candidates = []string{rel, rel + ".html"}
	}
	for _, name := range candidates {
		if serveRegular(w, r, h.site, name, "") {
			return
		}
	}
	page, err := h.site.ReadFile(notFoundPage)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write(page)
}

type workspaceFile struct {
	Path string `json:"path"`
}

// serveFileList lists every .lean file outside dot-directories (.lake, .git, .axiomdata).
func (h *Handler) serveFileList(w http.ResponseWriter) {
	files := []workspaceFile{}
	err := fs.WalkDir(h.workspace.FS(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != "." && strings.HasPrefix(d.Name(), ".") {
				return fs.SkipDir
			}
			return nil
		}
		if d.Type().IsRegular() && path.Ext(p) == sourceExt {
			files = append(files, workspaceFile{Path: p})
		}
		return nil
	})
	if err != nil {
		http.Error(w, "listing the Workspace failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Files []workspaceFile `json:"files"`
	}{files})
}

// serveWorkspaceFile serves one file; os.Root rejects absolute paths and
// any `..`, symlink or junction that leaves the Workspace.
func (h *Handler) serveWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get(fileQueryParam)
	if name == "" || !serveRegular(w, r, h.workspace, filepath.FromSlash(name), "text/plain; charset=utf-8") {
		http.NotFound(w, r)
	}
}

// serveRegular serves name from root if it is a regular file, reporting whether it did;
// an empty contentType is inferred from the extension.
func serveRegular(w http.ResponseWriter, r *http.Request, root *os.Root, name, contentType string) bool {
	f, err := root.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return true
}
