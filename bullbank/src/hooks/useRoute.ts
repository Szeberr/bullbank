import { useEffect, useState } from "react";

export type Route = "app" | "how" | "proof";

/**
 * Hash routing, deliberately not a router library.
 *
 * Three pages. Pulling in react-router for that would add a dependency
 * and build-config surface for no gain. Hashes also mean the site works on any
 * static host with no rewrite rules — drop the dist folder anywhere and
 * /#/how still resolves, which plain path routing cannot promise.
 */
function read(): Route {
  const slug = window.location.hash.replace(/^#\/?/, "");
  return slug === "how" || slug === "proof" ? slug : "app";
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onHash = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = r === "app" ? "/" : `/${r}`;
  };

  return [route, navigate];
}
