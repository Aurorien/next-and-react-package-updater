// Updates Next.js and React packages across multiple projects
//
// Features:
//   - Only updates within current major versions (Next 15→15.x, React 19→19.x)
//   - Fixes pinned versions (adds ^)
//   - Git integration (pull before, commit/push after)
//   - Only shows projects with Next.js or React
//   - Recursively searches current folder and all subdirectories for package.json files (skips node_modules, .git)
//
// Usage:
//   node update-next-react.js                          # Dry-run in current directory
//   node update-next-react.js --execute                # Actually update packages in current directory
//   node update-next-react.js /path/to/projects        # Use custom directory
//   node update-next-react.js ~/GitHub_repos --execute # Custom directory + execute
//

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

// Get repos directory from command line argument or use current directory
const args = process.argv.filter((arg) => !arg.includes("--execute"));
const customDir = args[2]; // First non-flag argument
const REPOS_DIR = customDir
  ? path.isAbsolute(customDir)
    ? customDir
    : path.join(process.cwd(), customDir)
  : process.cwd(); // Use current working directory

const DRY_RUN = !process.argv.includes("--execute");

// Interactive prompt function
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

function parseVersion(versionString) {
  const match = versionString?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    full: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

function hasFixedVersion(versionString) {
  if (!versionString) return false;
  return /^\d/.test(versionString.trim());
}

function getPackageVersion(projectPath, packageName) {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectPath, "package.json"), "utf-8")
    );
    return (
      packageJson.dependencies?.[packageName] ||
      packageJson.devDependencies?.[packageName]
    );
  } catch {
    return null;
  }
}

// Check if project has any packages we care about
function hasRelevantPackages(projectPath) {
  const packagesToCheck = [
    "next",
    "react",
    "react-dom",
    "@types/react",
    "@types/react-dom",
  ];

  for (const pkg of packagesToCheck) {
    if (getPackageVersion(projectPath, pkg)) {
      return true;
    }
  }

  return false;
}

// Recursively find all directories with package.json
function findAllPackageJsons(dir, results = []) {
  try {
    // Check if current directory has package.json
    if (fs.existsSync(path.join(dir, "package.json"))) {
      results.push({
        name: path.basename(dir),
        path: dir,
      });
    }

    // Recursively check subdirectories
    const items = fs.readdirSync(dir);
    for (const item of items) {
      // Skip node_modules, .git, and hidden folders
      if (item === "node_modules" || item === ".git" || item.startsWith(".")) {
        continue;
      }

      const fullPath = path.join(dir, item);
      try {
        if (fs.statSync(fullPath).isDirectory()) {
          findAllPackageJsons(fullPath, results);
        }
      } catch {
        // Skip if can't access
        continue;
      }
    }
  } catch (error) {
    // Skip if can't read directory
  }

  return results;
}

// Get latest version within a major version range from npm
function getLatestInMajor(packageName, majorVersion) {
  try {
    const result = execSync(
      `npm view ${packageName}@${majorVersion}.x version --json`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const versions = JSON.parse(result);

    // If single version, return it
    if (typeof versions === "string") {
      return versions;
    }

    // If array, sort and get highest version
    if (Array.isArray(versions)) {
      // Sort versions properly (semver comparison)
      const sorted = versions.sort((a, b) => {
        const aParts = a.split(".").map(Number);
        const bParts = b.split(".").map(Number);

        // Compare major, then minor, then patch
        for (let i = 0; i < 3; i++) {
          if (aParts[i] !== bParts[i]) {
            return aParts[i] - bParts[i];
          }
        }
        return 0;
      });

      return sorted[sorted.length - 1]; // Now get the actual latest
    }

    return null;
  } catch {
    return null;
  }
}

// Check if package should be updated (Next.js or React v19 only)
function shouldTrackPackage(packageName, currentVersion) {
  const parsed = parseVersion(currentVersion);
  if (!parsed) return false;

  // Track all Next.js packages
  if (packageName === "next" || packageName.startsWith("next-")) {
    return true;
  }

  // Track React packages only if v19
  if (packageName.includes("react")) {
    return parsed.major === 19;
  }

  return false;
}

// Get package label for display
function getPackageLabel(packageName, majorVersion) {
  if (packageName.includes("react")) {
    return "React v19 package";
  }
  return `Next.js v${majorVersion} package`;
}

// Git helper functions
function isGitRepo(projectPath) {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: projectPath,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function gitPull(projectPath) {
  if (!isGitRepo(projectPath)) {
    return { success: true, skipped: true };
  }

  try {
    // Try git pull first
    execSync("git pull", {
      cwd: projectPath,
      stdio: "pipe",
      encoding: "utf-8",
    });

    // Also try git pull origin main in case there's a specific remote
    try {
      execSync("git pull origin main", {
        cwd: projectPath,
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch {
      // Ignore if origin/main doesn't exist
    }

    return { success: true, skipped: false };
  } catch (error) {
    // If pull fails (no remote, conflicts, etc.), continue anyway
    return { success: true, skipped: false, warning: error.message };
  }
}

async function gitCommitAndPush(projectPath) {
  if (!isGitRepo(projectPath)) {
    return;
  }

  try {
    // Check if there are changes
    const status = execSync("git status --porcelain", {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: "pipe",
    });

    if (!status.trim()) {
      console.log("   ℹ️  No changes to commit");
      return;
    }

    // Stage package.json and package-lock.json
    execSync("git add package.json package-lock.json", {
      cwd: projectPath,
      stdio: "pipe",
    });

    // Commit
    execSync('git commit -m "chore: update Next.js and React packages"', {
      cwd: projectPath,
      stdio: "pipe",
    });

    console.log("   ✅ Changes committed");

    // Push
    try {
      execSync("git push", {
        cwd: projectPath,
        stdio: "inherit",
      });
      console.log("   ✅ Changes pushed");
    } catch (error) {
      console.log("   ⚠️  Push failed - you may need to push manually");
    }
  } catch (error) {
    console.log("   ⚠️  Git commit/push failed:", error.message);
  }
}

async function checkAndUpdate(projectPath) {
  const projectName = path.basename(projectPath);
  console.log(`\n📦 ${projectName}`);

  try {
    // Try to pull latest changes from git
    if (!DRY_RUN) {
      const pullResult = gitPull(projectPath);
      if (pullResult.skipped) {
        // Not a git repo, no message needed
      } else if (pullResult.warning) {
        console.log(`   ℹ️  Git pull skipped: ${pullResult.warning}`);
      }
    }

    if (!fs.existsSync(path.join(projectPath, "node_modules"))) {
      console.log("   ⚠️  No node_modules found - run npm install first");
      return;
    }

    const packagesToCheck = [
      "next",
      "react",
      "react-dom",
      "@types/react",
      "@types/react-dom",
    ];

    const fixedVersions = [];
    const updatesAvailable = [];

    // Check each package
    for (const pkgName of packagesToCheck) {
      const pkgJsonVersion = getPackageVersion(projectPath, pkgName);
      if (!pkgJsonVersion) continue;

      const currentParsed = parseVersion(pkgJsonVersion);
      if (!currentParsed) continue;

      // Skip if not tracking this package
      if (!shouldTrackPackage(pkgName, pkgJsonVersion)) continue;

      const isFixed = hasFixedVersion(pkgJsonVersion);

      // Get latest version within same major
      const latestInMajor = getLatestInMajor(pkgName, currentParsed.major);
      const latestVersion = latestInMajor || currentParsed.full;

      // Track fixed versions
      if (isFixed) {
        fixedVersions.push({
          name: pkgName,
          current: currentParsed.full,
          latest: latestVersion,
        });
      }

      // Track updates
      if (currentParsed.full !== latestVersion) {
        updatesAvailable.push({
          name: pkgName,
          current: currentParsed.full,
          latest: latestVersion,
          label: getPackageLabel(pkgName, currentParsed.major),
        });
      }
    }

    const hasFixed = fixedVersions.length > 0;
    const hasUpdates = updatesAvailable.length > 0;

    if (DRY_RUN) {
      // Dry-run: show what would happen
      if (hasFixed) {
        console.log(`   ⚠️  Found fixed versions (without ^):`);
        fixedVersions.forEach((pkg) => {
          console.log(`      ${pkg.name}: ${pkg.current}`);
        });
      }

      if (hasUpdates) {
        console.log(`   🔄 Updates available:`);
        updatesAvailable.forEach((pkg) => {
          console.log(
            `      ${pkg.name}: ${pkg.current} → ${pkg.latest} (${pkg.label})`
          );
        });
      }

      if (hasFixed || hasUpdates) {
        console.log("   ℹ️  DRY RUN - No changes made");
        console.log(
          "      Run with --execute to add ^ and update these packages"
        );
      } else {
        console.log("   ✅ All relevant packages up to date");
      }
    } else {
      // Execute mode

      // Combine fixed versions and regular updates - update package.json for all
      const allUpdates = [];

      // Add fixed versions (need to add ^)
      if (hasFixed) {
        console.log(`\n   ⚠️  Found fixed versions (without ^):`);
        fixedVersions.forEach((pkg) => {
          console.log(`      ${pkg.name}: ${pkg.current}`);
        });

        const answer = await askQuestion(
          "\n   Add ^ and update to latest versions? (y/n): "
        );

        if (answer !== "y" && answer !== "yes") {
          console.log("   ⏭️  Skipped - keeping fixed versions");
          return;
        }

        allUpdates.push(...fixedVersions);
      }

      // Add packages that already have ^ but need version updates
      if (hasUpdates) {
        updatesAvailable.forEach((pkg) => {
          // Only add if not already in allUpdates
          if (!allUpdates.find((p) => p.name === pkg.name)) {
            allUpdates.push(pkg);
          }
        });
      }

      if (allUpdates.length > 0) {
        // Update package.json with all latest versions
        const packageJsonPath = path.join(projectPath, "package.json");
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf-8")
        );

        console.log(`   🔄 Updating package.json:`);
        allUpdates.forEach((pkg) => {
          const newVersion = `^${pkg.latest}`;
          console.log(`      ${pkg.name}: ${pkg.current} → ${pkg.latest}`);

          if (packageJson.dependencies?.[pkg.name]) {
            packageJson.dependencies[pkg.name] = newVersion;
          }
          if (packageJson.devDependencies?.[pkg.name]) {
            packageJson.devDependencies[pkg.name] = newVersion;
          }
        });

        fs.writeFileSync(
          packageJsonPath,
          JSON.stringify(packageJson, null, 2) + "\n"
        );

        console.log("   📥 Running npm install...");
        execSync("npm install", {
          cwd: projectPath,
          stdio: "inherit",
        });
        console.log("   ✅ Packages updated!");

        // Ask about git commit and push
        if (isGitRepo(projectPath)) {
          const gitAnswer = await askQuestion(
            "\n   📝 Commit and push these changes? (y/n): "
          );

          if (gitAnswer === "y" || gitAnswer === "yes") {
            await gitCommitAndPush(projectPath);
          } else {
            console.log("   ⏭️  Skipped git commit/push");
          }
        }
      } else {
        console.log("   ✅ All relevant packages up to date");
      }
    }
  } catch (error) {
    console.log("   ⚠️  Unexpected error:", error.message);
  }
}

async function main() {
  console.log("═".repeat(60));
  console.log("🔍 Next.js & React v19 Package Updater");
  console.log("═".repeat(60));
  console.log("Scanning directory:", REPOS_DIR);
  console.log(
    "Mode:",
    DRY_RUN ? "🔒 DRY RUN (safe)" : "⚡ EXECUTE (will update)"
  );
  console.log("Rules:");
  console.log("  ✅ Update Next.js packages within current major version");
  console.log("  ✅ Update React packages ONLY if already on v19.x.x");
  console.log("  ⏭️  Skip major version jumps (e.g., Next 15→16, React 18→19)");
  console.log("  🔧 Detect and fix pinned versions (add ^)");
  if (!DRY_RUN) {
    console.log("  📝 Git: Pull before update, commit/push after (optional)");
  }

  if (DRY_RUN) {
    console.log("\n💡 To actually update: node update-next-react.js --execute");
    console.log(
      "💡 Different directory: node update-next-react.js /path/to/projects"
    );
  }
  console.log("═".repeat(60));

  // Check if directory exists
  if (!fs.existsSync(REPOS_DIR)) {
    console.error(`\n❌ Error: Directory not found: ${REPOS_DIR}`);
    console.error("\n💡 Usage:");
    console.error(
      "   node update-next-react.js                    # Current directory"
    );
    console.error(
      "   node update-next-react.js /path/to/projects  # Custom directory"
    );
    console.error(
      "   node update-next-react.js ./my-projects      # Relative path"
    );
    process.exit(1);
  }

  // Recursively find all projects with package.json
  console.log(`\n🔍 Scanning ${REPOS_DIR} recursively...`);
  const allProjects = findAllPackageJsons(REPOS_DIR);

  // Filter to only projects with Next.js or React
  const projects = allProjects.filter((project) => {
    return hasRelevantPackages(project.path);
  });

  console.log(
    `\nFound ${projects.length} relevant projects (${allProjects.length} total)\n`
  );

  for (const project of projects) {
    await checkAndUpdate(project.path);
  }

  console.log("\n" + "═".repeat(60));
  console.log("✨ Scan complete!");
  console.log("═".repeat(60));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
