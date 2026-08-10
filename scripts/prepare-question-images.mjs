import {readdir, mkdir} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const sourceRoot = path.resolve("Drill_Instructor/assets/images");
const outputRoot = path.resolve("public/question-images");

async function transformDirectory(directory, relative = "") {
  const entries = await readdir(directory, {withFileTypes: true});
  for (const entry of entries) {
    const source = path.join(directory, entry.name);
    const nextRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await transformDirectory(source, nextRelative);
      continue;
    }
    if (!/\.(png|jpe?g)$/i.test(entry.name)) continue;
    const destination = path.join(
      outputRoot,
      nextRelative.replace(/\.[^.]+$/, ".webp"),
    );
    await mkdir(path.dirname(destination), {recursive: true});
    await sharp(source)
      .resize({width: 1600, withoutEnlargement: true})
      .webp({quality: 82, effort: 4})
      .toFile(destination);
  }
}

await transformDirectory(sourceRoot);
