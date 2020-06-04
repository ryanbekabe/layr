import type {Component} from '@liaison/component';
import {
  AbstractRouter,
  AbstractRouterOptions,
  normalizeURL,
  stringifyURL
} from '@liaison/abstract-router';
import {PlainObject} from 'core-helpers';

declare global {
  interface Function {
    Link: (props: {params?: PlainObject} & PlainObject) => any;
  }
}

export type BrowserRouterLinkProps = {
  to: string;
  className?: string;
  activeClassName?: string;
  style?: React.CSSProperties;
  activeStyle?: React.CSSProperties;
};

export type BrowserRouterOptions = AbstractRouterOptions;

export class BrowserRouter extends AbstractRouter {
  constructor(rootComponent?: typeof Component, options: BrowserRouterOptions = {}) {
    super(rootComponent, options);

    window.addEventListener('popstate', () => {
      this.callObservers();
    });
  }

  _getCurrentURL() {
    return normalizeURL(window.location.href);
  }

  _navigate(url: URL) {
    window.history.pushState(null, '', stringifyURL(url));
  }

  _redirect(url: URL) {
    window.history.replaceState(null, '', stringifyURL(url));
  }

  _reload(url?: URL) {
    if (url !== undefined) {
      window.location.assign(stringifyURL(url));
    } else {
      window.location.reload();
    }
  }

  _go(delta: number) {
    window.history.go(delta);
  }

  _getHistoryLength() {
    return window.history.length;
  }

  Link!: (props: BrowserRouterLinkProps) => any;
}
