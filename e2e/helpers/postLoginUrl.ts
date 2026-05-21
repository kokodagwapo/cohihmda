/** Paths users may land on immediately after login. */
export function isPostLoginPathname(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return (
    path === "/" ||
    path === "/insights" ||
    path === "/my-dashboard" ||
    path.startsWith("/my-dashboard/")
  );
}

export function isPostLoginUrl(url: string | URL): boolean {
  return isPostLoginPathname(new URL(url).pathname);
}
