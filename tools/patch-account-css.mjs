import { readFileSync, writeFileSync } from "node:fs";
const file = "src/styles.css";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const css = original.replace(/\r\n/g, "\n");
if (css.includes(".account-sync {")) {
  console.log("already present");
} else {
  const add = readFileSync("tools/_patch/account.css.txt", "utf8").replace(/\r\n/g, "\n").trimEnd();
  writeFileSync(file, eol === "\r\n" ? (css + "\n\n" + add + "\n").replace(/\n/g, "\r\n") : css + "\n\n" + add + "\n", "utf8");
  console.log("appended account css");
}