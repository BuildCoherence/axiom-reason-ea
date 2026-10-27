import type { MetadataRoute } from "next";

import { loadCorpusIndex, profileUsernames } from "@/lib/page-data";
import { SITE_URL, SITEMAP_STATIC_PATHS } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const index = loadCorpusIndex();
  const paths = [
    ...SITEMAP_STATIC_PATHS,
    ...index.files.map((f) => `/f/${f.id}`),
    ...profileUsernames().map((name) => `/u/${encodeURIComponent(name)}`),
    ...index.theorems.map((id) => `/theorem/${id}`),
  ];
  return paths.map((p) => ({
    url: new URL(p, SITE_URL).toString(),
    lastModified: index.frozen_at,
  }));
}
