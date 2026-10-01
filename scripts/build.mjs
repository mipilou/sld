import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of ["index.html", "styles.css", "manifest.webmanifest", "sw.js"]) {
  await cp(file, `dist/${file}`);
}
await build({entryPoints:["app.js"],outfile:"dist/app.js",bundle:true,platform:"browser",format:"esm",target:"es2022",minify:true});
await cp("icons", "dist/icons", { recursive: true });
console.log("Build terminé : dist/");
