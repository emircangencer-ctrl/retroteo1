import { parseRoute, routeHref, type Route, type RouteName } from './route.ts';

type Query = Record<string, string | number | boolean | undefined>;

class Router {
  route = $state<Route>(parseRoute(globalThis.location?.hash || ''));
  /** Hashes visited in this page session, to tell whether "back" stays inside the app. */
  #stack: string[] = [globalThis.location?.hash || '#/'];

  constructor() {
    globalThis.addEventListener?.('hashchange', () => {
      const hash = location.hash || '#/';
      if (this.#stack.length > 1 && this.#stack[this.#stack.length - 2] === hash) this.#stack.pop();
      else if (this.#stack[this.#stack.length - 1] !== hash) this.#stack.push(hash);
      this.route = parseRoute(hash);
    });
  }

  go(name: RouteName, id = '', query: Query = {}, { replace = false } = {}) {
    const href = routeHref(name, id, query);
    if (replace) {
      try { history.replaceState(history.state, '', href); } catch {}
      this.#stack[this.#stack.length - 1] = href;
      this.route = parseRoute(href);
    } else if (location.hash !== href) {
      location.hash = href;
    } else {
      this.route = parseRoute(href);
    }
  }

  /** Back to the previous screen of the app, or to `fallback` when the app was opened here. */
  back(fallback: RouteName = 'home') {
    if (this.#stack.length > 1) history.back();
    else this.go(fallback, '', {}, { replace: true });
  }
}

export const router = new Router();
