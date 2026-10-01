import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js"]) {
  await cp(file, `dist/${file}`);
}
await cp("icons", "dist/icons", { recursive: true });
console.log("Build terminé : dist/");
