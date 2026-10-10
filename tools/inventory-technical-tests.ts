import ts from "typescript";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|js)$/.test(entry.name) ? [path] : [];
  });
}
const paths = [...files(join(root, "src")), ...files(join(root, "worker/src")), ...files(join(root, "public")), ...files(join(root, "tools")).filter(path => /test-[^/\\]+\.ts$/.test(path))];
const known = new Set(paths);
const normalize = (path: string) => relative(root, path).replace(/\\/g, "/");
const modules = paths.map(path => {
  const text = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports = new Set<string>();
  const exports = new Set<string>();
  const dependencies = new Set<string>();
  function capture(value: string) {
    imports.add(value);
    if (!value.startsWith(".")) return;
    const base = resolve(dirname(path), value);
    const target = [base, `${base}.ts`, `${base}.js`, join(base, "index.ts")].find(candidate => known.has(candidate));
    if (target) dependencies.add(normalize(target));
  }
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) capture(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) capture(node.arguments[0].text);
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) exports.add(node.name.text);
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) exports.add(declaration.name.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { path: normalize(path), lines: text.split(/\r?\n/).length, imports: [...imports], exports: [...exports], dependencies: [...dependencies] };
});
const byPath = new Map(modules.map(module => [module.path, module]));
const tests = modules.filter(module => module.path.startsWith("tools/test-"));
const reachedBy = new Map<string, Set<string>>();
for (const test of tests) {
  const visited = new Set<string>();
  const pending = [test.path];
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const set = reachedBy.get(path) ?? new Set<string>();
    set.add(test.path);
    reachedBy.set(path, set);
    pending.push(...(byPath.get(path)?.dependencies ?? []));
  }
}
const output = join(root, "artifacts/technical-tests/module-inventory.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  generatedAt: new Date().toISOString(),
  warning: "Static import reachability is NOT execution, assertion, line or branch coverage. Browser page imports and VM-loaded JavaScript are not captured as runtime coverage.",
  modules: modules.map(module => ({ ...module, staticallyReachedByTests: [...(reachedBy.get(module.path) ?? [])] })),
}, null, 2));
console.log(`${modules.length} modules inventoried, ${tests.length} test suites. ${output}`);
