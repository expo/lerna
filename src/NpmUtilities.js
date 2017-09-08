import log from "npmlog";
import path from "path";
import readPkg from "read-pkg";
import writePkg from "write-pkg";

import ChildProcessUtilities from "./ChildProcessUtilities";
import FileSystemUtilities from "./FileSystemUtilities";

// Take a dep like "foo@^1.0.0".
// Return a tuple like ["foo", "^1.0.0"].
// Handles scoped packages.
// Returns undefined for version if none specified.
function splitVersion(dep) {
  return dep.match(/^(@?[^@]+)(?:@(.+))?/).slice(1, 3);
}

export default class NpmUtilities {
  static writeTempPackageJson(directory, dependencies, callback) {
    const packageJsonPath = path.join(directory, "package.json");
    const pkgJson = readPkg.sync(packageJsonPath, { normalize: false });
    const packageJsonBkp = packageJsonPath + ".lerna_backup";
    log.silly("writeTempPackageJson", "backup", packageJsonPath);
    FileSystemUtilities.rename(packageJsonPath, packageJsonBkp, (err) => {
      if (err) {
        log.error("writeTempPackageJson", "problem backing up package.json", err);
        return callback(err);
      }

      const allDeps = dependencies.reduce((deps, { dependency, isDev }) => {
        const [pkg, version] = splitVersion(dependency);
        if (isDev) {
          deps.devDependencies[pkg] = version || "*";
        } else {
          deps.dependencies[pkg] = version || "*";
        }
        return deps;
      }, {
        dependencies: {},
        devDependencies: {}
      })

      const tempJson = Object.assign({}, {
        name: pkgJson.name,
        version: pkgJson.version,
      }, allDeps);

      log.silly("writeTempPackageJson", "writing tempJson", tempJson);
      writePkg(packageJsonPath, tempJson).then(() => callback()).catch(err => callback(err))
    });
  }

  static cleanupTempPackageJson(directory, callback) {
    const packageJson = path.join(directory, "package.json");
    const packageJsonBkp = packageJson + ".lerna_backup";

    log.silly("cleanupTempPackageJson", "cleanup", packageJson);
    // Need to do this one synchronously because we might be doing it on exit.
    FileSystemUtilities.renameSync(packageJsonBkp, packageJson);
    callback();
  }

  static installInDir(directory, dependencies, config, npmGlobalStyle, callback) {
    log.silly("installInDir", path.basename(directory), dependencies);

    // npmGlobalStyle is an optional argument
    if (typeof npmGlobalStyle === "function") {
      callback = npmGlobalStyle;
      npmGlobalStyle = false;
    }

    // Nothing to do if we weren't given any deps.
    if (!(dependencies && dependencies.length)) {
      log.verbose("installInDir", "no dependencies to install");
      return callback();
    }

    // build command, arguments, and options
    const opts = NpmUtilities.getExecOpts(directory, config.registry);
    const args = ["install"];
    let cmd = config.npmClient || "npm";

    if (npmGlobalStyle) {
      cmd = "npm";
      args.push("--global-style");
    }

    if (cmd === "yarn" && config.mutex) {
      args.push("--mutex", config.mutex);
    }

    if (cmd === "yarn") {
      args.push("--non-interactive");
    }

    if (config.npmClientArgs && config.npmClientArgs.length) {
      args.push(...config.npmClientArgs);
    }

    log.silly("installInDir", [cmd, args]);
    ChildProcessUtilities.exec(cmd, args, opts, callback);
  }

  static installInDirOriginalPackageJson(directory, config, npmGlobalStyle, callback) {
    log.silly("installInDir", path.basename(directory));

    // npmGlobalStyle is an optional argument
    if (typeof npmGlobalStyle === "function") {
      callback = npmGlobalStyle;
      npmGlobalStyle = false;
    }

    const packageJson = path.join(directory, "package.json");

    log.silly("installInDir", packageJson);

    // build command, arguments, and options
    const opts = NpmUtilities.getExecOpts(directory, config.registry);
    const args = ["install"];
    let cmd = config.npmClient || "npm";

    if (npmGlobalStyle) {
      cmd = "npm";
      args.push("--global-style");
    }

    if (cmd === "yarn" && config.mutex) {
      args.push("--mutex", config.mutex);
    }

    log.silly("installInDir", [cmd, args]);
    ChildProcessUtilities.exec(cmd, args, opts, callback);
  }


  static addDistTag(directory, packageName, version, tag, registry) {
    log.silly("addDistTag", tag, version, packageName);

    const opts = NpmUtilities.getExecOpts(directory, registry);
    ChildProcessUtilities.execSync("npm", ["dist-tag", "add", `${packageName}@${version}`, tag], opts);
  }

  static removeDistTag(directory, packageName, tag, registry) {
    log.silly("removeDistTag", tag, packageName);

    const opts = NpmUtilities.getExecOpts(directory, registry);
    ChildProcessUtilities.execSync("npm", ["dist-tag", "rm", packageName, tag], opts);
  }

  static checkDistTag(directory, packageName, tag, registry) {
    log.silly("checkDistTag", tag, packageName);

    const opts = NpmUtilities.getExecOpts(directory, registry);
    return ChildProcessUtilities.execSync("npm", ["dist-tag", "ls", packageName], opts).indexOf(tag) >= 0;
  }

  static runScriptInDir(script, args, directory, callback) {
    log.silly("runScriptInDir", script, args, path.basename(directory));

    const opts = NpmUtilities.getExecOpts(directory);
    ChildProcessUtilities.exec("npm", ["run", script, ...args], opts, callback);
  }

  static runScriptInPackageStreaming(script, args, pkg, callback) {
    log.silly("runScriptInPackageStreaming", [script, args, pkg.name]);

    const opts = NpmUtilities.getExecOpts(pkg.location);
    ChildProcessUtilities.spawnStreaming(
      "npm", ["run", script, ...args], opts, pkg.name, callback
    );
  }

  static publishTaggedInDir(tag, directory, registry, callback) {
    log.silly("publishTaggedInDir", tag, path.basename(directory));

    const opts = NpmUtilities.getExecOpts(directory, registry);
    ChildProcessUtilities.exec("npm", ["publish", "--tag", tag.trim()], opts, callback);
  }

  static getExecOpts(directory, registry) {
    const opts = {
      cwd: directory,
      preferLocal: false,
    };

    if (registry) {
      opts.env = Object.assign({}, process.env, {
        npm_config_registry: registry,
      });
    }

    log.silly("getExecOpts", opts);
    return opts;
  }
}
