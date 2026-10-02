export class Router {
  constructor() {
    this.routes = [];
  }

  get(path, handler) {
    this.register("GET", path, handler);
  }

  post(path, handler) {
    this.register("POST", path, handler);
  }

  register(method, path, handler) {
    const paramNames = [];
    const pattern = path.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });

    const regex = new RegExp(`^${pattern}$`);
    this.routes.push({
      method: method.toUpperCase(),
      path,
      regex,
      paramNames,
      handler,
    });
  }

  match(method, url) {
    const parsedUrl = new URL(url, "http://localhost");
    const pathname = parsedUrl.pathname;

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;

      const match = pathname.match(route.regex);
      if (match) {
        const params = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = match[i + 1];
        }

        return {
          handler: route.handler,
          params,
          pathname,
        };
      }
    }

    return null;
  }
}
