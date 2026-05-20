import fs from "fs";
import path from "path";

const pagesDir = path.join("src", "pages");
const files = fs
  .readdirSync(pagesDir)
  .filter((f) => f.endsWith(".tsx") && f !== "Dashboard.tsx" && f !== "DashboardLegacy.tsx");

const importLine =
  'import { DashboardPageMain } from "@/components/layout/DashboardPageMain";\n';

for (const file of files) {
  const fp = path.join(pagesDir, file);
  let src = fs.readFileSync(fp, "utf8");
  if (!src.includes("TopTieringPageFrame")) continue;
  if (src.includes("DashboardPageMain")) continue;

  // Pattern: main + inner max-w wrapper
  const mainInnerRe =
    /<main className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 sm:py-3">\s*\n\s*<div className="max-w-\[1800px\] mx-auto">/;
  if (mainInnerRe.test(src)) {
    if (!src.includes("DashboardPageMain")) {
      src = src.replace(
        /import \{ TopTieringPageFrame \}/,
        `import { DashboardPageMain } from "@/components/layout/DashboardPageMain";\nimport { TopTieringPageFrame }`,
      );
    }
    src = src.replace(mainInnerRe, "<DashboardPageMain>\n");
    // Remove one closing </div> before </main> inside TopTieringPageFrame — fragile
    src = src.replace(
      /(<\/div>)\s*\n(\s*)<\/main>\s*\n(\s*)<\/TopTieringPageFrame>/,
      "$2</DashboardPageMain>\n$3</TopTieringPageFrame>",
    );
    fs.writeFileSync(fp, src);
    console.log("main+inner", file);
    continue;
  }

  // Pattern: main only (no inner div) with standard scroll — add DashboardPageMain
  const mainOnlyRe =
    /<main className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 sm:py-3">/;
  if (mainOnlyRe.test(src)) {
    src = src.replace(
      /import \{ TopTieringPageFrame \}/,
      `import { DashboardPageMain } from "@/components/layout/DashboardPageMain";\nimport { TopTieringPageFrame }`,
    );
    src = src.replace(mainOnlyRe, "<DashboardPageMain>");
    src = src.replace(
      /(<\/main>)\s*\n(\s*)<\/TopTieringPageFrame>/,
      "</DashboardPageMain>\n$2</TopTieringPageFrame>",
    );
    fs.writeFileSync(fp, src);
    console.log("main-only", file);
  }
}
