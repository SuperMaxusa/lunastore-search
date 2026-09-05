// Server for OpenSearch suggestions from LunaStore V2 API [wip]

import { TtlCache } from "jsr:@std/cache@^0.2.4/ttl-cache";
import indexPageFile from "./index.html" with { type: "text" };

const LUNASTORE_API_BASE = Deno.env.get("LUNASTORE_API_BASE") || "https://api.lunastore.app";
const LUNASTORE_SITE_BASE = Deno.env.get("LUNASTORE_SITE_BASE") || "http://lunastore.app";
const SEARCH_LIMIT = +Deno.env.get("SEARCH_LIMIT") || 10;
const CACHE_TTL = +Deno.env.get("CACHE_TTL") || 300;
const API_LANGUAGE = Deno.env.get("API_LANGUAGE") || "en";

const cache = new TtlCache<string, object[]>(CACHE_TTL);

async function getResults(query: string): Promise<string[]> {
  const cacheHit = cache.get(query);
  if (cacheHit !== undefined) {
    return cacheHit;
  }

  const apiRequest = await fetch(
    `${LUNASTORE_API_BASE}/v2/marketplace/search/?query=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`,
    {
      headers: {
        "Accept": "application/json",
        "Accept-Language": API_LANGUAGE, // todo: parse this value from client
      },
    },
  );

  if (!apiRequest.ok) {
    const errorText = await apiRequest.text();
    console.error(
      "Error from API: %s [%d]",
      errorText || "(no text)",
      apiRequest.statusCode
    );
    return [];
  }

  const apiResults = await apiRequest.json();
  const results = Object.values(apiResults.results).map((x) => x.title);
  cache.set(query, results);
  return results;
}

type EndpointHandlerType = (req: Request, url: URL) => Response;

const indexPage: EndpointHandlerType = (_req: Request, _url: URL) => {
  return new Response(indexPageFile, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

const serverCheck: EndpointHandlerType = (_req: Request, _url: URL) => {
  return new Response("window.EXTERNAL_SERVER=true;", {
    headers: { "Content-Type": "text/javascript" },
  });
};

const osDescription: EndpointHandlerType = (req: Request, url: URL) => {
  const host = url.origin || ("http://" + req.headers.host);
  return new Response(
    `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:moz="http://www.mozilla.org/2006/browser/search/">
  <ShortName>LunaStore</ShortName>
  <InputEncoding>UTF-8</InputEncoding>
  <Description>App store for Windows XP</Description>
  <Image width="16" height="16" type="image/x-icon">${LUNASTORE_SITE_BASE}/staticfiles/favicon.ico</Image>
  <Tags>lunastore</Tags>
  <Url type="text/html" method="get" template="${LUNASTORE_SITE_BASE}/search.php?q={searchTerms}" />
  <Url type="application/x-suggestions+json" rel="suggestions" template="${host}/suggestions?q={searchTerms}" />
  <moz:SearchForm>${host}/</moz:SearchForm>
</OpenSearchDescription>`,
    {
      headers: {
        "Content-Type": "application/opensearchdescription+xml",
      },
    },
  );
};

const osSuggestions: EndpointHandlerType = async (_req: Request, url: URL) => {
  if (!url.searchParams.has("q")) {
    return new Response("no query", { statusCode: 400 });
  }

  const query = url.searchParams.get("q");
  const results = await getResults(query);
  return Response.json([query, results]);
};

const notFound: EndpointHandlerType = () => new Response("Not found", { statusCode: 404 });

const routes: Record<string, EndpointHandlerType> = {
  "/": indexPage,
  "/opensearch.xml": osDescription,
  "/suggestions": osSuggestions,
  "/server-check.js": serverCheck,
};

export default {
  fetch(req: Request): Response | Promise<Response> {
    const url = new URL(req.url);

    if (req.method !== "GET") {
      return new Response("Unknown method", { statusCode: 405 });
    }

    const endpointHandler = routes[url.pathname] ?? notFound;
    return endpointHandler(req, url);
  },

  onListen({ hostname, port }) {
    console.log(`Server running at http://${hostname}:${port}/`);
  },
} satisfies Deno.ServeDefaultExport;
