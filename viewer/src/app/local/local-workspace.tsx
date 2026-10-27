"use client";

import type { Root } from "hast";
import * as React from "react";

import { buildDecorations } from "@/components/lean-ui/ce-file-decorations";
import leanCodeStyles from "@/components/lean-ui/lean-code.module.css";
import {
  buildByteToCharMap,
  highlightLeanToHast,
} from "@/components/lean-ui/lean-highlighter";
import { renderHast } from "@/components/lean-ui/render-hast";
import { isLoopbackHost } from "@/lib/loopback";

import { localFileRefs } from "./local-file-refs";

// Served by `axm viewer` only: `files` lists the Workspace's files as
// `{"files": [{"path": "<workspace-relative path>"}]}`; `file?path=` returns
// one file's source as text.
const LOCAL_FILES_PATH = "/local/api/files";
const localFilePath = (path: string) =>
  `/local/api/file?path=${encodeURIComponent(path)}`;
const PATH_PARAM = "path";

interface LocalFile {
  path: string;
}

type Listing =
  | { status: "checking" }
  | { status: "unavailable" }
  | { status: "ready"; files: LocalFile[] };

async function fetchListing(): Promise<LocalFile[]> {
  const res = await fetch(LOCAL_FILES_PATH);
  if (!res.ok) throw new Error(`GET ${LOCAL_FILES_PATH} returned ${res.status}`);
  const body = (await res.json()) as { files?: unknown };
  if (!Array.isArray(body.files)) {
    throw new Error(`GET ${LOCAL_FILES_PATH} returned no files list`);
  }
  return body.files.filter(
    (f): f is LocalFile => typeof (f as LocalFile)?.path === "string",
  );
}

export function LocalWorkspace() {
  const [listing, setListing] = React.useState<Listing>({ status: "checking" });
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isLoopbackHost(window.location.hostname)) {
      setListing({ status: "unavailable" });
      return;
    }
    let cancelled = false;
    fetchListing().then(
      (files) => {
        if (cancelled) return;
        setListing({ status: "ready", files });
        setSelected(
          new URLSearchParams(window.location.search).get(PATH_PARAM),
        );
      },
      (err: unknown) => {
        if (cancelled) return;
        console.info("local workspace unavailable:", err);
        setListing({ status: "unavailable" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const select = React.useCallback((path: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(PATH_PARAM, path);
    window.history.replaceState(null, "", url);
    setSelected(path);
  }, []);

  if (listing.status === "checking") {
    return (
      <p className="px-4 py-16 text-center text-muted-foreground" role="status">
        Looking for your workspace…
      </p>
    );
  }
  if (listing.status === "unavailable") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <p className="text-lg text-foreground">
          Your workspace appears only in <code>axm viewer</code>
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:flex-row">
      <nav aria-label="Workspace files" className="shrink-0 md:w-64">
        <h1 className="mb-3 text-lg font-semibold text-foreground">
          Your workspace
        </h1>
        {listing.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files.</p>
        ) : (
          <ul className="space-y-1">
            {listing.files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  aria-current={f.path === selected ? "page" : undefined}
                  onClick={() => select(f.path)}
                  className="w-full truncate rounded-md px-2 py-1 text-left font-mono text-sm text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <section aria-label="Source" className="min-w-0 flex-1">
        {selected === null ? (
          <p className="text-sm text-muted-foreground">
            Choose a file to view its source.
          </p>
        ) : (
          <LocalSource key={selected} path={selected} />
        )}
      </section>
    </div>
  );
}

type SourceState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "text"; text: string }
  | { status: "highlighted"; text: string; hast: Root };

function LocalSource({ path }: { path: string }) {
  const [state, setState] = React.useState<SourceState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    fetch(localFilePath(path))
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${localFilePath(path)} returned ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        setState({ status: "text", text });
        const decorations = buildDecorations(
          [],
          localFileRefs(text),
          text,
          buildByteToCharMap(text),
        );
        const hast = await highlightLeanToHast(text, decorations);
        if (!cancelled) setState({ status: "highlighted", text, hast });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error(`local file ${path} failed:`, err);
        setState((prev) => (prev.status === "text" ? prev : { status: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const tree = React.useMemo(
    () => (state.status === "highlighted" ? renderHast(state.hast, "local") : null),
    [state],
  );

  if (state.status === "loading") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading {path}…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="text-sm text-destructive" role="alert">
        Couldn&apos;t read {path}.
      </p>
    );
  }
  return (
    <div
      className={leanCodeStyles.leanCode}
      tabIndex={0}
      aria-label={`${path} source`}
      data-highlighted={state.status === "highlighted" || undefined}
    >
      {tree ?? <pre>{state.text}</pre>}
    </div>
  );
}
