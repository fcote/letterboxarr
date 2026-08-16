// How a watch item is addressed, on the screen and in the configuration form.
//
// A watch item is normally the path after letterboxd.com, but a whole link is
// taken as it stands: a private list shared "with anyone" is only reachable
// through the secret boxd.it link its share menu hands out, and that link is
// all there is to configure. It is not, however, anything to read — boxd.it/xyz
// names nothing. So a crawl records where the path actually landed, and that is
// what these show in its place.

const LINK = /^(?:https?:\/\/)?(?:www\.)?(?:letterboxd\.com|boxd\.it)(\/|$)/i;

/** Whether a watch item was given a whole link rather than a path */
export const isLink = (path: string): boolean => LINK.test(path.trim());

/**
 * A watch item's address, host and all: 'letterboxd.com/director/james-gray'.
 *
 * A share link lands on the list with its secret still on the end, as
 * '/<member>/list/<slug>/share/<secret>/'. That last part is how the page was
 * reached rather than which list it is, and it is the half of the address with
 * nothing to read in it, so the name of the list is shown without it. The
 * secret stays in the stored address, which is the one that actually opens.
 *
 * Falls back to the path as configured until a crawl has been able to say where
 * it leads, which for a share link means the boxd.it code itself.
 */
export const watchItemAddress = (item: { path: string; url?: string | null }): string => {
  const address = item.url || (isLink(item.path) ? item.path : `letterboxd.com/${item.path}`);
  return address
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/(\/list\/[^/]+)\/share\/[^/]+$/i, '$1');
};

/** The same address without its host, for the places already saying whose it is */
export const watchItemPath = (item: { path: string; url?: string | null }): string =>
  watchItemAddress(item).replace(/^letterboxd\.com\//i, '');
