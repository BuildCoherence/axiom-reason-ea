package cmd

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"time"

	"github.com/pkg/browser"
	"github.com/spf13/cobra"

	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/axmindex"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/corpus"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/progress"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/upgrade"
	"github.com/BuildCoherence/axiom-reason-ea/v2/internal/viewer"
)

const (
	viewerReadHeaderTimeout = 10 * time.Second
	viewerShutdownTimeout   = 5 * time.Second
)

// openViewerURL opens the default browser; tests replace it.
var openViewerURL = browser.OpenURL

var errSiteNotInstalled = errors.New("no Axiom site archive is installed; run `axm upgrade`")

func init() {
	rootCmd.AddCommand(newViewerCmd())
}

func newViewerCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "viewer",
		Short: "Browse the installed Axiom archive and your Workspace offline",
		Long: "Serve the installed Axiom site archive and Published Corpus on 127.0.0.1 and open it in your browser.\n\n" +
			"Inside a Workspace, the Workspace page (/local) also shows your .lean files, read-only. " +
			"Everything is served from local files; run `" + binaryName + " upgrade` to install or refresh them. " +
			"Press Ctrl+C to stop.",
		Args:         cobra.NoArgs,
		SilenceUsage: true,
		RunE:         runViewer,
	}
	c.Flags().Int("port", 0, "port to serve on (default: a free port)")
	c.Flags().Bool("no-open", false, "print the URL without opening a browser")
	return c
}

func runViewer(cmd *cobra.Command, _ []string) error {
	port, _ := cmd.Flags().GetInt("port")
	noOpen, _ := cmd.Flags().GetBool("no-open")
	if _, err := corpus.OpenInstalled(); err != nil {
		return err
	}
	site, err := installedSite()
	if err != nil {
		return err
	}
	workspace := ""
	switch idx, err := axmindex.Open("."); {
	case err == nil:
		workspace = idx.Root()
	case !errors.Is(err, axmindex.ErrNoWorkspace):
		return err
	}

	ln, err := viewer.Listen(port)
	if err != nil {
		return err
	}
	port = ln.Addr().(*net.TCPAddr).Port
	handler, err := viewer.NewHandler(site, workspace, port)
	if err != nil {
		ln.Close()
		return err
	}
	defer handler.Close()

	url := "http://" + viewer.LoopbackHost + ":" + strconv.Itoa(port) + "/"
	out := cmd.OutOrStdout()
	progress.Successf(out, "Axiom viewer: %s", url)
	if workspace != "" {
		fmt.Fprintf(out, "  your Workspace: %slocal\n", url)
	}
	fmt.Fprintln(out, "  press Ctrl+C to stop")
	if !noOpen {
		if err := openViewerURL(url); err != nil {
			progress.Warnf(cmd.ErrOrStderr(), "could not open a browser (%v); open %s yourself", err, url)
		}
	}

	ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt)
	defer stop()
	srv := &http.Server{Handler: handler, ReadHeaderTimeout: viewerReadHeaderTimeout}
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()
	select {
	case err := <-served:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), viewerShutdownTimeout)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

// installedSite returns the active ~/.axiom/site install, which shares the corpus install layout.
func installedSite() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("locating home directory: %w", err)
	}
	dir, err := corpus.ActiveInstall(filepath.Join(home, ".axiom", upgrade.SiteKind))
	if errors.Is(err, corpus.ErrNotInstalled) {
		return "", errSiteNotInstalled
	}
	return dir, err
}
