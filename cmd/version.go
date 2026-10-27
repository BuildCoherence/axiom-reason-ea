package cmd

import (
	"runtime/debug"
	"strings"
)

// version remains linker-settable; module builds resolve the fallback in init.
var version = "dev"

func moduleVersion(info *debug.BuildInfo, ok bool) string {
	if ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return strings.TrimPrefix(info.Main.Version, "v")
	}
	return "dev"
}

func resolveVersion(explicit string) string {
	if explicit != "dev" {
		return explicit
	}
	return moduleVersion(debug.ReadBuildInfo())
}
