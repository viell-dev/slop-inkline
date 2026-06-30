import fs from "fs";
import process from "process";

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
  throw new Error("Missing npm_package_version.");
}

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
fs.writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);

const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
fs.writeFileSync("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);

