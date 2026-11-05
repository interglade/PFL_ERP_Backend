import * as fs from 'fs';
import * as path from 'path';

/**
 * Reads every controller and lists its routes with the middleware named in the decorators
 * (static scan; used by routeGuards.spec.ts).
 */

export interface ScannedRoute {
  file: string;
  controllerPath: string;
  controllerArgs: string;
  method: string;
  path: string;
  routeArgs: string;
}

const SRC = path.join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.controllers?\.ts$/.test(entry.name) || /controller\.ts$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/** Text of the balanced (...) call starting at `open` (index of '('), without the parens. */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

/** Drops // line comments and /* *\/ blocks so commented-out routes are ignored. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export function scanRoutes(): ScannedRoute[] {
  const routes: ScannedRoute[] = [];
  for (const file of walk(SRC)) {
    const source = stripComments(fs.readFileSync(file, 'utf-8'));
    const ctl = /@controller\(/.exec(source);
    if (!ctl) continue;
    const controllerArgs = callArgs(source, ctl.index + '@controller'.length);
    const controllerPath = (/['"`]([^'"`]*)['"`]/.exec(controllerArgs) ?? [])[1] ?? '';
    const decorator = /@http(Get|Post|Put|Patch|Delete)\(/g;
    let m: RegExpExecArray | null;
    while ((m = decorator.exec(source))) {
      const routeArgs = callArgs(source, m.index + m[0].length - 1);
      const routePath = (/^\s*['"`]([^'"`]*)['"`]/.exec(routeArgs) ?? [])[1] ?? '';
      routes.push({
        file: path.relative(SRC, file).replace(/\\/g, '/'),
        controllerPath,
        controllerArgs,
        method: m[1].toUpperCase(),
        path: routePath,
        routeArgs,
      });
    }
  }
  return routes;
}
